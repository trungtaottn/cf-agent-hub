import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {ProfileData,ProfileWriteRequest,ProfilePreview,WorkspaceProfile} from '../http/dto';
import {validateWorkspaceProfile,validateProfileWriteRequest,validateProfilePreview} from '../http/generated/auth-validators.js';
import {authorize} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
import {canonicalJson} from './bootstrap';
import {settingsPolicy} from './policy';
export const neutralProfile:WorkspaceProfile={contract_revision:'0.1',profile_id:'profile_neutral',display_name:'Workspace',description:'A shared coordination workspace.',branding:{accent:'blue'},navigation:{visible_views:['overview','inbox','tasks','agents','approvals','activity']},projects:[],work_roles:[]};
export function storedProfile(tx:WorkspaceTransaction,actor:ActorContext):ProfileData{
 const row=tx.one<{version:number;document_json:string}>('SELECT version,document_json FROM profiles WHERE workspace_id=?',[actor.workspaceId]);
 if(!row)return {profile_revision:1,profile:structuredClone(neutralProfile)};
 let profile:unknown;try{profile=JSON.parse(row.document_json);}catch{throw new HttpError('INTERNAL_ERROR',500);}
 if(!validateWorkspaceProfile(profile))throw new HttpError('INTERNAL_ERROR',500);
 return {profile_revision:row.version,profile};
}
export function readProfile(tx:WorkspaceTransaction,actor:ActorContext):ProfileData{
 authorize(tx,actor,'workspace:read');settingsPolicy(tx,actor);return storedProfile(tx,actor);
}
function validateRequest(request:ProfileWriteRequest):void{
 if(!validateProfileWriteRequest(request))throw new HttpError('INVALID_REQUEST',400,{field:'/profile'});
 for(const key of ['projects','work_roles'] as const){
  const ids=new Set<string>();for(const [index,item]of request.profile[key].entries()){if(ids.has(item.id))throw new HttpError('INVALID_REQUEST',400,{field:'/profile/'+key+'/'+index+'/id'});ids.add(item.id);}
 }
}
function merge(old:WorkspaceProfile,incoming:WorkspaceProfile):WorkspaceProfile{
 const merged=structuredClone(incoming);
 for(const key of ['projects','work_roles'] as const){const replacements=new Map(incoming[key].map(x=>[x.id,x]));merged[key]=old[key].map(x=>structuredClone(replacements.get(x.id)??x));for(const item of incoming[key])if(!old[key].some(x=>x.id===item.id))merged[key].push(structuredClone(item));}
 return merged;
}
function referencedProject(tx:WorkspaceTransaction,actor:ActorContext,id:string):boolean{
 const rows=tx.all<{project_ids_json:string}>('SELECT project_ids_json FROM human_grants WHERE workspace_id=? UNION ALL SELECT project_ids_json FROM native_credentials WHERE workspace_id=?',[actor.workspaceId,actor.workspaceId]);
 return rows.some(x=>{const ids:unknown=JSON.parse(x.project_ids_json);return Array.isArray(ids)&&ids.includes(id);});
}
export function previewProfile(tx:WorkspaceTransaction,ctx:CommandContext,request:ProfileWriteRequest):ProfilePreview{
 authorize(tx,ctx.actor,'profile:edit',undefined,ctx.nowMs);if(ctx.actor.kind!=='human')throw new HttpError('FORBIDDEN',403);settingsPolicy(tx,ctx.actor);validateRequest(request);
 const current=storedProfile(tx,ctx.actor);if(request.expected_profile_revision!==current.profile_revision)throw new HttpError('VERSION_CONFLICT',409,{current_revision:current.profile_revision});
 const profile=merge(current.profile,request.profile),changes:ProfilePreview['changes']=[],conflicts:ProfilePreview['conflicts']=[];
 for(const key of ['contract_revision','profile_id','display_name','description','branding','navigation'] as const)if(canonicalJson(profile[key])!==canonicalJson(current.profile[key]))changes.push({field:'/'+key,operation:'update'});
 for(const key of ['projects','work_roles'] as const)for(const [index,item]of profile[key].entries()){
  const old=current.profile[key].find(x=>x.id===item.id);
  if(!old||canonicalJson(item)!==canonicalJson(old))changes.push({field:'/'+key+'/'+index,operation:old?'update':'add'});
  if(old&&old.archived!==item.archived&&key==='projects'&&referencedProject(tx,ctx.actor,item.id))conflicts.push({field:'/'+key+'/'+index+'/archived',code:'REFERENCED_ARCHIVE'});
 }
 const result:ProfilePreview={base_revision:current.profile_revision,profile,changes,conflicts};
 if(!validateProfilePreview(result)||new TextEncoder().encode(JSON.stringify({data:result,request_id:ctx.requestId})).byteLength>65536)throw new HttpError('LIMIT_EXCEEDED',413);
 return result;
}
export function applyProfile(tx:WorkspaceTransaction,ctx:CommandContext,request:ProfileWriteRequest):ProfileData{
 const preview=previewProfile(tx,ctx,request);if(preview.conflicts.length)throw new HttpError('INVALID_STATE',409,{field:'/profile'});
 if(preview.base_revision===Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);
 const revision=preview.base_revision+1;
 tx.exec('INSERT INTO profiles (workspace_id,version,document_json,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET version=excluded.version,document_json=excluded.document_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by',[ctx.actor.workspaceId,revision,canonicalJson(preview.profile),ctx.nowMs,ctx.actor.principalId]);
 return {profile_revision:revision,profile:preview.profile};
}
