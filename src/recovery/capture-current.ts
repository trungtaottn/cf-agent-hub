import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {TABLE_REGISTRY,inspectRegistry} from './table-registry';
import {assertAdmissionOpen,assertArtifactEffectsDrained,maintenanceRow,transitionMaintenance} from './maintenance';
import {canonicalBytes,digestBytes,encodeCurrentChunk,primaryKey,sqlCell,closed,type CurrentRecoveryChunk,type SqlCell} from './encoding';
import {assertRecoveryContext,priorOperation,storeOperation,type RecoveryContext,type RecoveryWorkspace,type RecoveryJobProgress,type CurrentRecoveryManifest} from './protocol';
import {validateRecoveryJobProgress,validateRecoveryManifest} from './generated/recovery-validators.js';
import {signRecord,validateManifestShape} from './manifest';
import {jobIdFor,loadCurrentCaptureJob,saveJob,assertCurrentCaptureJob,reserveStep,assertPending,progress,projection,objectKey,currentChunkRecords,terminalReceipt,readStoredChunk,databaseDigest,type CurrentCaptureJob,type RecoveryBudget} from './jobs';
import {requireArtifactBucket,captureArtifactInventory,copyArtifactToRecovery,verifyCapturedArtifact} from './artifacts';

function validateBudget(b:RecoveryBudget):void{if(!closed(b,['max_rows','max_artifacts','max_total_bytes'])||![b.max_rows,b.max_artifacts,b.max_total_bytes].every(Number.isSafeInteger)||b.max_rows<1||b.max_rows>1000000||b.max_artifacts<0||b.max_artifacts>1000||b.max_total_bytes<1||b.max_total_bytes>268435456)throw Error('RECOVERY_BUDGET_LIMIT');}
function begin(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string,budget:RecoveryBudget):CurrentCaptureJob{
 requireArtifactBucket(w);assertAdmissionOpen(tx);inspectRegistry(tx);if(tx.one('SELECT id FROM recovery_jobs WHERE capture_id=? LIMIT 1',[ctx.captureId])||tx.one("SELECT key FROM idempotency_outcomes WHERE operation LIKE 'operator.recovery.%' AND target=? LIMIT 1",['recovery:'+ctx.captureId]))throw Error('RECOVERY_CAPTURE_ID_CONFLICT');if(tx.one("SELECT id FROM recovery_jobs WHERE state='running' AND operation IN ('capture','restore') LIMIT 1"))throw Error('RECOVERY_BUSY');
 const now=w.clock.nowMs(),barrierId='barrier_'+Array.from(w.entropy.bytes(16),x=>x.toString(16).padStart(2,'0')).join('');
 const fence=transitionMaintenance(tx,{state:'capturing',epoch:ctx.expectedEpoch,barrierId,captureId:ctx.captureId!,nowMs:now,advance:true});
 const job:CurrentCaptureJob={id,workspace_id:w.workspaceId,operation:'capture',state:'running',authority_epoch:ctx.expectedEpoch,capture_id:ctx.captureId!,manifest_digest:null,created_at:now,updated_at:now,details:{version:2,fence,budget:structuredClone(budget),barrierId,checkpoint:null,sourceMaintenance:null,draft:null,manifest:null,tableIndex:0,cursor:null,counts:{rows:0,chunks:0,bytes:0},sqlBytes:0,artifactIndex:0,artifactBytes:0,pendingArtifact:null,phase:'capture_drain',step:0,pending:null,receipt:null,integrityKeyId:w.integrity.keyId,diagnostic:null}};saveJob(tx,job);return job;
}
function completeStep(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob):RecoveryJobProgress{
 job.details.pending=null;job.details.pendingArtifact=null;job.details.step++;job.updated_at=w.clock.nowMs();job.details.diagnostic=null;
 const result=progress(job);saveJob(tx,job);storeOperation(tx,ctx,result,w.clock.nowMs());return result;
}
/** No checkpoint is recorded until exact previously dispatched effects are terminal. */
function checkpoint(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob):RecoveryJobProgress{
 inspectRegistry(tx);
 try{assertArtifactEffectsDrained(tx);}catch(error){if(!(error instanceof Error)||error.message!=='ARTIFACT_EFFECTS_NOT_DRAINED')throw error;job.details.diagnostic={code:'RECOVERY_ARTIFACT_EFFECTS_NOT_DRAINED',at:w.clock.nowMs(),attempts:Math.min(Number.MAX_SAFE_INTEGER,(job.details.diagnostic?.attempts??0)+1)};saveJob(tx,job);const result=progress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return result;}
 const schema=inspectRegistry(tx),inventory=captureArtifactInventory(tx,w,job.capture_id,job.details.budget.max_artifacts);
 const counts=Object.fromEntries(TABLE_REGISTRY.map(table=>{const p=projection(table.name,job);return [table.name,table.name==='maintenance_state'?1:tx.one<{n:number}>('SELECT COUNT(*) AS n FROM "'+table.name+'" WHERE '+p.where,p.bindings)!.n];})) as CurrentRecoveryManifest['database']['table_counts'];
 const rows=Object.values(counts).reduce((n,x)=>n+x,0);if(!Number.isSafeInteger(rows)||rows>job.details.budget.max_rows||inventory.bytes>job.details.budget.max_total_bytes)throw Error('RECOVERY_BUDGET_LIMIT');
 const point:CurrentRecoveryManifest['checkpoint']={barrier_id:job.details.barrierId,event_sequence:schema.eventSequence,schema_version:15,contract_revision:'0.2',authority_epoch:ctx.expectedEpoch};
 const draft:CurrentRecoveryManifest={format_version:2,capture_id:job.capture_id,workspace_id:w.workspaceId,environment_id:w.environmentId,started_at:new Date(job.created_at).toISOString(),ended_at:new Date(w.clock.nowMs()).toISOString(),checkpoint:point,release:structuredClone(w.release),database:{sha256:'0'.repeat(64),byte_size:0,table_counts:counts,chunks:[]},artifacts:inventory.artifacts,unfinished_artifact_ids:inventory.unfinished,auth:{key_id:w.integrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}};
 if(!validateRecoveryManifest(draft)||canonicalBytes(draft).length>65536)throw Error('RECOVERY_MANIFEST_LIMIT');
 job.details.checkpoint=point;job.details.draft=draft;job.details.sourceMaintenance=TABLE_REGISTRY.find(t=>t.name==='maintenance_state')!.columns.map(c=>sqlCell((maintenanceRow(tx)! as unknown as Record<string,SqlValue>)[c.name]));job.details.phase='capture_pages';return completeStep(tx,w,ctx,job);
}
function page(tx:WorkspaceTransaction,job:CurrentCaptureJob):CurrentRecoveryChunk|null{
 const d=job.details,m=d.draft!;while(d.tableIndex<TABLE_REGISTRY.length&&m.database.table_counts[TABLE_REGISTRY[d.tableIndex].name]===0)d.tableIndex++;
 if(d.tableIndex===TABLE_REGISTRY.length){d.phase='hash_chunks';return null;}const table=TABLE_REGISTRY[d.tableIndex];let rows:SqlCell[][];
 if(table.name==='maintenance_state')rows=d.cursor?[]:[d.sourceMaintenance!];
 else{const p=projection(table.name,job),pk=table.primaryKey.map(k=>'"'+k+'"').join(','),after=d.cursor?' AND ('+pk+')>('+table.primaryKey.map(()=>'?').join(',')+')':'';
  const redacted=(name:string)=>table.name==='login_attempts'&&['nonce','pkce_verifier'].includes(name);
  const size=table.columns.map(c=>redacted(c.name)?'0':`coalesce(length(CAST("${c.name}" AS BLOB)),0)`).join('+');
  // Size-only candidates cannot materialize 200 near-limit domain documents.
  const candidates=tx.all<{row_id:number;byte_size:number}>('SELECT rowid AS row_id,('+size+') AS byte_size FROM "'+table.name+'" WHERE '+p.where+after+' ORDER BY '+pk+' LIMIT 200',[...p.bindings,...(d.cursor??[]) as SqlValue[]]);
  const ids:number[]=[];let estimated=4096;
  for(const item of candidates){if(!Number.isSafeInteger(item.row_id)||!Number.isSafeInteger(item.byte_size)||item.byte_size<0)throw Error('RECOVERY_ROW_COUNT');if(!ids.length&&item.byte_size>1048576)throw Error('RECOVERY_CHUNK_LIMIT');const bound=item.byte_size*6+table.columns.length*32;if(ids.length&&estimated+bound>1048576)break;ids.push(item.row_id);estimated+=bound;}
  const columns=table.columns.map(c=>redacted(c.name)?`'' AS "${c.name}"`:'"'+c.name+'"').join(',');
  const found=ids.length?tx.all<Record<string,SqlValue>>('SELECT '+columns+' FROM "'+table.name+'" WHERE rowid IN ('+ids.join(',')+') ORDER BY '+pk+' LIMIT 200'):[];
  rows=found.map(row=>{if(Object.hasOwn(row,'workspace_id')&&row.workspace_id!==job.workspace_id)throw Error('RECOVERY_WORKSPACE_ROW_MISMATCH');if(table.name==='login_attempts'){row.nonce='';row.pkce_verifier='';}return table.columns.map(c=>sqlCell(row[c.name]));});
 }
 if(!rows.length){d.tableIndex++;d.cursor=null;return null;}
 return {format_version:2,schema_version:15,capture_id:job.capture_id,index:d.counts.chunks,table:table.name,columns:table.columns.map(c=>c.name),rows};
}
function guard(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob):CurrentCaptureJob{return withTransaction(w.storage,tx=>{requireArtifactBucket(w);const current=assertCurrentCaptureJob(tx,w,ctx,job.id);assertPending(current,ctx);return current;});}
const diagnosticCodes=new Set(['RECOVERY_BUDGET_LIMIT','RECOVERY_MANIFEST_LIMIT','RECOVERY_JOB_DETAILS_LIMIT','RECOVERY_ARTIFACT_COUNT_LIMIT','RECOVERY_UNFINISHED_ARTIFACT_LIMIT','RECOVERY_ARTIFACT_IDENTITY_MISMATCH','RECOVERY_ARTIFACT_RELATIONSHIP_MISMATCH','RECOVERY_ARTIFACT_MISSING','RECOVERY_ARTIFACT_BYTES_MISMATCH','RECOVERY_ARTIFACT_COPY_UNAVAILABLE','RECOVERY_ARTIFACT_BINDING_UNAVAILABLE','RECOVERY_CHUNK_MISMATCH','RECOVERY_DATABASE_DIGEST_MISMATCH','RECOVERY_SCHEMA_MISMATCH','RECOVERY_RESULT_LIMIT','RECOVERY_SOURCE_IDENTITY_MISMATCH']);
function diagnostic(w:RecoveryWorkspace,ctx:RecoveryContext,id:string,error:unknown):void{
 try{withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,id);if(current.details.phase!=='capture_drain')assertPending(current,ctx);const code=error instanceof Error&&diagnosticCodes.has(error.message)?error.message:'RECOVERY_STEP_UNAVAILABLE';current.details.diagnostic={code,at:w.clock.nowMs(),attempts:Math.min(Number.MAX_SAFE_INTEGER,(current.details.diagnostic?.attempts??0)+1)};saveJob(tx,current);});}catch{}
}
export async function advanceCurrentCapture(w:RecoveryWorkspace,ctx:RecoveryContext,budget:RecoveryBudget):Promise<RecoveryJobProgress>{
 validateBudget(budget);const artifactBinding=requireArtifactBucket(w),recoveryBinding=w.bucket;const stepGuard=(job:CurrentCaptureJob)=>{if(requireArtifactBucket(w)!==artifactBinding||w.bucket!==recoveryBinding)throw Error('RECOVERY_ARTIFACT_BINDING_UNAVAILABLE');return guard(w,ctx,job);};const initialFence=withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx));const id=await jobIdFor(w.workspaceId,ctx.captureId!,'capture');
 const admitted=(()=>{try{return withTransaction(w.storage,tx=>{
  if(requireArtifactBucket(w)!==artifactBinding||w.bucket!==recoveryBinding)throw Error('RECOVERY_ARTIFACT_BINDING_UNAVAILABLE');assertRecoveryContext(tx,w,ctx,initialFence);let job=loadCurrentCaptureJob(tx,id);if(!job){job=begin(tx,w,ctx,id,budget);const result=progress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return {result,job:null};}
  job=assertCurrentCaptureJob(tx,w,ctx,id);if(canonicalJson(job.details.budget)!==canonicalJson(budget))throw Error('RECOVERY_OPERATION_CONFLICT');const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return {result:prior,job:null};}
  if(job.state!=='running'){const result=progress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return {result,job:null};}
  if(job.details.phase==='capture_drain')return {result:checkpoint(tx,w,ctx,job),job:null};
  const phase=job.details.phase;reserveStep(job,ctx,phase==='hash_chunks'?'hash':phase==='capture_artifacts'?'artifact':phase==='capture_finalize'?'finalize':'page',w.clock.nowMs(),phase==='capture_artifacts'?job.details.artifactIndex:null);
  if(phase==='capture_artifacts')job.details.pendingArtifact=job.details.draft!.artifacts[job.details.artifactIndex];saveJob(tx,job);return {result:null,job};
 });}catch(error){diagnostic(w,ctx,id,error);throw error;}})();if(admitted.result)return admitted.result;let job=admitted.job!;
 try{
  if(job.details.phase==='hash_chunks'){
   const digest=await databaseDigest(w,ctx,job);stepGuard(job);
   return withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,id);assertPending(current,ctx);current.details.draft!.database.sha256=digest;validateManifestShape(current.details.draft);current.details.phase=current.details.draft!.artifacts.length?'capture_artifacts':'capture_finalize';return completeStep(tx,w,ctx,current);});
  }
  if(job.details.phase==='capture_artifacts'){
   const entry=job.details.pendingArtifact!;await copyArtifactToRecovery(w,ctx,job,entry);stepGuard(job);
   return withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}assertPending(current,ctx);current.details.artifactIndex++;current.details.artifactBytes+=entry.byte_size;current.details.counts.bytes+=entry.byte_size;if(current.details.artifactIndex===current.details.draft!.artifacts.length)current.details.phase='capture_finalize';return completeStep(tx,w,ctx,current);});
  }
  if(job.details.phase==='capture_finalize')return await finish(w,ctx,job,()=>stepGuard(job));
  const selected=withTransaction(w.storage,tx=>{job=assertCurrentCaptureJob(tx,w,ctx,id);assertPending(job,ctx);inspectRegistry(tx);assertArtifactEffectsDrained(tx);return {job,chunk:page(tx,job)};});job=selected.job;
  if(!selected.chunk)return withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,id);assertPending(current,ctx);current.details.tableIndex=job.details.tableIndex;current.details.cursor=job.details.cursor;current.details.phase=job.details.phase;return completeStep(tx,w,ctx,current);});
  const chunk=selected.chunk;let bytes:Uint8Array<ArrayBuffer>;for(;;){try{bytes=encodeCurrentChunk(chunk);break;}catch(error){if(error instanceof Error&&error.message==='RECOVERY_CHUNK_LIMIT'&&chunk.rows.length>1)chunk.rows=chunk.rows.slice(0,Math.floor(chunk.rows.length/2));else throw error;}}
  const artifactBytes=job.details.draft!.artifacts.reduce((n,e)=>n+e.byte_size,0);
  if(chunk.index>=256||job.details.sqlBytes+bytes.length+artifactBytes>budget.max_total_bytes||job.details.counts.rows+chunk.rows.length>budget.max_rows)throw Error('RECOVERY_BUDGET_LIMIT');
  const digest=await digestBytes(bytes);stepGuard(job);const key=objectKey(job,chunk.index,digest);
  await w.bucket.put(key,bytes.buffer,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'}});stepGuard(job);
  const record={job_id:id,chunk_index:chunk.index,table_name:chunk.table,sha256:digest,byte_size:bytes.length,row_count:chunk.rows.length,object_key:key};await readStoredChunk(w,ctx,job,record);stepGuard(job);
  return withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}assertPending(current,ctx);tx.exec('INSERT INTO recovery_chunks (job_id,chunk_index,table_name,sha256,byte_size,row_count,object_key) VALUES (?,?,?,?,?,?,?)',[id,chunk.index,chunk.table,digest,bytes.length,chunk.rows.length,key]);
   const d=current.details;d.tableIndex=job.details.tableIndex;d.cursor=primaryKey(TABLE_REGISTRY[d.tableIndex],chunk.rows.at(-1)!);d.counts.rows+=chunk.rows.length;d.counts.chunks++;d.counts.bytes+=bytes.length;d.sqlBytes+=bytes.length;d.draft!.database.byte_size=d.sqlBytes;d.draft!.database.chunks.push({index:chunk.index,table:chunk.table,sha256:digest,byte_size:bytes.length,row_count:chunk.rows.length});if(canonicalBytes(d.draft).length>65536)throw Error('RECOVERY_MANIFEST_LIMIT');return completeStep(tx,w,ctx,current);});
 }catch(error){
  const replay=withTransaction(w.storage,tx=>{try{assertCurrentCaptureJob(tx,w,ctx,id);const prior=priorOperation(tx,ctx);return prior&&validateRecoveryJobProgress(prior)?prior:null;}catch{return null;}});if(replay)return replay;
  diagnostic(w,ctx,id,error);
  throw error;
 }
}
async function finish(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob,stepGuard:()=>unknown):Promise<RecoveryJobProgress>{
 const d=job.details,draft=structuredClone(d.draft!);if(d.artifactIndex!==draft.artifacts.length||d.pendingArtifact!==null)throw Error('RECOVERY_ARTIFACT_INCOMPLETE');
 for(const entry of draft.artifacts){await verifyCapturedArtifact(w,ctx,job,entry);stepGuard();}
 const digest=await databaseDigest(w,ctx,job);stepGuard();if(digest!==draft.database.sha256)throw Error('RECOVERY_DATABASE_DIGEST_MISMATCH');
 draft.ended_at=d.pending!.endedAt;validateManifestShape(draft);const proposed=structuredClone(job);proposed.details.draft=null;proposed.details.manifest=draft;proposed.details.pending=null;proposed.details.phase='complete';proposed.details.step++;proposed.details.diagnostic=null;proposed.state='complete';
 withTransaction(w.storage,tx=>{assertCurrentCaptureJob(tx,w,ctx,job.id);assertPending(job,ctx);inspectRegistry(tx);assertArtifactEffectsDrained(tx);proposed.details.receipt=terminalReceipt(tx,w,job,true,'OK');progress(proposed);if(canonicalBytes(proposed.details).length>262144)throw Error('RECOVERY_JOB_DETAILS_LIMIT');});
 const signed=await signRecord(draft,w.integrity,stepGuard);stepGuard();const manifestDigest=await digestBytes(canonicalBytes(signed));stepGuard();
 return withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,job.id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}assertPending(current,ctx);inspectRegistry(tx);assertArtifactEffectsDrained(tx);
  current.details.draft=null;current.details.manifest=signed;current.manifest_digest=manifestDigest;current.details.receipt=terminalReceipt(tx,w,current,true,'OK');current.state='complete';current.details.phase='complete';transitionMaintenance(tx,{state:'captured',epoch:ctx.expectedEpoch,barrierId:current.details.barrierId,captureId:current.capture_id,nowMs:w.clock.nowMs(),advance:false});return completeStep(tx,w,ctx,current);});
}
