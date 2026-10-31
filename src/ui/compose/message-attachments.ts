import type {Artifact,ArtifactStageRequest} from '../../http/dto';
import type {BrowserArtifactRequest,BrowserReadRequest} from '../../../packages/client/src/types';
import type {ComposeBinding} from './submit-intent';
export type AttachmentStatus='hashing'|'staging'|'uploading'|'committing'|'committed'|'stage-unknown'|'upload-unknown'|'commit-unknown'|'unavailable';
export interface AttachmentView {id:string;filename:string;bytes:number;status:AttachmentStatus;artifactId:string|null;}
interface Item extends AttachmentView {readonly owner:ComposeBinding;mediaType:string;file:Blob|null;descriptor:ArtifactStageRequest|null;artifact:Artifact|null;stageKey:string;uploadKey:string;commitKey:string;commitVersion:number|null;abort:AbortController;busy:boolean;}
interface Options {currentBinding:()=>ComposeBinding|null;verifyAuthority:()=>Promise<boolean>;artifact:BrowserArtifactRequest;read:BrowserReadRequest;existing:()=>Promise<Artifact[]|null>;committed:(id:string)=>Promise<void>;changed:()=>void;}
/** Raw bytes and write keys live only here, never in durable draft state or public snapshots. */
const sameOwner=(a:ComposeBinding,b:ComposeBinding)=>a.workspaceId===b.workspaceId&&a.principalId===b.principalId&&a.generation===b.generation;
async function fileHash(blob:Blob){const bytes=await Blob.prototype.arrayBuffer.call(blob);const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');}
export class MessageAttachments {
 #items:Item[]=[];#generation=0;#error:string|null=null;#scope:ComposeBinding|null=null;
 constructor(private readonly options:Options){}
 private current(g:number,c:ComposeBinding,item?:Item){const n=this.options.currentBinding();return g===this.#generation&&!!n&&n.workspaceId===c.workspaceId&&n.principalId===c.principalId&&n.generation===c.generation&&(!item||this.#items.includes(item)&&sameOwner(item.owner,c));}
 get items():AttachmentView[]{if(this.#scope&&!this.current(this.#generation,this.#scope))return [];return this.#items.map(({id,filename,bytes,status,artifactId})=>({id,filename,bytes,status,artifactId}));}
 get error(){return this.#scope&&!this.current(this.#generation,this.#scope)?null:this.#error;}
 private changed(){this.options.changed();}
 async add(file:File|null){
  const observed=this.options.currentBinding();if(!observed){this.dispose();return;}const c={...observed};if(this.#scope&&!sameOwner(this.#scope,c))this.dispose();const g=this.#generation;this.#scope={...c};this.#error=null;
  let size:number,blob:Blob|null,filename:string,mediaType:string;
  try{size=Object.getOwnPropertyDescriptor(Blob.prototype,'size')!.get!.call(file);filename=file!.name;mediaType=file!.type||'application/octet-stream';blob=Blob.prototype.slice.call(file,0,size,mediaType);}catch{this.#error='Invalid local file.';this.changed();return;}
  file=null;
  if(!Number.isSafeInteger(size)||size<0||size>10485760){this.#error='Each file must be at most 10,485,760 bytes.';this.changed();return;}
  // Reserve synchronously before any await; concurrent selections cannot evade queue bounds.
  if(this.#items.length>=5||this.#items.reduce((n,i)=>n+i.bytes,0)+size>26214400){this.#error='At most five attachments and 26,214,400 aggregate bytes.';this.changed();return;}
  const item:Item={id:crypto.randomUUID(),filename,bytes:size,status:'hashing',artifactId:null,owner:{...c},mediaType,file:blob,descriptor:null,artifact:null,stageKey:crypto.randomUUID(),uploadKey:crypto.randomUUID(),commitKey:crypto.randomUUID(),commitVersion:null,abort:new AbortController(),busy:true};blob=null;this.#items.push(item);this.changed();
  try{
   const existing=await this.options.existing();if(!this.current(g,c,item))return;
   const queuedIds=new Set(this.#items.flatMap(i=>i.artifactId?[i.artifactId]:[]));const external=existing?.filter(a=>!queuedIds.has(a.id));
   if(!external||external.length+this.#items.length>5||external.reduce((n,a)=>n+a.byte_size,0)+this.#items.reduce((n,i)=>n+i.bytes,0)>26214400){this.#error='Existing attachments must be readable and fit five artifacts / 26,214,400 bytes.';item.status='unavailable';item.file=null;return;}
   if(!item.file)return;const hash=await fileHash(item.file);if(!this.current(g,c,item))return;
   item.descriptor={task_id:null,run_id:null,filename:item.filename,media_type:item.mediaType,byte_size:item.bytes,sha256:hash};
   if(!await this.allowed(g,c,item))return;item.status='staging';this.changed();
   let result;try{result=await this.options.artifact('stageArtifact',{body:item.descriptor},{idempotencyKey:item.stageKey,signal:item.abort.signal});}catch{result=null;}
   if(!this.current(g,c,item))return;
   if(!result?.ok||!this.matches(item,result.data,c)||result.data.status!=='staged'||result.data.artifact_version!==1){item.status='stage-unknown';return;}
   item.artifact=result.data;item.artifactId=result.data.id;await this.upload(item,g,c);
  }catch{if(this.current(g,c,item))item.status=item.artifactId?'upload-unknown':'unavailable';}
  finally{if(this.current(g,c,item)){item.busy=false;this.changed();}}
 }
 private matches(item:Item,row:Artifact,c:ComposeBinding){const d=item.descriptor;return !!d&&row.workspace_id===c.workspaceId&&row.owner?.kind==='human'&&row.owner.principal_id===c.principalId&&row.owner.agent_id===null&&(!item.artifactId||row.id===item.artifactId)&&row.task_id===null&&row.run_id===null&&row.filename===d.filename&&row.media_type===d.media_type&&row.sha256===d.sha256&&row.byte_size===d.byte_size;}
 private async allowed(g:number,c:ComposeBinding,item:Item){let allowed=false;try{allowed=await this.options.verifyAuthority();}catch{}if(!this.current(g,c,item))return false;if(!allowed){item.status='unavailable';this.changed();}return allowed;}
 private async upload(item:Item,g:number,c:ComposeBinding){
  if(!item.artifact||!item.file||!await this.allowed(g,c,item))return;item.status='uploading';this.changed();let result;
  try{result=await this.options.artifact('uploadArtifactContent',{path:{artifact_id:item.artifact.id}},{idempotencyKey:item.uploadKey,blob:item.file,artifact:item.artifact,signal:item.abort.signal});}catch{result=null;}
  if(!this.current(g,c,item))return;if(!result?.ok||!this.matches(item,result.data,c)||result.data.status!=='uploaded'||result.data.artifact_version!==2){item.status='upload-unknown';return;}
  item.artifact=result.data;await this.commit(item,g,c);
 }
 private async commit(item:Item,g:number,c:ComposeBinding){
  if(!item.artifact||item.artifact.status!=='uploaded'||!await this.allowed(g,c,item))return;
  if(item.commitVersion!==null&&item.commitVersion!==item.artifact.artifact_version){item.status='unavailable';return;}
  item.commitVersion??=item.artifact.artifact_version;item.status='committing';this.changed();let result;
  try{result=await this.options.artifact('commitArtifact',{path:{artifact_id:item.artifact.id},body:{expected_artifact_version:item.commitVersion}},{idempotencyKey:item.commitKey,signal:item.abort.signal});}catch{result=null;}
  if(!this.current(g,c,item))return;if(!result?.ok||!this.matches(item,result.data,c)||result.data.status!=='committed'||result.data.artifact_version!==item.commitVersion+1){item.status='commit-unknown';return;}
  await this.accept(item,result.data,g,c);
 }
 private async accept(item:Item,row:Artifact,g:number,c:ComposeBinding){item.artifact=row;item.status='committed';item.file=null;if(this.current(g,c,item))await this.options.committed(row.id);}
 private async observe(item:Item,g:number,c:ComposeBinding){if(!item.artifactId)return null;let result;try{result=await this.options.read('getArtifact',{path:{artifact_id:item.artifactId}});}catch{result=null;}if(!this.current(g,c,item))return null;
  if(!result?.ok||!this.matches(item,result.data,c)||!['staged','uploaded','committed'].includes(result.data.status)){item.status='unavailable';return null;}
  const row=result.data;if(row.status==='committed'&&row.artifact_version!==3){item.status='unavailable';return null;}if(row.status==='committed'){await this.accept(item,row,g,c);return row;}
  if(row.status==='staged'&&row.artifact_version!==1||row.status==='uploaded'&&row.artifact_version!==2){item.status='unavailable';return null;}item.artifact=row;return row;
 }
 async check(id:string){await this.recover(id,false);}async retry(id:string){await this.recover(id,true);}
 private async recover(id:string,retry:boolean){const observed=this.options.currentBinding();if(!observed||this.#scope&&!sameOwner(this.#scope,observed)){this.dispose();return;}const c={...observed},item=this.#items.find(i=>i.id===id),g=this.#generation;if(!item||item.busy||!c||!this.current(g,c,item)||item.status==='stage-unknown'||item.status==='committed')return;item.busy=true;try{const row=await this.observe(item,g,c);if(!row||!this.current(g,c,item)||!retry)return;if(row.status==='uploaded')await this.commit(item,g,c);else if(row.status==='staged')await this.upload(item,g,c);}finally{if(this.current(g,c,item)){item.busy=false;this.changed();}}}
 remove(id:string){const item=this.#items.find(i=>i.id===id);if(item){item.abort.abort();item.file=null;this.#items=this.#items.filter(i=>i!==item);}this.changed();}
 dispose(){++this.#generation;for(const item of this.#items){item.abort.abort();item.file=null;}this.#items=[];this.#scope=null;this.#error=null;this.changed();}
}
