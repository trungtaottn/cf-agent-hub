import type {Approval,Artifact} from '../../http/dto';
import {validateArtifact} from '../../http/generated/auth-validators.js';
import type {ArtifactDownloadResult} from '../../../packages/client/src/types';
import {Deadline} from '../../../packages/client/src/transport';
import {parseExactJson} from '../../approvals/exact-json';
import {el} from '../dom';
export interface DisplayInput {text:string;sha256:string;byteSize:number;}
const fail=():never=>{throw new Error('INPUT_UNAVAILABLE');};
export function matchesProposalMetadata(approval:Approval,artifact:Artifact):boolean{
 const input=approval.proposal.inputs;
 return validateArtifact(artifact)&&artifact.id===input.artifact_id&&artifact.sha256===input.sha256&&artifact.workspace_id===approval.workspace_id&&(artifact.task_id===null||artifact.task_id===approval.task_id)&&(artifact.run_id===null||artifact.run_id===approval.run_id)&&artifact.status==='committed'&&artifact.media_type==='application/json'&&Number.isSafeInteger(artifact.artifact_version)&&artifact.artifact_version>=1&&Number.isSafeInteger(artifact.byte_size)&&artifact.byte_size>=1&&artifact.byte_size<=10485760;
}

/** Display byte evidence only: not a verifier receipt, action schema or permission. */
export class InputInspector {
 #hash:Promise<ArrayBuffer>|null=null;#active=false;
 async inspect(approval:Approval,artifact:Artifact,response:ArtifactDownloadResult,signal:AbortSignal):Promise<DisplayInput>{
  if(this.#hash||this.#active){if(response.ok)void response.data.body.cancel().catch(()=>{});throw new Error('INPUT_BUSY');}
  this.#active=true;let reader:ReadableStreamDefaultReader<Uint8Array>|null=null;
  const deadline=new Deadline(30_000,signal);
  try{
   const input=approval.proposal.inputs;
   if(!matchesProposalMetadata(approval,artifact))fail();
   if(!response.ok)throw new Error('INPUT_UNAVAILABLE');
   if(response.status!==200||JSON.stringify(response.data.artifact)!==JSON.stringify(artifact))fail();
   const contentReader=response.data.body.getReader();reader=contentReader;const bytes=new Uint8Array(artifact.byte_size);let offset=0;
   for(;;){const chunk=await deadline.wait(contentReader.read());if(chunk.done)break;if(!(chunk.value instanceof Uint8Array)||chunk.value.byteLength===0||offset+chunk.value.byteLength>bytes.byteLength)fail();bytes.set(chunk.value,offset);offset+=chunk.value.byteLength;}
   const completed=await deadline.wait(response.data.completion);if(offset!==bytes.length||!completed.ok||completed.byteSize!==bytes.length)fail();
   parseExactJson(bytes,{maxBytes:10485760,maxDepth:64,maxNodes:100000});deadline.check();
   // Keep the actual unfinished digest, not only its raced deadline promise. No
   // second large hash can be admitted while an invalidated one is still alive.
   const pending=crypto.subtle.digest('SHA-256',bytes);this.#hash=pending;
   void pending.then(()=>{if(this.#hash===pending)this.#hash=null;},()=>{if(this.#hash===pending)this.#hash=null;});
   const hash=await deadline.wait(pending),sha256=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(sha256!==input.sha256)fail();deadline.check();return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),sha256,byteSize:bytes.length};
  }catch{throw new Error('INPUT_UNAVAILABLE');}
  finally{this.#active=false;deadline.dispose();if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}else if(response.ok)void response.data.body.cancel().catch(()=>{});}
 }
}
/** Full original text, never HTML or a pretty-printed replacement for bound bytes. */
export function renderInput(input:DisplayInput):HTMLElement{
 const root=el('section',undefined,{'aria-label':'Exact immutable JSON inputs'});
 root.append(el('p','SHA-256: '+input.sha256+' · '+input.byteSize+' bytes'),el('pre',input.text,{tabindex:'0','aria-label':'Full original JSON input',class:'review'}));return root;
}
