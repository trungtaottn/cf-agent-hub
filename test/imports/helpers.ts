import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {expect} from 'vitest';
import entry from '../../src/index';
import {r2IsolationFixture} from '../helpers/r2-isolation';
import {catalogProfile} from '../helpers/catalog';
import {human,owned} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {csrfToken} from '../../src/auth/csrf';
import {withTransaction} from '../../src/storage/transaction';
import type {SessionRecord} from '../../src/auth/authorize';
import type {ImportRow,ImportEnvelope,ImportPreview,ImportReport,Scope} from '../../src/http/dto';
import {validateImportPreviewResponse,validateImportReportResponse} from '../../src/http/generated/auth-validators.js';
export const importRow=(external_id='external_a',patch:Partial<ImportRow>={}):ImportRow=>({external_id,title:'Imported task '+external_id,description:'Literal source text',project_id:'project_a',work_role_id:'role_a',source_updated_at:null,source_state:'done',source_ref:'https://source.example.invalid/item',...patch});
export const importBatch=(rows:unknown[]=[importRow()],source_revision='revision1'):ImportEnvelope=>({source_namespace:'source_example',source_revision,rows});
export const applyBody=(preview:ImportPreview,accept_rejected_rows=false)=>({expected_import_version:1 as const,preview_sha256:preview.preview_sha256,accept_rejected_rows});
export function importSnapshot(s:DurableObjectStorage){return Object.fromEntries(['tasks','import_plans','import_mappings','events','task_history','idempotency_outcomes','outbox','scheduler_state'].map(table=>[table,s.sql.exec('SELECT * FROM '+table).toArray()]));}
export async function importFixture(name:string){
 const f=await r2IsolationFixture(name,{human:false,configure:raw=>{
  raw.config.human_grants[0].scopes.push('imports:manage');
  raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[],replay_safety_rules:[]};
 }});
 const token='F'.repeat(42)+'A';
 const csrf=await runInDurableObject(f.a.stub,async(_o,{storage:s})=>{catalogProfile(s);human(s);s.sql.exec("UPDATE sessions SET token_digest=? WHERE id='session_settings'",await sha256(token));return csrfToken({...owned(s,name),secrets:env as unknown as Record<string,unknown>},withTransaction(s,tx=>tx.one<SessionRecord>("SELECT * FROM sessions WHERE id='session_settings'")!));});
 const request=(path:string,body?:unknown,key:string=crypto.randomUUID(),method=body===undefined?'GET':'POST',headers:Record<string,string>={})=>new Request(f.a.origin+'/v2/workspaces/'+f.a.id+'/'+path,{method,headers:{cookie:'cfhub_session='+token,origin:f.a.origin,'x-csrf-token':csrf,'idempotency-key':key,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const send=(...args:Parameters<typeof request>)=>entry.fetch(request(...args),f.bindings);
 const preview=async(body=importBatch(),key:string=crypto.randomUUID())=>{const response=await send('imports:preview',body,key),text=await response.text();expect(response.status,text).toBe(200);const value=JSON.parse(text);expect(validateImportPreviewResponse(value)).toBe(true);return value.data as ImportPreview;};
 const apply=async(plan:ImportPreview,partial=false,key:string=crypto.randomUUID())=>{const response=await send('imports/'+plan.id+':apply',applyBody(plan,partial),key),text=await response.text();expect(response.status,text).toBe(200);const value=JSON.parse(text);expect(validateImportReportResponse(value)).toBe(true);return value.data as ImportReport;};
 const snapshot=()=>runInDurableObject(f.a.stub,(_o,{storage:s})=>importSnapshot(s));
 const grant=(scopes:readonly Scope[],projects:string[]|null=null)=>runInDurableObject(f.a.stub,(_o,{storage:s})=>s.sql.exec("UPDATE human_grants SET scopes_json=?,project_ids_json=? WHERE principal_id='human_operator'",JSON.stringify(scopes),JSON.stringify(projects)));
 return {...f,request,send,preview,apply,snapshot,grant,token};
}
