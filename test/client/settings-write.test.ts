import {it,expect,vi} from 'vitest';
import {IntentWriter} from '../../src/ui/write-intent';
import {HubClient} from '../../packages/client/src/client';
import type {ApiResult,PreferencesWriteRequest,ProfileWriteRequest} from '../../packages/client/src/types';
const input:PreferencesWriteRequest={expected_preferences_revision:0,preferences:{contract_revision:'0.1',theme:'dark',density:'compact',default_view:'overview'}};
const loss:ApiResult<unknown>={ok:false,status:null,requestId:null,error:{code:'NETWORK_ERROR',message:'Network request failed',retryable:true}};
it('freezes an uncertain settings intent and replays the exact original key and body',async()=>{
 const transport=vi.fn().mockResolvedValueOnce(loss).mockResolvedValueOnce({ok:true,status:200,requestId:'replay',data:{saved:true}});
 const writer=new IntentWriter(transport),body=structuredClone(input);
 await writer.begin('putPreferences',body,'explicit-original-key');
 body.preferences.theme='light';
 expect(writer.state.status).toBe('uncertain');
 await expect(writer.begin('putPreferences',body,'changed-key')).rejects.toThrow('Reconcile');
 await writer.replay();
 expect(transport.mock.calls).toHaveLength(2);
 expect(transport.mock.calls[1]).toEqual(transport.mock.calls[0]);
 expect(transport.mock.calls[1][1].preferences.theme).toBe('dark');
});
it('invalidates a late successful write response after shared-session denial',async()=>{
 let resolve!:(value:ApiResult<unknown>)=>void;const transport=vi.fn(()=>new Promise<ApiResult<unknown>>(done=>{resolve=done;}));
 const writer=new IntentWriter(transport),pending=writer.begin('putPreferences',input,'key');
 writer.invalidate();resolve({ok:true,status:200,requestId:'late',data:{saved:true}});
 expect(await pending).toBeNull();expect(writer.state).toEqual({status:'idle',intent:null,result:null});
});
it('version conflict retains expected revision until deliberate review',async()=>{
 const conflict:ApiResult<unknown>={ok:false,status:409,requestId:'conflict',error:{code:'VERSION_CONFLICT',message:'Resource version changed',retryable:false,details:{current_revision:9}}};
 const writer=new IntentWriter(vi.fn(async()=>conflict));
 await writer.begin('putPreferences',input,'original');
 expect(writer.state.status).toBe('conflict');
 expect(writer.state.intent?.input).toMatchObject({expected_preferences_revision:0});
 await expect(writer.begin('putPreferences',{...input,expected_preferences_revision:9},'new')).rejects.toThrow('Review');
 writer.reviewed();expect(writer.state.status).toBe('idle');
});

it.each(['INVALID_REQUEST','CSRF_REQUIRED','OPERATION_UNAVAILABLE'])('keeps known preflight %s editable without uncertain replay',async code=>{
 const rejected:ApiResult<unknown>={ok:false,status:null,requestId:null,error:{code,message:'Known preflight rejection',retryable:false}};
 const writer=new IntentWriter(vi.fn(async()=>rejected));
 await writer.begin('putPreferences',input,'original');
 expect(writer.state.status).toBe('rejected');
 await expect(writer.replay()).rejects.toThrow('No uncertain write');
 await expect(writer.begin('putPreferences',{...input,preferences:{...input.preferences,theme:'light'}},'corrected-intent')).resolves.toEqual(rejected);
});
it.each(['NETWORK_ERROR','REQUEST_ABORTED','INVALID_RESPONSE'])('retains %s as an uncertain dispatched outcome',async code=>{
 const unknown:ApiResult<unknown>={ok:false,status:null,requestId:null,error:{code,message:'Unknown outcome',retryable:false}};
 const writer=new IntentWriter(vi.fn(async()=>unknown));await writer.begin('putPreferences',input,'original');
 expect(writer.state.status).toBe('uncertain');
 await expect(writer.begin('putPreferences',input,'replacement')).rejects.toThrow('Reconcile');
});

