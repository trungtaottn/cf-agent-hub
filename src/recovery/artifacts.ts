import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {assertCurrentCaptureJob,assertPending,currentCaptureGuard,type CurrentCaptureJob} from './jobs';
import {isSlug,hex,ARTIFACT_BYTES,ARTIFACT_COUNT} from './encoding';
import type {RecoveryWorkspace,RecoveryContext,CurrentRecoveryArtifactEntry} from './protocol';
import type {ArtifactRow,GenerationRow} from '../artifacts/repository';

export function requireArtifactBucket(w:RecoveryWorkspace):R2Bucket{
 if(!w.artifactBucket||!w.bucket||w.artifactBucket===w.bucket)throw Error('RECOVERY_ARTIFACT_BINDING_UNAVAILABLE');return w.artifactBucket;
}
/** Operator capture validates retained associations without impersonating an active product reader. */
function associations(tx:WorkspaceTransaction,row:ArtifactRow):void{
 for(const [table,column,kind] of [['result_artifacts','result_id','result'],['message_artifacts','message_id','message']]){
  if(tx.one(`SELECT a.artifact_id FROM ${table} a WHERE a.workspace_id=? AND a.artifact_id=? AND NOT EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=a.workspace_id AND x.artifact_id=a.artifact_id AND x.resource_kind=? AND x.resource_id=a.${column}) LIMIT 1`,[row.workspace_id,row.id,kind]))throw Error('RECOVERY_ARTIFACT_RELATIONSHIP_MISMATCH');
 }
 const refs=tx.all<{resource_kind:string;resource_id:string}>('SELECT resource_kind,resource_id FROM artifact_associations WHERE workspace_id=? AND artifact_id=? LIMIT 2049',[row.workspace_id,row.id]);
 if(refs.length>2048)throw Error('RECOVERY_ASSOCIATION_LIMIT');
 for(const [kind,id] of [['task',row.task_id],['run',row.run_id]])if(id!==null&&!refs.some(r=>r.resource_kind===kind&&r.resource_id===id))throw Error('RECOVERY_ARTIFACT_RELATIONSHIP_MISMATCH');
 for(const r of refs){let valid=false;
  if(r.resource_kind==='task')valid=Boolean(tx.one('SELECT id FROM tasks WHERE workspace_id=? AND id=?',[row.workspace_id,r.resource_id]));
  else if(r.resource_kind==='run')valid=Boolean(tx.one('SELECT id FROM runs WHERE workspace_id=? AND id=? AND (? IS NULL OR task_id=?)',[row.workspace_id,r.resource_id,row.task_id,row.task_id]));
  else if(r.resource_kind==='result')valid=Boolean(tx.one('SELECT r.id FROM task_results r JOIN result_artifacts a ON a.workspace_id=r.workspace_id AND a.result_id=r.id WHERE r.workspace_id=? AND r.id=? AND a.artifact_id=? AND (? IS NULL OR r.task_id=?) AND (? IS NULL OR r.run_id=?)',[row.workspace_id,r.resource_id,row.id,row.task_id,row.task_id,row.run_id,row.run_id]));
  else if(r.resource_kind==='message')valid=Boolean(tx.one('SELECT m.id FROM messages m JOIN message_artifacts a ON a.workspace_id=m.workspace_id AND a.message_id=m.id WHERE m.workspace_id=? AND m.id=? AND a.artifact_id=?',[row.workspace_id,r.resource_id,row.id]));
  if(!valid)throw Error('RECOVERY_ARTIFACT_RELATIONSHIP_MISMATCH');
 }
}
export function captureArtifactInventory(tx:WorkspaceTransaction,w:RecoveryWorkspace,captureId:string,maxArtifacts:number):{artifacts:CurrentRecoveryArtifactEntry[];unfinished:string[];bytes:number}{
 requireArtifactBucket(w);
 // Attachment tables and reverse edges must agree even when a corrupt row is noncommitted.
 for(const [table,column,kind] of [['result_artifacts','result_id','result'],['message_artifacts','message_id','message']]){
  if(tx.one(`SELECT a.artifact_id FROM ${table} a LEFT JOIN artifacts b ON b.workspace_id=a.workspace_id AND b.id=a.artifact_id WHERE a.workspace_id<>? OR b.id IS NULL OR b.status<>'committed' OR NOT EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=a.workspace_id AND x.artifact_id=a.artifact_id AND x.resource_kind=? AND x.resource_id=a.${column}) LIMIT 1`,[w.workspaceId,kind])||tx.one(`SELECT x.artifact_id FROM artifact_associations x LEFT JOIN artifacts b ON b.workspace_id=x.workspace_id AND b.id=x.artifact_id WHERE x.resource_kind=? AND (x.workspace_id<>? OR b.id IS NULL OR b.status<>'committed' OR NOT EXISTS(SELECT 1 FROM ${table} a WHERE a.workspace_id=x.workspace_id AND a.artifact_id=x.artifact_id AND a.${column}=x.resource_id)) LIMIT 1`,[kind,w.workspaceId]))throw Error('RECOVERY_ARTIFACT_RELATIONSHIP_MISMATCH');
 }
 if(tx.one('SELECT id FROM artifacts WHERE workspace_id<>? LIMIT 1',[w.workspaceId])||tx.one('SELECT id FROM artifact_generations WHERE workspace_id<>? LIMIT 1',[w.workspaceId]))throw Error('RECOVERY_WORKSPACE_ROW_MISMATCH');
 const rows=tx.all<ArtifactRow>("SELECT * FROM artifacts WHERE workspace_id=? AND status='committed' ORDER BY id LIMIT ?",[w.workspaceId,maxArtifacts+1]);if(rows.length>maxArtifacts)throw Error('RECOVERY_ARTIFACT_COUNT_LIMIT');
 const artifacts:CurrentRecoveryArtifactEntry[]=[];let total=0;
 for(const a of rows){
  const g=tx.one<GenerationRow>('SELECT * FROM artifact_generations WHERE workspace_id=? AND artifact_id=? AND id=?',[w.workspaceId,a.id,a.committed_generation_id]);
  if(!g||!/^generation_[a-f0-9]{48}$/.test(g.id)||!isSlug(a.id)||!Number.isSafeInteger(a.byte_size)||a.byte_size<0||a.byte_size>ARTIFACT_BYTES||!/^[a-f0-9]{64}$/.test(a.sha256)||a.committed_at===null||a.expires_at!==null||a.active_generation_id!==g.id||g.state!=='committed'||g.effect_kind!=='put'||g.effect_state!=='drained'||g.effect_drained_at===null||g.artifact_version===null||g.artifact_version+2!==a.artifact_version||g.expected_sha256!==a.sha256||g.observed_sha256!==a.sha256||g.expected_byte_size!==a.byte_size||g.observed_byte_size!==a.byte_size||g.object_key!==`artifacts/${encodeURIComponent(w.workspaceId)}/${encodeURIComponent(a.id)}/${g.id}/${a.sha256}`)throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');
  associations(tx,a);total+=a.byte_size;
  artifacts.push({artifact_id:a.id,generation_id:g.id,artifact_version:a.artifact_version,object_key:g.object_key,recovery_object_key:`r2/${w.workspaceId}/${captureId}/artifacts/${a.id}/${g.id}/${a.sha256}`,byte_size:a.byte_size,sha256:a.sha256});
 }
 const unfinished=tx.all<{id:string}>("SELECT id FROM artifacts WHERE workspace_id=? AND status<>'committed' ORDER BY id LIMIT ?",[w.workspaceId,ARTIFACT_COUNT+1]).map(x=>x.id);if(unfinished.length>ARTIFACT_COUNT)throw Error('RECOVERY_UNFINISHED_ARTIFACT_LIMIT');
 // Unselected old generations are SQL evidence, not another committed byte inventory.
 if(tx.one("SELECT g.id FROM artifact_generations g LEFT JOIN artifacts a ON a.workspace_id=g.workspace_id AND a.id=g.artifact_id WHERE g.state='committed' AND (a.id IS NULL OR a.status<>'committed' OR a.committed_generation_id<>g.id) LIMIT 1"))throw Error('RECOVERY_ARTIFACT_RELATIONSHIP_MISMATCH');
 return {artifacts,unfinished,bytes:total};
}
function guardFor(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob,entry:CurrentRecoveryArtifactEntry):()=>void{
 requireArtifactBucket(w);withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,job.id);assertPending(current,ctx);const draft=current.details.draft;if(!draft||canonicalJson(draft.artifacts[current.details.artifactIndex])!==canonicalJson(entry)||current.details.phase!=='capture_artifacts'||canonicalJson(current.details.pendingArtifact)!==canonicalJson(entry))throw Error('RECOVERY_OPERATION_CONFLICT');});
 return currentCaptureGuard(w,ctx,job);
}
/** Single producer chunk retained; output/digest writes <=64KiB with serial backpressure. */
async function verifiedStream(body:ReadableStream<Uint8Array>,entry:CurrentRecoveryArtifactEntry,guard:()=>void,sink?:WritableStreamDefaultWriter<Uint8Array>,signal?:AbortSignal):Promise<void>{
 const reader=body.getReader(),digest=new (crypto as Crypto&{DigestStream:typeof DigestStream}).DigestStream('SHA-256'),hashWriter=digest.getWriter();
 const hash=digest.digest.then(value=>({value}),()=>({error:true as const}));let count=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 const check=()=>{if(signal?.aborted)throw Error('RECOVERY_ARTIFACT_COPY_UNAVAILABLE');guard();};
 try{
  for(;;){check();const part=await reader.read();check();if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.byteLength===0)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');count+=part.value.byteLength;if(count>entry.byte_size||count>ARTIFACT_BYTES)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');
   for(let offset=0;offset<part.value.byteLength;offset+=65536){const bytes=part.value.subarray(offset,offset+65536);check();await hashWriter.write(bytes);check();if(sink){await sink.write(bytes);check();}}
  }
  if(count!==entry.byte_size)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');check();await hashWriter.close();check();const result=await hash;check();if('error'in result||hex(result.value)!==entry.sha256)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');
  if(sink){await sink.close();check();}
 }catch(error){await Promise.allSettled([reader.cancel(),hashWriter.abort(),...(sink?[sink.abort()]:[])]);throw error;}
 finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();hashWriter.releaseLock();sink?.releaseLock();}
}
async function verifyObject(bucket:R2Bucket,key:string,entry:CurrentRecoveryArtifactEntry,guard:()=>void):Promise<boolean>{
 guard();const object=await bucket.get(key);try{guard();}catch(error){void object?.body.cancel().catch(()=>{});throw error;}
 if(!object)return false;if(object.size!==entry.byte_size){void object.body.cancel().catch(()=>{});throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');}
 await verifiedStream(object.body,entry,guard);guard();return true;
}
export async function copyArtifactToRecovery(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob,entry:CurrentRecoveryArtifactEntry):Promise<void>{
 const guard=guardFor(w,ctx,job,entry);guard();if(await verifyObject(w.bucket,entry.recovery_object_key,entry,guard))return;guard();
 const source=await requireArtifactBucket(w).get(entry.object_key);try{guard();}catch(error){void source?.body.cancel().catch(()=>{});throw error;}
 if(!source)throw Error('RECOVERY_ARTIFACT_MISSING');if(source.size!==entry.byte_size){void source.body.cancel().catch(()=>{});throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');}
 const fixed=new FixedLengthStream(entry.byte_size),writer=fixed.writable.getWriter(),abort=new AbortController();
 // Observe immediately; null/throw also unblocks a producer waiting on backpressure.
 const put=w.bucket.put(entry.recovery_object_key,fixed.readable,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:entry.sha256}).then(value=>{if(value===null){abort.abort();void writer.abort().catch(()=>{});}return {value};},()=>{abort.abort();void writer.abort().catch(()=>{});return {error:true as const};});
 let failure:unknown=null;try{await verifiedStream(source.body,entry,guard,writer,abort.signal);guard();}catch(error){failure=error;}
 const result=await put;guard();if('error'in result)throw Error('RECOVERY_ARTIFACT_COPY_UNAVAILABLE');
 if(failure&&result.value!==null)throw failure;
 if(!await verifyObject(w.bucket,entry.recovery_object_key,entry,guard))throw Error('RECOVERY_ARTIFACT_MISSING');guard();
}
/** Final readback uses the same fixed inventory; never a bucket listing/HEAD proof. */
export async function verifyCapturedArtifact(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob,entry:CurrentRecoveryArtifactEntry):Promise<void>{
 requireArtifactBucket(w);withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,job.id);assertPending(current,ctx);if(current.details.phase!=='capture_finalize'||!current.details.draft||!current.details.draft.artifacts.some(x=>canonicalJson(x)===canonicalJson(entry)))throw Error('RECOVERY_OPERATION_CONFLICT');});
 const guard=currentCaptureGuard(w,ctx,job);
 if(!await verifyObject(w.bucket,entry.recovery_object_key,entry,guard))throw Error('RECOVERY_ARTIFACT_MISSING');guard();
}
