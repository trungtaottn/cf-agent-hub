import type {ApiResult,Operation,OperationInputs,RequestOptions,ProfileData,ProfilePreview,ProfileWriteRequest,ProfileExport,PreferencesData,PreferencesWriteRequest,WorkspaceProfile,UserPreferences} from '../../packages/client/src/types';
import {IntentWriter,type WriteInput,type WriteOperation} from './write-intent';
import {el,button,labeledControl} from './dom';
import type {ReadState} from './read-state';
export interface SettingsBridge{
 request<T>(operation:Operation,input:OperationInputs[Operation],options?:RequestOptions):Promise<ApiResult<T>>;
 profileSaved(result:Extract<ApiResult<ProfileData>,{ok:true}>):void;
 preferencesSaved(result:Extract<ApiResult<PreferencesData>,{ok:true}>):void;
}
const uncertain=(writer:IntentWriter)=>writer.state.status==='uncertain'||writer.state.status==='pending';
const select=(values:readonly string[],value:string)=>{
 const node=el('select');for(const item of values)node.append(el('option',item,{value:item}));node.value=value;return node;
};
const errorText=(result:Exclude<ApiResult<unknown>,{ok:true}>):string=>
 result.error.message+(result.error.details?.field?' — '+String(result.error.details.field):'')+(result.requestId?' · Request '+result.requestId:'');
