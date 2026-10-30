import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {TABLE_REGISTRY,inspectRegistry,type RecoveryTableName} from './table-registry';
import {assertAdmissionOpen,maintenanceRow,transitionMaintenance} from './maintenance';
import {canonicalBytes,digestBytes,encodeChunk,primaryKey,sqlCell,CHUNK_LIMIT,type RecoveryChunk,type SqlCell} from './encoding';
import {assertRecoveryContext,priorOperation,storeOperation,type RecoveryContext,type RecoveryWorkspace,type RecoveryJobProgress,type RecoveryManifest,type ChunkMetadata} from './protocol';
import {validateRecoveryJobProgress} from './generated/recovery-validators.js';
import {signRecord,validateManifestShape} from './manifest';
import {jobIdFor,loadJob,saveJob,assertJob,reserveStep,assertPending,progress,projection,objectKey,chunkRecords,terminalReceipt,readStoredChunk,databaseDigest,type RecoveryJob,type RecoveryBudget} from './jobs';
function newJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string,budget:RecoveryBudget):RecoveryJob {
 assertAdmissionOpen(tx);const schema=inspectRegistry(tx);if(tx.one("SELECT id FROM recovery_jobs WHERE state='running' AND operation IN ('capture','restore') LIMIT 1"))throw Error('RECOVERY_BUSY');
 const now=w.clock.nowMs(),barrierId='barrier_'+Array.from(w.entropy.bytes(16),b=>b.toString(16).padStart(2,'0')).join('');
 const fence=transitionMaintenance(tx,{state:'capturing',epoch:ctx.expectedEpoch,barrierId,captureId:ctx.captureId!,nowMs:now,advance:true});
 const maintenance=maintenanceRow(tx)!;
 const tableCounts=Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,0])) as Record<RecoveryTableName,number>;
 const job:RecoveryJob={id,workspace_id:w.workspaceId,operation:'capture',state:'running',authority_epoch:ctx.expectedEpoch,capture_id:ctx.captureId!,manifest_digest:null,created_at:now,updated_at:now,details:{version:1,fence,budget,checkpoint:{barrier_id:barrierId,event_sequence:schema.eventSequence,schema_version:schema.schemaVersion,contract_revision:'0.1',authority_epoch:ctx.expectedEpoch},sourceMaintenance:TABLE_REGISTRY.find(t=>t.name==='maintenance_state')!.columns.map(c=>sqlCell((maintenance as unknown as Record<string,SqlValue>)[c.name])),sourceMetadata:null,tableCounts,activeCounts:{...tableCounts},tableIndex:0,cursor:null,lastKeys:{},verifyIndex:0,counts:{rows:0,chunks:0,bytes:0},phase:'capture_pages',step:0,pending:null,receipt:null,manifest:null,ledger:null,ledgerDigest:null,integrityKeyId:w.integrity.keyId}};
 let rows=0;for(const table of TABLE_REGISTRY){const p=projection(table.name,job),count=table.name==='maintenance_state'?1:tx.one<{n:number}>('SELECT COUNT(*) AS n FROM "'+table.name+'" WHERE '+p.where,p.bindings)!.n;if(!Number.isSafeInteger(count)||count<0)throw Error('RECOVERY_ROW_COUNT');job.details.tableCounts[table.name]=count;rows+=count;}
 if(rows>budget.max_rows)throw Error('RECOVERY_ROW_BUDGET_LIMIT');saveJob(tx,job);return job;
}
function page(tx:WorkspaceTransaction,job:RecoveryJob):{job:RecoveryJob;chunk:RecoveryChunk|null} {
 const d=job.details;while(d.tableIndex<TABLE_REGISTRY.length&&d.tableCounts[TABLE_REGISTRY[d.tableIndex].name]===0)d.tableIndex++;
 if(d.tableIndex===TABLE_REGISTRY.length){d.phase='hash_chunks';return {job,chunk:null};}
 const table=TABLE_REGISTRY[d.tableIndex];let rows:SqlCell[][];
 if(table.name==='maintenance_state')rows=d.cursor?[]:[d.sourceMaintenance!];
 else {const p=projection(table.name,job),pk=table.primaryKey.map(k=>'"'+k+'"').join(','),after=d.cursor?' AND ('+pk+')>('+table.primaryKey.map(()=>'?').join(',')+')':'';
  const found=tx.all<Record<string,SqlValue>>('SELECT '+table.columns.map(c=>'"'+c.name+'"').join(',')+' FROM "'+table.name+'" WHERE '+p.where+after+' ORDER BY '+pk+' LIMIT 200',[...p.bindings,...(d.cursor??[]) as SqlValue[]]);rows=found.map(row=>table.columns.map(c=>sqlCell(row[c.name])));}
 if(rows.length===0){d.tableIndex++;d.cursor=null;return {job,chunk:null};}
 return {job,chunk:{format_version:1,capture_id:job.capture_id,index:d.counts.chunks,table:table.name,columns:table.columns.map(c=>c.name),rows}};
}
export async function advanceCapture(w:RecoveryWorkspace,ctx:RecoveryContext,budget:RecoveryBudget):Promise<RecoveryJobProgress>{
 if(budget.max_artifacts!==0)throw Error('RECOVERY_FORMAT_UNAVAILABLE');
 if(!ctx.captureId||ctx.operation!=='capture')throw Error('INVALID_RECOVERY_CONTEXT');
 withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx));const id=await jobIdFor(w.workspaceId,ctx.captureId,'capture');
 const admitted=withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return {prior,job:null};}
  let job=loadJob(tx,id);if(!job)job=newJob(tx,w,ctx,id,budget);else job=assertJob(tx,w,ctx,id);
  if(canonicalJson(job.details.budget)!==canonicalJson(budget))throw Error('RECOVERY_OPERATION_CONFLICT');
  if(job.state!=='running'){const result=progress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return {prior:result,job:null};}
  reserveStep(job,ctx,job.details.phase==='hash_chunks'?'hash':'page',w.clock.nowMs());saveJob(tx,job);return {prior:null,job};});
 if(admitted.prior)return admitted.prior;let job=admitted.job!;
 if(job.details.phase==='hash_chunks')return finishCapture(w,ctx,job);
 const selected=withTransaction(w.storage,tx=>{job=assertJob(tx,w,ctx,id);assertPending(job,ctx);inspectRegistry(tx);return page(tx,job);});job=selected.job;
 if(!selected.chunk)return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,id);assertPending(current,ctx);current.details.tableIndex=job.details.tableIndex;current.details.cursor=job.details.cursor;current.details.phase=job.details.phase;current.details.pending=null;current.details.step++;current.updated_at=w.clock.nowMs();saveJob(tx,current);const result=progress(current);storeOperation(tx,ctx,result,w.clock.nowMs());return result;});
 const chunk=selected.chunk;let bytes:Uint8Array<ArrayBuffer>;
 while(true){try{bytes=encodeChunk(chunk);break;}catch(error){if(error instanceof Error&&error.message==='RECOVERY_CHUNK_LIMIT'&&chunk.rows.length>1)chunk.rows=chunk.rows.slice(0,Math.floor(chunk.rows.length/2));else throw error;}}
 if(chunk.index>=256||job.details.counts.bytes+bytes!.length>budget.max_total_bytes||job.details.counts.rows+chunk.rows.length>budget.max_rows)throw Error('RECOVERY_BUDGET_LIMIT');
 const digest=await digestBytes(bytes!),key=objectKey(job,chunk.index,digest);withTransaction(w.storage,tx=>{assertJob(tx,w,ctx,id);});await w.bucket.put(key,bytes!.buffer,{httpMetadata:{contentType:'application/json'}});
 return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}assertPending(current,ctx);
  tx.exec('INSERT INTO recovery_chunks (job_id,chunk_index,table_name,sha256,byte_size,row_count,object_key) VALUES (?,?,?,?,?,?,?)',[id,chunk.index,chunk.table,digest,bytes!.length,chunk.rows.length,key]);
  current.details.tableIndex=job.details.tableIndex;current.details.cursor=primaryKey(TABLE_REGISTRY[current.details.tableIndex],chunk.rows.at(-1)!);current.details.counts={rows:current.details.counts.rows+chunk.rows.length,chunks:chunk.index+1,bytes:current.details.counts.bytes+bytes!.length};current.details.pending=null;current.details.step++;current.updated_at=w.clock.nowMs();saveJob(tx,current);const result=progress(current);storeOperation(tx,ctx,result,w.clock.nowMs());return result;});
}
async function finishCapture(w:RecoveryWorkspace,ctx:RecoveryContext,job:RecoveryJob):Promise<RecoveryJobProgress>{
 const sha256=await databaseDigest(w,ctx,job),chunks=withTransaction(w.storage,tx=>{assertJob(tx,w,ctx,job.id);return chunkRecords(tx,job.id);});
 const manifest:RecoveryManifest={format_version:1,capture_id:job.capture_id,workspace_id:w.workspaceId,environment_id:w.environmentId,started_at:new Date(job.created_at).toISOString(),ended_at:job.details.pending!.endedAt,checkpoint:job.details.checkpoint,release:w.release,database:{sha256,byte_size:job.details.counts.bytes,table_counts:job.details.tableCounts,chunks:chunks.map(c=>({index:c.chunk_index,table:c.table_name,sha256:c.sha256,byte_size:c.byte_size,row_count:c.row_count}))},artifacts:[],unfinished_artifact_ids:[],auth:{key_id:w.integrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}};
 validateManifestShape(manifest);const signed=await signRecord(manifest,w.integrity),digest=await digestBytes(canonicalBytes(signed));
 return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,job.id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}assertPending(current,ctx);inspectRegistry(tx);
  current.details.manifest=signed;current.manifest_digest=digest;current.details.receipt=terminalReceipt(tx,w,current,true,'OK');current.details.phase='complete';current.details.step++;current.details.pending=null;current.state='complete';current.updated_at=w.clock.nowMs();
  transitionMaintenance(tx,{state:'captured',epoch:ctx.expectedEpoch,barrierId:current.details.checkpoint.barrier_id,captureId:current.capture_id,nowMs:w.clock.nowMs(),advance:false});saveJob(tx,current);const result=progress(current);storeOperation(tx,ctx,result,w.clock.nowMs());return result;});
}
export async function readRecoveryChunk(w:RecoveryWorkspace,ctx:RecoveryContext,index:number):Promise<{metadata:ChunkMetadata;bytes:ArrayBuffer}>{
 const {job,chunk}=withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx);const found=tx.one<{id:string}>("SELECT id FROM recovery_jobs WHERE capture_id=? AND operation='capture'",[ctx.captureId]);if(!found)throw Error('RECOVERY_JOB_CONFLICT');const job=assertJob(tx,w,ctx,found.id),chunk=chunkRecords(tx,job.id).find(c=>c.chunk_index===index);if(!chunk)throw Error('RECOVERY_CHUNK_MISMATCH');return {job,chunk};});
 const bytes=await readStoredChunk(w,ctx,job,chunk);return {metadata:{capture_id:job.capture_id,index,sha256:chunk.sha256,byte_size:chunk.byte_size},bytes:bytes.buffer};
}
export function readRecoveryStatus(w:RecoveryWorkspace,ctx:RecoveryContext,jobId:string):RecoveryJobProgress{return withTransaction(w.storage,tx=>{const job=assertJob(tx,w,ctx,jobId);return progress(job);});}
