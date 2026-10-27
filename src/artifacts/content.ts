import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import type {VerifiedIdentity,CommandContext} from '../workspace/context';
import type {AdmissionFence} from '../recovery/maintenance';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import type {Artifact,ArtifactCommitRequest} from '../http/dto';
import {validateArtifactCommitRequest} from '../http/generated/auth-validators.js';
import {executeCommand,type CommandDescriptor} from '../workspace/commands';
import {findOutcome,readOutcome,fingerprintRequest} from '../workspace/idempotency';
import {canonicalJson,sha256} from '../config/bootstrap';
import {HttpError,securityHeaders} from '../http/envelopes';
import {artifactProof,assertArtifactOwner,assertArtifactWritable,assertArtifactOutcome,nextArtifactVersion} from './commands';
import {artifactRecord,artifactView,generationRecord,authorizeArtifactRead,artifactActor,type ArtifactRow,type GenerationRow} from './repository';
import {inspectArtifactStream,type ByteIdentity} from './stream';
/** Trusted internal context. Never accepted from JSON; original identity is re-resolved after awaits.
 * declaredByteSize is optional parsed transport metadata, never trusted byte identity or authority. */
export interface ArtifactOperationContext {workspace:AuthWorkspace;identity:VerifiedIdentity;requestId:string;idempotencyKey:string;admission:AdmissionFence;runtimeId:string|null;proofHash:string|null;bucket?:R2Bucket;declaredByteSize?:number;}
export function currentArtifactContext(tx:WorkspaceTransaction,ctx:ArtifactOperationContext):CommandContext{
 if(ctx.identity.workspaceId!==ctx.workspace.workspaceId||!ctx.idempotencyKey)throw new HttpError('INVALID_REQUEST',400);
 currentConfiguration(tx,ctx.workspace,ctx.admission);const nowMs=ctx.workspace.clock.nowMs();return {actor:resolveActor(tx,ctx.identity,nowMs),nowMs,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey};
}
function currentWriteContext(tx:WorkspaceTransaction,ctx:ArtifactOperationContext):CommandContext{const c=currentArtifactContext(tx,ctx);artifactActor(tx,c,'artifacts:write');artifactProof(tx,c,ctx.runtimeId,ctx.proofHash);return c;}
function assertCurrentWrite(ctx:ArtifactOperationContext,id:string):void{withTransaction(ctx.workspace.storage,tx=>{const c=currentWriteContext(tx,ctx);assertArtifactWritable(tx,c,artifactRecord(tx,c.actor.workspaceId,id),proof(tx,c,ctx));});}
const target=(id:string,operation:'upload'|'commit')=>'artifacts:'+id+':'+operation;
const path=(ctx:ArtifactOperationContext,id:string,operation:'upload'|'commit')=>'/v2/workspaces/'+ctx.workspace.workspaceId+'/artifacts/'+id+(operation==='upload'?'/content':':commit');
const proof=(tx:WorkspaceTransaction,ctx:CommandContext,operation:ArtifactOperationContext)=>artifactProof(tx,ctx,operation.runtimeId,operation.proofHash);
const execution=(ctx:ArtifactOperationContext,fingerprint:string)=>({workspace:ctx.workspace,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey,fingerprint,admissionEpoch:ctx.admission.authorityEpoch,admissionGeneration:ctx.admission.maintenanceGeneration});
function bucket(ctx:ArtifactOperationContext):R2Bucket{if(!ctx.bucket)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);return ctx.bucket;}
function uploadBody(row:ArtifactRow,bytes:ByteIdentity){return {artifact_id:row.id,task_id:row.task_id,run_id:row.run_id,filename:row.filename,media_type:row.media_type,byte_size:bytes.byteSize,sha256:bytes.sha256};}
function matches(row:ArtifactRow,bytes:ByteIdentity):boolean{return row.byte_size===bytes.byteSize&&row.sha256===bytes.sha256;}
function selectedGeneration(tx:WorkspaceTransaction,row:ArtifactRow):GenerationRow{
 if(row.status!=='uploaded'||row.active_generation_id===null)throw new HttpError('INVALID_STATE',409);
 const g=generationRecord(tx,row.workspace_id,row.id,row.active_generation_id);
 if(g.state!=='uploaded'||g.effect_kind!=='put'||g.effect_state!=='drained'||g.observed_sha256!==row.sha256||g.expected_sha256!==row.sha256||g.observed_byte_size!==row.byte_size||g.expected_byte_size!==row.byte_size||g.artifact_version===null||g.artifact_version+1!==row.artifact_version)throw new HttpError('INVALID_STATE',409);return g;
}
function mutationCommand(ctx:ArtifactOperationContext,id:string,operation:'upload'|'commit',execute:CommandDescriptor<null,Artifact>['execute']):CommandDescriptor<null,Artifact>{
 return {operation:'artifacts:write',target:target(id,operation),resource(){return undefined;},checkAccess(tx,c){assertArtifactOwner(tx,c,artifactRecord(tx,c.actor.workspaceId,id),proof(tx,c,ctx));},checkReplay(tx,c,_b,outcome){if(outcome.data.id!==id)throw new HttpError('INTERNAL_ERROR',500);assertArtifactOutcome(tx,c,outcome.data,proof(tx,c,ctx));},execute};
}
/** Terminal effect bookkeeping is not an authorization action. Exact slot CAS survives admission close. */
export function settleArtifactPut(storage:DurableObjectStorage,g:GenerationRow,nowMs:number,state:'drained'|'uncertain',bytes:ByteIdentity|null):void{
 withTransaction(storage,tx=>tx.exec(`UPDATE artifact_generations SET effect_state=?,effect_drained_at=?,observed_sha256=?,observed_byte_size=?,updated_at=? WHERE workspace_id=? AND artifact_id=? AND id=? AND effect_operation_id=? AND effect_kind='put' AND effect_state='in_flight' AND admission_epoch=? AND admission_generation=?`,[state,state==='drained'?nowMs:null,bytes?.sha256??null,bytes?.byteSize??null,nowMs,g.workspace_id,g.artifact_id,g.id,g.effect_operation_id,g.admission_epoch,g.admission_generation]));
}
export async function uploadArtifactContent(ctx:ArtifactOperationContext,id:string,body:ReadableStream<Uint8Array>,key:string):Promise<Artifact>{
 const store=bucket(ctx);if(!(body instanceof ReadableStream)||body.locked||!key||key!==ctx.idempotencyKey||ctx.declaredByteSize!==undefined&&(!Number.isSafeInteger(ctx.declaredByteSize)||ctx.declaredByteSize<0))throw new HttpError('INVALID_REQUEST',400);
 const mismatchedLength=(row:ArtifactRow)=>ctx.declaredByteSize!==undefined&&ctx.declaredByteSize!==row.byte_size;
 const start=withTransaction(ctx.workspace.storage,tx=>{const c=currentWriteContext(tx,ctx),row=artifactRecord(tx,c.actor.workspaceId,id);assertArtifactOwner(tx,c,row,proof(tx,c,ctx));return {row,principalId:c.actor.principalId};});
 const uploadHash=await sha256(canonicalJson({workspace:ctx.workspace.workspaceId,principal:start.principalId,operation:'artifacts:write',target:target(id,'upload'),key}));
 const generationId='generation_'+Array.from(ctx.workspace.entropy.bytes(24),x=>x.toString(16).padStart(2,'0')).join('');
 const reserved=withTransaction(ctx.workspace.storage,tx=>{
  const c=currentWriteContext(tx,ctx),row=artifactRecord(tx,c.actor.workspaceId,id),verified=proof(tx,c,ctx);assertArtifactOwner(tx,c,row,verified);
  if(findOutcome(tx,c.actor.principalId,'artifacts:write',target(id,'upload'),key,c.actor.workspaceId)){if(mismatchedLength(row))throw new HttpError('IDEMPOTENCY_CONFLICT',409);return {row,generation:null,write:false,replay:true};}
  assertArtifactWritable(tx,c,row,verified);
  const prior=tx.one<GenerationRow>('SELECT * FROM artifact_generations WHERE workspace_id=? AND upload_idempotency_sha256=?',[c.actor.workspaceId,uploadHash]);
  if(prior){if(prior.artifact_id!==id||prior.state==='tombstoned'||prior.effect_kind!=='put'||prior.effect_state!=='drained'||prior.observed_sha256!==row.sha256||prior.observed_byte_size!==row.byte_size)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);if(mismatchedLength(row))throw new HttpError('IDEMPOTENCY_CONFLICT',409);return {row,generation:prior,write:false,replay:false};}
  if(mismatchedLength(row))throw new HttpError('INVALID_REQUEST',400);
  const objectKey='artifacts/'+encodeURIComponent(c.actor.workspaceId)+'/'+encodeURIComponent(id)+'/'+generationId+'/'+row.sha256;
  tx.exec(`INSERT INTO artifact_generations(id,workspace_id,artifact_id,object_key,expected_sha256,expected_byte_size,state,admission_epoch,admission_generation,expires_at,created_at,updated_at,effect_operation_id,effect_kind,effect_state,artifact_version,upload_idempotency_sha256) VALUES(?,?,?,?,?,?,'reserved',?,?,?,?,?,?,'put','reserved',?,?)`,[generationId,c.actor.workspaceId,id,objectKey,row.sha256,row.byte_size,ctx.admission.authorityEpoch,ctx.admission.maintenanceGeneration,row.expires_at,c.nowMs,c.nowMs,'put_'+generationId,row.artifact_version,uploadHash]);
  return {row,generation:generationRecord(tx,c.actor.workspaceId,id,generationId),write:true,replay:false};
 });
 let observed:ByteIdentity;
 if(reserved.write){
  const g=reserved.generation!;
  withTransaction(ctx.workspace.storage,tx=>{const c=currentWriteContext(tx,ctx);assertArtifactWritable(tx,c,artifactRecord(tx,c.actor.workspaceId,id),proof(tx,c,ctx));tx.exec("UPDATE artifact_generations SET effect_state='in_flight',effect_started_at=?,updated_at=? WHERE workspace_id=? AND id=? AND effect_operation_id=? AND effect_kind='put' AND effect_state='reserved'",[c.nowMs,c.nowMs,g.workspace_id,g.id,g.effect_operation_id]);if(generationRecord(tx,g.workspace_id,id,g.id).effect_state!=='in_flight')throw new HttpError('INVALID_STATE',409);});
  const fixed=new FixedLengthStream(reserved.row.byte_size),writer=fixed.writable.getWriter(),abort=new AbortController();
  const refuse=(error:unknown)=>{abort.abort();void writer.abort(error).catch(()=>{});};
  const put=store.put(g.object_key,fixed.readable,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:reserved.row.sha256}).then(value=>{if(value===null)refuse(new HttpError('DEPENDENCY_UNAVAILABLE',503));return {value};},error=>{refuse(error);return {error};});
  let identity:ByteIdentity|null=null,streamError:unknown;
  try{identity=await inspectArtifactStream(body,reserved.row.byte_size,writer,abort.signal);}catch(error){streamError=error;try{await writer.abort(error);}catch{}}
  const result=await put;
  const valid=identity!==null&&matches(reserved.row,identity)&&'value'in result&&result.value!==null;
  settleArtifactPut(ctx.workspace.storage,g,ctx.workspace.clock.nowMs(),'value'in result?'drained':'uncertain',valid?identity:null);
  if(streamError)throw streamError;
  if(!identity||!matches(reserved.row,identity))throw new HttpError('INVALID_REQUEST',400);
  if('error'in result||result.value===null)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  observed=identity;
 }else{
  try{observed=await inspectArtifactStream(body,reserved.row.byte_size);}catch(error){if(error instanceof HttpError&&error.code==='INVALID_REQUEST')throw new HttpError('IDEMPOTENCY_CONFLICT',409);throw error;}
  if(!matches(reserved.row,observed))throw new HttpError('IDEMPOTENCY_CONFLICT',409);
  if(!reserved.replay){assertCurrentWrite(ctx,id);const object=await store.get(reserved.generation!.object_key);if(!object)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);try{assertCurrentWrite(ctx,id);}catch(error){await object.body.cancel().catch(()=>{});throw error;}const actual=await inspectArtifactStream(object.body,reserved.row.byte_size);if(!matches(reserved.row,actual))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
 }
 const fingerprint=await fingerprintRequest('PUT',path(ctx,id,'upload'),{},uploadBody(reserved.row,observed));
 return executeCommand(execution(ctx,fingerprint),ctx.identity,mutationCommand(ctx,id,'upload',(tx,c)=>{
  const row=artifactRecord(tx,c.actor.workspaceId,id);assertArtifactWritable(tx,c,row,proof(tx,c,ctx));const g=generationRecord(tx,c.actor.workspaceId,id,reserved.generation!.id);
  if(g.state!=='reserved'||g.effect_kind!=='put'||g.effect_state!=='drained'||g.artifact_version!==row.artifact_version||g.upload_idempotency_sha256!==uploadHash||g.admission_epoch!==ctx.admission.authorityEpoch||g.admission_generation!==ctx.admission.maintenanceGeneration||g.expires_at<=c.nowMs||g.observed_sha256!==row.sha256||g.observed_byte_size!==row.byte_size)throw new HttpError('VERSION_CONFLICT',409);
  tx.exec("UPDATE artifact_generations SET state='uploaded',updated_at=? WHERE workspace_id=? AND id=?",[c.nowMs,c.actor.workspaceId,g.id]);
  tx.exec("UPDATE artifacts SET status='uploaded',active_generation_id=?,artifact_version=? WHERE workspace_id=? AND id=?",[g.id,nextArtifactVersion(row.artifact_version),c.actor.workspaceId,id]);
  const data=artifactView(artifactRecord(tx,c.actor.workspaceId,id));return {outcome:{status:200,data},event:{type:'artifact.uploaded',resourceType:'artifact',resourceId:id,resourceVersion:null,threadId:null}};
 }),null).data;
}
export async function commitArtifact(ctx:ArtifactOperationContext,id:string,input:ArtifactCommitRequest):Promise<Artifact>{
 const store=bucket(ctx);if(!validateArtifactCommitRequest(input))throw new HttpError('INVALID_REQUEST',400);
 const fingerprint=await fingerprintRequest('POST',path(ctx,id,'commit'),{},input);
 const start=withTransaction(ctx.workspace.storage,tx=>{
  const c=currentWriteContext(tx,ctx),row=artifactRecord(tx,c.actor.workspaceId,id),verified=proof(tx,c,ctx);assertArtifactOwner(tx,c,row,verified);
  const prior=findOutcome(tx,c.actor.principalId,'artifacts:write',target(id,'commit'),ctx.idempotencyKey,c.actor.workspaceId);
  if(prior){readOutcome(prior,fingerprint);return null;}
  assertArtifactWritable(tx,c,row,verified);if(input.expected_artifact_version!==row.artifact_version)throw new HttpError('VERSION_CONFLICT',409);
  return {row,generation:selectedGeneration(tx,row)};
 });
 if(start){const object=await store.get(start.generation.object_key);if(!object)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);try{assertCurrentWrite(ctx,id);}catch(error){await object.body.cancel().catch(()=>{});throw error;}const verified=await inspectArtifactStream(object.body,start.row.byte_size);if(!matches(start.row,verified))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
 return executeCommand(execution(ctx,fingerprint),ctx.identity,mutationCommand(ctx,id,'commit',(tx,c)=>{
  const row=artifactRecord(tx,c.actor.workspaceId,id);assertArtifactWritable(tx,c,row,proof(tx,c,ctx));const g=selectedGeneration(tx,row);
  if(!start||row.artifact_version!==input.expected_artifact_version||g.id!==start.generation.id||g.object_key!==start.generation.object_key||g.admission_epoch!==ctx.admission.authorityEpoch||g.admission_generation!==ctx.admission.maintenanceGeneration||g.expires_at<=c.nowMs)throw new HttpError('VERSION_CONFLICT',409);
  tx.exec("UPDATE artifact_generations SET state='committed',updated_at=? WHERE workspace_id=? AND id=? AND state='uploaded'",[c.nowMs,c.actor.workspaceId,g.id]);
  tx.exec("UPDATE artifacts SET status='committed',artifact_version=?,committed_generation_id=?,committed_at=?,expires_at=NULL WHERE workspace_id=? AND id=? AND status='uploaded'",[nextArtifactVersion(row.artifact_version),g.id,c.nowMs,c.actor.workspaceId,id]);
  const data=artifactView(artifactRecord(tx,c.actor.workspaceId,id));return {outcome:{status:200,data},event:{type:'artifact.committed',resourceType:'artifact',resourceId:id,resourceVersion:null,threadId:null}};
 }),null).data;
}
export async function downloadArtifactContent(ctx:ArtifactOperationContext,id:string):Promise<Response>{
 const store=bucket(ctx),read=()=>withTransaction(ctx.workspace.storage,tx=>authorizeArtifactRead(tx,currentArtifactContext(tx,ctx),id));
 const before=read(),object=await store.get(before.objectKey);
 if(!object)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 try{
  const after=read();if(after.objectKey!==before.objectKey||canonicalJson(after.artifact)!==canonicalJson(before.artifact)||object.size!==after.artifact.byte_size)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const filename=after.artifact.filename.replace(/[\x00-\x1f\x7f/\\"<>]/g,'_').replace(/^\.+/,'_').slice(0,180)||'download';
  const fallback=filename.replace(/[^\x20-\x7e]/g,'_');
  const encoded=encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(filename))).replace(/[!'()*]/g,x=>'%'+x.charCodeAt(0).toString(16).toUpperCase());
  const type=after.artifact.media_type;
  // Invalid stored header text is inert; valid media types retain their declared value.
  const safeType=/^[A-Za-z0-9!#$&^_.+\-]+\/[A-Za-z0-9!#$&^_.+\-]+(?:;[ \x21-\x7e]*)?$/.test(type)&&type.length<=1024?type:'application/octet-stream';
  return new Response(object.body,{headers:{...securityHeaders,'content-type':safeType,'content-length':String(after.artifact.byte_size),'content-disposition':`attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`}});
 }catch(error){await object.body.cancel().catch(()=>{});throw error;}
}