const readStatuses:Record<ReadState<unknown>['status'],string>={
 loading:'Loading — waiting for an authenticated response',ready:'Current response',empty:'Successful empty response',
 stale:'Stale — showing the last successful observation',forbidden:'Access denied — current authority is required',
 error:'Read failed — no successful result is available',disconnected:'Disconnected — no cached observation is available'
};
function renderReadEvidence<T>(element:HTMLElement,state:Readonly<ReadState<T>>,source:string):void{
 element.dataset.status=state.status;
 element.replaceChildren(el('p',readStatuses[state.status],{class:'status',role:'status'}),el('div','Source: '+source));
 if(state.observedAt)element.append(el('span','Last successful response observed: '),el('time',new Date(state.observedAt).toLocaleString(),{datetime:state.observedAt}));
 else element.append(el('div','Observed: Not reported'));
 element.append(el('div','Request: '+(state.requestId??'Not reported')));
 if(state.errorCode)element.append(el('p','Error: '+state.errorCode,{class:'muted'}));
}
/** Settings retain drafts and one original write intent only in memory. */
export class SettingsPanel{
 readonly element=el('div',undefined,{class:'settings-grid'});
 #bridge:SettingsBridge;#profile:ProfileData|null=null;#preferences:PreferencesData|null=null;
 #profileWriter:IntentWriter;#preferencesWriter:IntentWriter;
 #sectionsInitialized=false;#generation=0;#profileEditable=false;#refreshProfileControls:(()=>void)|null=null;#refreshPreferencesPolicy:((data:PreferencesData)=>void)|null=null;
 #profileCard=el('section',undefined,{class:'card','aria-labelledby':'profile-heading'});
 #preferencesCard=el('section',undefined,{class:'card','aria-labelledby':'preferences-heading'});
 #profileEvidence=el('div',undefined,{class:'evidence','data-testid':'profile-read-state'});
 #preferencesEvidence=el('div',undefined,{class:'evidence','data-testid':'preferences-read-state'});
 constructor(bridge:SettingsBridge){
  this.#bridge=bridge;
  const transport=<T>(operation:WriteOperation,input:WriteInput,options:{idempotencyKey:string})=>bridge.request<T>(operation,input,options);
  this.#profileWriter=new IntentWriter(transport);this.#preferencesWriter=new IntentWriter(transport);
 }
 invalidate():void{
  ++this.#generation;this.#profileWriter.invalidate();this.#preferencesWriter.invalidate();this.#profile=null;this.#preferences=null;this.#sectionsInitialized=false;this.#profileEditable=false;this.#refreshProfileControls=null;this.#refreshPreferencesPolicy=null;
  this.#profileCard.replaceChildren();this.#preferencesCard.replaceChildren();this.#profileEvidence.replaceChildren();this.#preferencesEvidence.replaceChildren();
  this.element.replaceChildren(el('p','Access denied. Settings drafts and pending write data have been cleared.',{class:'notice'}));
 }
 setData(profile:Readonly<ReadState<ProfileData>>,preferences:Readonly<ReadState<PreferencesData>>,source:string,profileEditable=false):void{
  this.#profileEditable=profileEditable;
  if(!this.#sectionsInitialized){
   this.#profileCard.append(el('h2','Workspace profile',{id:'profile-heading'}),this.#profileEvidence);
   this.#preferencesCard.append(el('h2','Your preferences',{id:'preferences-heading'}),this.#preferencesEvidence);
   this.element.replaceChildren(this.#preferencesCard,this.#profileCard);this.#sectionsInitialized=true;
  }
  renderReadEvidence(this.#profileEvidence,profile,source+'/profile');
  renderReadEvidence(this.#preferencesEvidence,preferences,source+'/preferences');
  // Initialize each successful section independently; subsequent reads update
  // evidence without replacing draft controls or an unresolved write intent.
  if(!this.#preferences&&preferences.data){this.#preferences=structuredClone(preferences.data);this.#renderPreferences();}
  else if(this.#preferences&&preferences.data){this.#preferences=structuredClone(preferences.data);this.#refreshPreferencesPolicy?.(preferences.data);}
  if(!this.#profile&&profile.data){this.#profile=structuredClone(profile.data);this.#renderProfile();}
  this.#refreshProfileControls?.();
 }
 #renderPreferences():void{
  let data=this.#preferences!;let expected=data.preferences_revision;
  const card=this.#preferencesCard;
  card.append(el('p','Only your own portable preferences are written. Deployment policy decides which overrides take effect.',{class:'muted'}));
  const fieldset=el('fieldset'),theme=select(['system','light','dark'],data.preferences.theme),density=select(['comfortable','compact'],data.preferences.density),view=select(['overview','inbox','activity','tasks','kanban','agents','approvals'],data.preferences.default_view);
  const policy=el('p',undefined,{'data-testid':'preference-policy',class:'muted'});
  const policyText=()=>{
   policy.textContent='Allowed overrides: '+(data.allowed_user_overrides.join(', ')||'None')+'.'+(data.default_view_fallback_reason?' Default view falls back to '+data.effective.default_view+' ('+data.default_view_fallback_reason+').':' Agent inbox and R2–R4 views remain unavailable to humans in R1.');
   for(const [name,node]of [['theme',theme],['density',density],['default_view',view]] as const)node.disabled=!data.allowed_user_overrides.includes(name);
  };
  policyText();
  this.#refreshPreferencesPolicy=(fresh)=>{data=fresh;expected=fresh.preferences_revision;policyText();};
  fieldset.append(labeledControl('Theme',theme),labeledControl('Density',density),labeledControl('Default view',view),policy);
  const result=el('div','',{'data-testid':'preferences-result',role:'status'}),review=el('div');
  const save=button('Save preferences',()=>void write(false)),replay=button('Reconcile original preferences write',()=>void write(true),{class:'secondary'});replay.hidden=true;
  const updateLocks=()=>{const locked=uncertain(this.#preferencesWriter);fieldset.disabled=locked;save.disabled=locked||this.#preferencesWriter.state.status==='conflict';replay.hidden=this.#preferencesWriter.state.status!=='uncertain';};
  const write=async(reconcile:boolean)=>{
   const generation=this.#generation;
   let pending:Promise<ApiResult<unknown>|null>;
   try{
    if(reconcile)pending=this.#preferencesWriter.replay();
    else{
     const preferences:UserPreferences={contract_revision:'0.1',theme:theme.value as UserPreferences['theme'],density:density.value as UserPreferences['density'],default_view:view.value as UserPreferences['default_view']};
     const input:PreferencesWriteRequest={expected_preferences_revision:expected,preferences};
     pending=this.#preferencesWriter.begin('putPreferences',input,crypto.randomUUID());
    }
   }catch{result.textContent='Reconcile the original write before changing preferences.';return;}
   result.textContent='Saving original preferences intent…';updateLocks();
   const response=await pending;if(generation!==this.#generation||!response)return;
   updateLocks();
   if(response.ok){
    const saved=response as Extract<ApiResult<PreferencesData>,{ok:true}>;data=saved.data;this.#preferences=structuredClone(data);expected=data.preferences_revision;
    theme.value=data.preferences.theme;density.value=data.preferences.density;view.value=data.preferences.default_view;policyText();
    result.textContent='Preferences saved · Revision '+expected+' · Request '+response.requestId;review.replaceChildren();this.#bridge.preferencesSaved(saved);
   }else if(this.#preferencesWriter.state.status==='uncertain'){
    result.textContent='Outcome uncertain. Your original key and input are retained in memory. Reconcile the original preferences write before making a new change.';
   }else if(response.error.code==='VERSION_CONFLICT'){
    result.textContent='Revision changed. Expected '+expected+', current '+String(response.error.details?.current_revision??'not reported')+'. Review before choosing a new intent.';
    review.replaceChildren(button('Review current preferences revision',async()=>{
     const observed=await this.#bridge.request<PreferencesData>('getPreferences',{});if(generation!==this.#generation||!observed.ok)return;
     review.replaceChildren(el('pre',JSON.stringify(observed.data.preferences,null,2),{class:'review'}),button('Use reviewed preferences revision',()=>{
      expected=observed.data.preferences_revision;data=observed.data;this.#preferencesWriter.reviewed();review.replaceChildren();result.textContent='Reviewed revision '+expected+' selected. Your proposed values remain for review.';policyText();updateLocks();
     },{class:'secondary'}));
    },{class:'secondary'}));
   }else result.textContent=errorText(response);
  };
  card.append(fieldset,el('p','Stored and effective values may differ when a policy or an unavailable view requires a fallback.',{class:'muted'}),result,review);
  const actions=el('div',undefined,{class:'actions'});actions.append(save,replay);card.append(actions);
 }
 #renderProfile():void{
  const original=this.#profile!;let expected=original.profile_revision;let previewBody:ProfileWriteRequest|null=null;
  const revisionLabel=el('p','Expected profile revision: '+expected,{class:'muted','data-testid':'profile-expected-revision'});
  const card=this.#profileCard;card.append(el('p','Portable presentation, projects and work roles only. Profiles do not grant access or enable unavailable features.',{class:'muted'}));
  const fieldset=el('fieldset'),name=el('input',undefined,{type:'text',maxlength:'128'}),description=el('textarea'),accent=select(['blue','teal','indigo','violet','amber','slate'],original.profile.branding.accent),documentInput=el('textarea',undefined,{'aria-label':'Portable profile JSON',spellcheck:'false'});
  name.value=original.profile.display_name;description.value=original.profile.description;documentInput.value=JSON.stringify(original.profile,null,2);
  const authorization=el('p',undefined,{'data-testid':'profile-authorization',class:'muted'});
  const preview=el('div','',{'data-testid':'profile-preview',role:'status'}),result=el('div','',{'data-testid':'profile-result',role:'status'}),review=el('div');
  const previewButton=button('Preview profile',()=>void write('previewProfile',false));
  const apply=button('Apply previewed profile',()=>void write('putProfile',false));apply.disabled=true;
  const replay=button('Reconcile original profile request',()=>void write(null,true),{class:'secondary'});replay.hidden=true;
  const updateLocks=()=>{
   const locked=uncertain(this.#profileWriter),readonly=!this.#profileEditable;
   fieldset.disabled=readonly||locked;previewButton.disabled=readonly||locked||this.#profileWriter.state.status==='conflict';
   apply.disabled=readonly||locked||!previewBody||this.#profileWriter.state.status==='conflict';
   replay.hidden=this.#profileWriter.state.status!=='uncertain';replay.disabled=readonly;
   exportButton.disabled=readonly||locked||this.#profileWriter.state.status==='conflict';
   authorization.textContent=readonly?'Read-only profile. Editing and export require profile:edit in a current workspace response. Your own preferences remain available.':'Profile editing is allowed by your current workspace permissions.';
  };
  const invalidatePreview=()=>{previewBody=null;preview.textContent='Draft changed. Preview again before applying.';updateLocks();};
  const basicChange=()=>{
   try{const draft=JSON.parse(documentInput.value) as WorkspaceProfile;draft.display_name=name.value;draft.description=description.value;draft.branding.accent=accent.value as WorkspaceProfile['branding']['accent'];documentInput.value=JSON.stringify(draft,null,2);}catch{/* Keep invalid JSON visible for explicit correction. */}
   invalidatePreview();
  };
  for(const input of [name,description,accent])input.addEventListener('input',basicChange);
  documentInput.addEventListener('input',()=>{
   try{const draft=JSON.parse(documentInput.value) as WorkspaceProfile;if(typeof draft.display_name==='string')name.value=draft.display_name;if(typeof draft.description==='string')description.value=draft.description;if(draft.branding?.accent)accent.value=draft.branding.accent;}catch{/* Validation remains the canonical request validator. */}
   invalidatePreview();
  });
  const details=el('details');details.append(el('summary','Edit complete portable profile'),el('p','This JSON includes stable project and work-role IDs. Omitted records are preserved by the server; review preview conflicts before apply.',{class:'muted'}),labeledControl('Portable profile JSON',documentInput));
  fieldset.append(labeledControl('Workspace display name',name),labeledControl('Workspace description',description),labeledControl('Accent',accent),details);
  const write=async(operation:'previewProfile'|'putProfile'|null,reconcile:boolean)=>{
   if(!this.#profileEditable)return;
   const generation=this.#generation;let pending:Promise<ApiResult<unknown>|null>,intent:ProfileWriteRequest,actualOperation=operation;
   try{
    if(reconcile){
     const retained=this.#profileWriter.state.intent!;intent=JSON.parse(retained.serializedBody) as ProfileWriteRequest;actualOperation=retained.operation as 'previewProfile'|'putProfile';pending=this.#profileWriter.replay();
    }else{
     if(operation==='putProfile'&&!previewBody)return;
     intent=operation==='putProfile'?structuredClone(previewBody!):{expected_profile_revision:expected,profile:JSON.parse(documentInput.value) as WorkspaceProfile};
     pending=this.#profileWriter.begin(operation!,intent,crypto.randomUUID());
    }
   }catch{result.textContent='Correct the profile JSON or reconcile the original request before continuing.';return;}
   result.textContent=actualOperation==='previewProfile'?'Previewing original profile intent…':'Saving original profile intent…';updateLocks();
   const response=await pending;if(generation!==this.#generation||!response)return;
   if(response.ok&&actualOperation==='previewProfile'){
    const data=response.data as ProfilePreview;previewBody=structuredClone(intent!);
    const list=el('ul');for(const change of data.changes)list.append(el('li',change.operation+' '+change.field));for(const conflict of data.conflicts)list.append(el('li',conflict.code+' '+conflict.field));
    preview.replaceChildren(el('p','Preview at revision '+data.base_revision+' · '+data.changes.length+' changes · '+data.conflicts.length+' conflicts'),list);
    if(data.conflicts.length)previewBody=null;
    result.textContent='Preview complete. Review changes before applying.';
   }else if(response.ok){
    const saved=response as Extract<ApiResult<ProfileData>,{ok:true}>;expected=saved.data.profile_revision;revisionLabel.textContent='Expected profile revision: '+expected;this.#profile=structuredClone(saved.data);previewBody=null;
    documentInput.value=JSON.stringify(saved.data.profile,null,2);name.value=saved.data.profile.display_name;description.value=saved.data.profile.description;accent.value=saved.data.profile.branding.accent;
    result.textContent='Profile saved · Revision '+expected+' · Request '+saved.requestId;review.replaceChildren();this.#bridge.profileSaved(saved);
   }else if(this.#profileWriter.state.status==='uncertain'){
    result.textContent='Outcome uncertain. The original key and profile are retained in memory. Reconcile the original profile request before editing.';
   }else if(response.error.code==='VERSION_CONFLICT'){
    previewBody=null;result.textContent='Revision changed. Expected '+expected+', current '+String(response.error.details?.current_revision??'not reported')+'. Your proposed profile has not been rebased.';
    review.replaceChildren(button('Review current profile revision',async()=>{
     const observed=await this.#bridge.request<ProfileData>('getProfile',{});if(generation!==this.#generation||!observed.ok)return;
     review.replaceChildren(el('p','Current stored revision '+observed.data.profile_revision),el('pre',JSON.stringify(observed.data.profile,null,2),{class:'review'}),button('Use reviewed profile revision',()=>{
      expected=observed.data.profile_revision;revisionLabel.textContent='Expected profile revision: '+expected;this.#profileWriter.reviewed();previewBody=null;review.replaceChildren();result.textContent='Reviewed revision '+expected+' selected. Review your retained draft and preview again.';updateLocks();
     },{class:'secondary'}));
    },{class:'secondary'}));
   }else result.textContent=errorText(response);
   updateLocks();
  };
  const exportButton=button('Export portable profile',async()=>{
   if(!this.#profileEditable)return;
   const generation=this.#generation,response=await this.#bridge.request<ProfileExport>('exportProfile',{});if(generation!==this.#generation)return;
   if(!response.ok){result.textContent=errorText(response);return;}
   const url=URL.createObjectURL(new Blob([JSON.stringify(response.data.profile,null,2)+'\n'],{type:'application/json'}));
   const link=el('a','Download portable profile',{href:url,download:'workspace-profile.json'});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   result.textContent='Portable profile exported · Revision '+response.data.profile_revision;
  },{class:'secondary'});
  const actions=el('div',undefined,{class:'actions'});actions.append(previewButton,apply,replay,exportButton);
  card.append(authorization,revisionLabel,fieldset,preview,result,review,actions);
  this.#refreshProfileControls=updateLocks;updateLocks();
 }
}