const profileInput:ProfileWriteRequest={
 expected_profile_revision:1,
 profile:{
  contract_revision:'0.1',profile_id:'profile_neutral',display_name:'Workspace',description:'',
  branding:{accent:'blue'},navigation:{visible_views:['overview','inbox','activity']},
  projects:[{id:'project_one',display_name:'One',description:'',archived:false}],work_roles:[]
 }
};

it('returns known scalar and missing-field locations without dispatching settings writes',async()=>{
 const fetch=vi.fn();const client=new HubClient('ws',{fetch});client.setCsrfToken('csrf');
 const wrongType={...input,preferences:{...input.preferences,theme:17}};
 const missingTheme={...input,preferences:{contract_revision:'0.1',density:'compact',default_view:'overview'}};
 const [wrong,missing]=await Promise.all([
  client.request('putPreferences',wrongType as never,{idempotencyKey:'wrong-type'}),
  client.request('putPreferences',missingTheme as never,{idempotencyKey:'missing-theme'})
 ]);
 expect(wrong).toMatchObject({ok:false,status:null,error:{code:'INVALID_REQUEST',details:{field:'/preferences/theme'}}});
 expect(missing).toMatchObject({ok:false,status:null,error:{code:'INVALID_REQUEST',details:{field:'/preferences/theme'}}});
 expect(fetch).not.toHaveBeenCalled();
});

it('does not reflect attacker-controlled property names or values in local validation paths',async()=>{
 const fetch=vi.fn();const client=new HubClient('ws',{fetch});client.setCsrfToken('csrf');
 const hostile='<img src=x onerror=alert(1)>',secret='never-show-private-value';
 const preferenceInput={...input,preferences:{...input.preferences,[hostile]:secret}};
 const profile={...profileInput,profile:{...profileInput.profile,branding:{accent:'blue',[hostile]:secret}}};
 const project={...profileInput,profile:{...profileInput.profile,projects:[{...profileInput.profile.projects[0]!,[hostile]:secret}]}};
 const [p,br,item]=await Promise.all([
  client.request('putPreferences',preferenceInput as never,{idempotencyKey:'unknown-preference'}),
  client.request('previewProfile',profile as never,{idempotencyKey:'unknown-branding'}),
  client.request('putProfile',project as never,{idempotencyKey:'unknown-project'})
 ]);
 expect(p).toMatchObject({ok:false,error:{details:{field:'/preferences'}}});
 expect(br).toMatchObject({ok:false,error:{details:{field:'/profile/branding'}}});
 expect(item).toMatchObject({ok:false,error:{details:{field:'/profile/projects/0'}}});
 for(const response of [p,br,item]){
  expect(JSON.stringify(response)).not.toContain(hostile);
  expect(JSON.stringify(response)).not.toContain(secret);
 }
 expect(fetch).not.toHaveBeenCalled();
});

it('isolates consecutive and concurrent settings errors and preserves array locations',async()=>{
 const fetch=vi.fn();const client=new HubClient('ws',{fetch});client.setCsrfToken('csrf');
 const invalidProjects={...profileInput,profile:{...profileInput.profile,projects:[{...profileInput.profile.projects[0]!,display_name:19}]}};
 const invalidPreference={...input,preferences:{...input.preferences,density:'dense'}};
 const [item,preference]=await Promise.all([
  client.request('previewProfile',invalidProjects as never,{idempotencyKey:'bad-project'}),
  client.request('putPreferences',invalidPreference as never,{idempotencyKey:'bad-density'})
 ]);
 expect(item).toMatchObject({ok:false,error:{details:{field:'/profile/projects/0/display_name'}}});
 expect(preference).toMatchObject({ok:false,error:{details:{field:'/preferences/density'}}});
 const invalidRoot=await client.request('putPreferences',null as never,{idempotencyKey:'bad-root'});
 expect(invalidRoot).toMatchObject({ok:false,error:{details:{field:'/preferences'}}});
 expect(fetch).not.toHaveBeenCalled();
});
