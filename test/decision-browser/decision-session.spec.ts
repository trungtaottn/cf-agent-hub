/** Actual private-build OIDC/session/HTTP/SQL/R2 acceptance, NOT production action availability. */
import type {Page,Request,Response as BrowserResponse} from '@playwright/test';
import type {AuthSessionResponse} from '../../src/http/dto';
import {test,expect,appOrigin,issuerOrigin,readFixtureRoute} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';
const base='/v2/workspaces/ws_example';
interface State {cases:Record<string,{taskId:string;approvalId:string;artifactId:string;sha256:string}>;tasks:{id:string;state:string;task_version:number;proposal_version:number;approval_id:string|null;active_run_id:string|null}[];approvals:{id:string;status:string;approval_version:number;proposal_version:number;task_id:string;decided_by_json:string|null}[];events:{type:string;resource_id:string}[];attempts:{approvalId:string;action:string;bodySha256:string;keySha256:string;status:number;dropped:boolean}[];}
const snapshot=async(page:Page)=>await fixtureControl(page,'read-state') as State;
const commandPath=(id:string,action='approve')=>base+'/approvals/'+id+':'+action;
const matches=(request:Request,id:string,action='approve')=>request.method()==='POST'&&new URL(request.url()).pathname===commandPath(id,action);
/** Closed diagnostics only: never emit reason, input, URL, headers, or arbitrary UI text. */
async function outcomeDiagnostic(page:Page,network:{kind:string;status:number|null;code:string|null}){
 const attempts=(await snapshot(page)).attempts.map(({bodySha256,keySha256,status,dropped})=>({bodySha256,keySha256,status,dropped}));
 const ui=await page.evaluate(()=>{const panel=document.querySelector('[data-testid="approvals-panel"]'),text=panel?.querySelector('[data-testid="decision-action-panel"] [role="status"]')?.textContent??'';
  const state=text.startsWith('Original outcome unknown.')?'uncertain':text.startsWith('Original request pending.')?'pending':text.startsWith('Original outcome remains unresolved.')?'unresolved':text.startsWith('Server confirmed the original decision transition')?'succeeded':text.startsWith('Decision request:')?'other-decision':panel?.textContent?.includes('Approvals disconnected or stale.')?'authority-stale':panel?'other-panel':'absent';return {state,online:navigator.onLine};});
 console.log('DECISION_OUTCOME_DIAGNOSTIC '+JSON.stringify({network:{kind:network.kind,status:network.status,code:network.code},ui,attempts}));
}
async function sendUnknown(page:Page,id:string):Promise<Request>{
 let failed!:(request:Request)=>void,responded!:(response:BrowserResponse)=>void;
 const settled=new Promise<{request:Request;kind:string;status:number|null;code:string|null}>(resolve=>{
  failed=request=>{if(matches(request,id)){const code=request.failure()?.errorText??'';resolve({request,kind:'failed',status:null,code:/^net::ERR_[A-Z_]+$/.test(code)?code:'OTHER_NETWORK_FAILURE'});}};
  responded=response=>{if(matches(response.request(),id))resolve({request:response.request(),kind:'response',status:response.status(),code:null});};page.on('requestfailed',failed);page.on('response',responded);
 });
 try{await page.getByRole('button',{name:'Send decision request',exact:true}).click();const result=await settled;
  await outcomeDiagnostic(page,result);expect(result.kind).toBe('failed');
  try{await expect(page.getByText('Original outcome unknown. Only the original immutable request may be replayed.',{exact:false})).toBeVisible();}catch(error){await outcomeDiagnostic(page,result);throw error;}
  return result.request;
 }finally{page.off('requestfailed',failed);page.off('response',responded);}
}
function droppedPhase(attempts:State['attempts']){expect(attempts.length).toBeGreaterThan(0);expect(attempts.length).toBeLessThan(32);expect(attempts.every(r=>r.status===200&&r.dropped)).toBe(true);expect(new Set(attempts.map(r=>JSON.stringify([r.approvalId,r.action,r.bodySha256,r.keySha256]))).size).toBe(1);}
async function enter(page:Page,name:string,principal='human_operator'){
 await login(page,'/tasks',principal);await page.getByRole('link',{name:'Approvals',exact:true}).click();const state=await snapshot(page),item=state.cases[name]!;
 await page.getByRole('button',{name:'Private synthetic proposal '+name+' · '+item.approvalId,exact:true}).click();return {state,item};
}
async function prepare(page:Page,action:'approval'|'rejection',reason='Synthetic reviewed decision'){
 await page.getByRole('button',{name:'Prepare '+action+' request',exact:true}).click();
 await expect(page.getByText('Decision request: review',{exact:true})).toBeVisible();await page.getByRole('textbox',{name:'Decision reason',exact:true}).fill(reason);
 await page.getByRole('button',{name:'Confirm reviewed request',exact:true}).click();await expect(page.getByRole('button',{name:'Send decision request',exact:true})).toBeEnabled();
}
async function send(page:Page,id:string,action='approve'){
 const response=page.waitForResponse(r=>matches(r.request(),id,action));await page.getByRole('button',{name:'Send decision request',exact:true}).click();const actual=await response;expect(actual.status()).toBe(200);const body=await actual.json();expect(body.data.run===null).toBe(true);expect(body.data.approval.id===id).toBe(true);await expect(page.getByText('Server confirmed the original decision transition, not execution or completion.',{exact:true})).toBeVisible();return actual;
}
function observeAccess(page:Page){const requests:Request[]=[],sessions:BrowserResponse[]=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith(base))requests.push(r);});page.on('response',r=>{if(new URL(r.url()).pathname===base+'/auth/session')sessions.push(r);});return {requests,sessions};}
async function assertFinalAccess(observed:ReturnType<typeof observeAccess>,write:Request){
 const position=observed.requests.indexOf(write);expect(position).toBeGreaterThan(1);expect(observed.requests.slice(position-2,position).map(r=>r.method()+' '+new URL(r.url()).pathname)).toEqual(['GET '+base+'/auth/session','GET '+base]);
 const session=observed.sessions.filter(r=>observed.requests.indexOf(r.request())<position).at(-1);expect(!!session).toBe(true);const value=await session!.json(),headers=await write.allHeaders();expect(typeof value.data.csrf_token==='string'&&headers['x-csrf-token']===value.data.csrf_token).toBe(true);
}
test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'reset');});

test('actual OIDC human approves exact bound inputs with fresh final session CSRF and frozen intent',async({page})=>{
 const {state,item}=await enter(page,'approve');await expect(page.getByLabel('Full original JSON input')).toBeVisible();const observed=observeAccess(page);
 await prepare(page,'approval','First synthetic reason');await page.getByRole('textbox',{name:'Decision reason',exact:true}).fill('Final synthetic reason');await expect(page.getByRole('button',{name:'Send decision request',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Confirm reviewed request',exact:true}).click();
 const panel=page.getByTestId('decision-action-panel');await expect(panel.getByLabel('Exact requested scope')).toContainText(item.taskId);await expect(panel.getByLabel('Immutable checkpoint')).toContainText('Immutable private checkpoint approve');await expect(panel.getByLabel('Full original JSON input')).toContainText(item.taskId);await expect(panel).toContainText(item.sha256);await expect(panel).toContainText('Reviewing human: human_operator');
 await expect(page.getByText('Decision request: ready',{exact:true})).toBeVisible();
 await page.screenshot({path:'factory-decision-visual/desktop-confirmation.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await expect(panel.getByLabel('Exact requested scope')).toContainText(item.taskId);await expect(panel.getByLabel('Immutable checkpoint')).toContainText('Immutable private checkpoint approve');await expect(page.getByRole('button',{name:'Send decision request',exact:true})).toBeEnabled();console.log('DECISION_MOBILE_GEOMETRY '+JSON.stringify(await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth}))));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'factory-decision-visual/mobile-confirmation.png',fullPage:true,animations:'disabled'});
 const response=await send(page,item.approvalId);await assertFinalAccess(observed,response.request());expect(JSON.parse(response.request().postData()!).reason==='Final synthetic reason').toBe(true);
 const after=await snapshot(page),beforeTask=state.tasks.find(t=>t.id===item.taskId)!,task=after.tasks.find(t=>t.id===item.taskId)!,approval=after.approvals.find(a=>a.id===item.approvalId)!;
 expect([task.state,task.task_version,task.proposal_version,task.approval_id,task.active_run_id]).toEqual(['ready',beforeTask.task_version+1,beforeTask.proposal_version,item.approvalId,null]);expect([approval.status,approval.approval_version]).toEqual(['approved',2]);expect(JSON.parse(approval.decided_by_json!).principal_id).toBe('human_operator');expect(after.events.filter(e=>e.type==='task.decision_approved'&&e.resource_id===item.taskId)).toHaveLength(1);
});

test('metadata-only rejection cancels unavailable exact display and downloads no content after mode transition',async({page})=>{
 await login(page,'/tasks');await page.getByRole('link',{name:'Approvals',exact:true}).click();const initial=await snapshot(page),item=initial.cases.reject!;
 let release!:()=>void,done!:()=>void,started!:()=>void,downloads=0,intercepted=false;const gate=new Promise<void>(r=>{release=r;}),completed=new Promise<void>(r=>{done=r;}),waiting=new Promise<void>(r=>{started=r;});
 await page.route('**'+base+'/artifacts/'+item.artifactId+'/content',async route=>{intercepted=true;downloads++;try{const actual=await readFixtureRoute(route);started();await gate;await route.fulfill(actual);}finally{done();}},{times:1});
 try{
  await page.getByRole('button',{name:'Private synthetic proposal reject · '+item.approvalId,exact:true}).click();await waiting;const atTransition=downloads;
  page.on('request',r=>{if(new URL(r.url()).pathname===base+'/artifacts/'+item.artifactId+'/content')downloads++;});
  await prepare(page,'rejection');await expect(page.getByTestId('decision-metadata-only')).toBeVisible();await expect(page.getByLabel('Full original JSON input')).toHaveCount(0);expect(downloads).toBe(atTransition);
  release();await completed;await send(page,item.approvalId,'reject');expect(downloads).toBe(atTransition);const after=await snapshot(page);expect(after.tasks.find(t=>t.id===item.taskId)?.state).toBe('backlog');expect(after.approvals.find(a=>a.id===item.approvalId)?.status).toBe('rejected');expect(after.events.filter(e=>e.type==='task.decision_rejected'&&e.resource_id===item.taskId)).toHaveLength(1);
 }finally{release();await page.unroute('**'+base+'/artifacts/'+item.artifactId+'/content');if(intercepted)await completed;}
});

test('actual missing and wrong CSRF are denied without a transition before a real UI write',async({page})=>{
 const {item,state}=await enter(page,'denied');await expect(page.getByLabel('Full original JSON input')).toBeVisible();const task=state.tasks.find(t=>t.id===item.taskId)!,approval=state.approvals.find(a=>a.id===item.approvalId)!;
 const statuses=await page.evaluate(async data=>{const statuses=[];for(const token of [null,'not-the-session-token']){const headers:Record<string,string>={'content-type':'application/json','idempotency-key':'csrf-negative-'+data.id+'-'+statuses.length};if(token)headers['x-csrf-token']=token;const response=await fetch('/v2/workspaces/ws_example/approvals/'+data.id+':approve',{method:'POST',headers,body:JSON.stringify({expected_version:data.taskVersion,expected_proposal_version:data.proposalVersion,expected_approval_version:data.approvalVersion,reason:'Synthetic CSRF negative'})});statuses.push(response.status);await response.arrayBuffer();}return statuses;},{id:item.approvalId,taskVersion:task.task_version,proposalVersion:approval.proposal_version,approvalVersion:approval.approval_version});expect(statuses).toEqual([403,403]);
 const after=await snapshot(page);expect(after.tasks).toEqual(state.tasks);expect(after.approvals).toEqual(state.approvals);expect(after.events).toEqual(state.events);await prepare(page,'approval');await send(page,item.approvalId);
});

for(const [principal,subject] of [['human_readonly','readonly-subject'],['human_unassigned','unassigned-subject']] as const)test('actual '+principal+' cannot dispatch assigned reviewer mutations',async({page,context})=>{
 await context.addCookies([{name:'cfhub_fixture_subject',value:subject,url:issuerOrigin,secure:true}]);const {item,state}=await enter(page,'approve',principal);await expect(page.getByLabel('Full original JSON input')).toBeVisible();
 if(principal==='human_readonly')await expect(page.getByRole('button',{name:'Prepare approval request',exact:true})).toHaveCount(0);else await expect(page.getByRole('button',{name:'Prepare approval request',exact:true})).toBeDisabled();
 expect((await snapshot(page)).attempts).toHaveLength(0);const task=state.tasks.find(t=>t.id===item.taskId)!,approval=state.approvals.find(a=>a.id===item.approvalId)!;
 const status=await page.evaluate(async data=>{const session=await(await fetch('/v2/workspaces/ws_example/auth/session')).json() as AuthSessionResponse;const response=await fetch('/v2/workspaces/ws_example/approvals/'+data.id+':approve',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'assigned-negative-'+data.id,'x-csrf-token':session.data.csrf_token},body:JSON.stringify({expected_version:data.taskVersion,expected_proposal_version:data.proposalVersion,expected_approval_version:data.approvalVersion,reason:'Synthetic assignment negative'})});await response.arrayBuffer();return response.status;},{id:item.approvalId,taskVersion:task.task_version,proposalVersion:approval.proposal_version,approvalVersion:approval.approval_version});expect(status).toBe(403);const after=await snapshot(page);expect(after.tasks).toEqual(state.tasks);expect(after.approvals).toEqual(state.approvals);expect(after.events).toEqual(state.events);
});

test('actual artifact grant denial clears private display and a later request restores current CSRF after optional reads',async({page})=>{
 const {item}=await enter(page,'approve');await expect(page.getByLabel('Full original JSON input')).toBeVisible();const observed=observeAccess(page);
 await page.route('**'+base+'/artifacts/'+item.artifactId,async route=>{await fixtureControl(page,'revoke-artifacts');await route.continue();},{times:1});const denied=page.waitForResponse(r=>new URL(r.url()).pathname===base+'/artifacts/'+item.artifactId&&r.status()===403);
 await page.getByRole('button',{name:'Refresh decision detail',exact:true}).click();await (await denied).finished();await expect(page.getByLabel('Full original JSON input')).toHaveCount(0);await expect(page.getByTestId('session-status')).toContainText('human_operator');await fixtureControl(page,'restore-grants');await page.getByRole('button',{name:'Refresh approvals',exact:true}).click();await page.getByRole('button',{name:'Private synthetic proposal approve · '+item.approvalId,exact:true}).click();await expect(page.getByLabel('Full original JSON input')).toBeVisible();await prepare(page,'approval');const response=await send(page,item.approvalId);await assertFinalAccess(observed,response.request());
});

test('real committed response loss remains UNKNOWN through current read and replays exact original bytes and key once',async({page})=>{
 const {item}=await enter(page,'unknown');await expect(page.getByLabel('Full original JSON input')).toBeVisible();const observed=observeAccess(page);await prepare(page,'approval','Synthetic immutable unknown intent');await fixtureControl(page,'drop-next-decision');const original=await sendUnknown(page,item.approvalId);
 await expect(page.getByText('Original outcome unknown. Only the original immutable request may be replayed.',{exact:false})).toBeVisible();await expect(page.getByRole('textbox',{name:'Decision reason',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Close decision detail',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Refresh current outcome',exact:true}).click();await expect(page.getByTestId('decision-current-observation')).toContainText('approved');await expect(page.getByText('Original outcome unknown.',{exact:false})).toBeVisible();
 const beforeResume=(await snapshot(page)).attempts;droppedPhase(beforeResume);await fixtureControl(page,'resume-decisions');const replayResponse=page.waitForResponse(r=>matches(r.request(),item.approvalId));await page.getByRole('button',{name:'Replay original request',exact:true}).click();const response=await replayResponse;expect(response.status()).toBe(200);await expect(page.getByText('Server confirmed the original decision transition, not execution or completion.',{exact:true})).toBeVisible();const replay=response.request();expect(original.postData()===replay.postData()).toBe(true);expect((await original.allHeaders())['idempotency-key']===(await replay.allHeaders())['idempotency-key']).toBe(true);await assertFinalAccess(observed,replay);
 const after=await snapshot(page);expect(after.attempts).toHaveLength(beforeResume.length+1);expect(after.attempts.slice(0,-1)).toEqual(beforeResume);expect(after.attempts.at(-1)).toEqual({...beforeResume[0],dropped:false});expect(after.events.filter(e=>e.type==='task.decision_approved'&&e.resource_id===item.taskId)).toHaveLength(1);
});

test('current decide revocation redacts an UNKNOWN private intent without resolving it or blocking logout',async({page})=>{
 const {item}=await enter(page,'unknown');await expect(page.getByLabel('Full original JSON input')).toBeVisible();await prepare(page,'approval','Synthetic retained private reason');await fixtureControl(page,'drop-next-decision');await sendUnknown(page,item.approvalId);const beforeRevoke=(await snapshot(page)).attempts;droppedPhase(beforeRevoke);await expect(page.getByRole('button',{name:'Replay original request',exact:true})).toBeVisible();
 await fixtureControl(page,'revoke-decide');await page.getByRole('button',{name:'Refresh current outcome',exact:true}).click();await expect(page.getByText('Original outcome remains unresolved.',{exact:false})).toBeVisible();await expect(page.getByLabel('Full original JSON input')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Decision reason',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Replay original request',exact:true})).toHaveCount(0);expect((await snapshot(page)).attempts).toEqual(beforeRevoke);
 const persisted=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));expect(persisted.includes('Synthetic retained private reason')).toBe(false);expect(persisted.includes(item.sha256)).toBe(false);await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
});

test('held real content during preparation hides old bytes synchronously and cannot revive after navigation',async({page})=>{
 const {item}=await enter(page,'approve');await expect(page.getByLabel('Full original JSON input')).toBeVisible();await page.getByRole('button',{name:'Prepare approval request',exact:true}).evaluate(node=>{(window as unknown as {oldDecisionPrepare:HTMLElement}).oldDecisionPrepare=node as HTMLElement;});
 let release!:()=>void,done!:()=>void,started!:()=>void,reads=0,writes=0,intercepted=false;const gate=new Promise<void>(r=>{release=r;}),completed=new Promise<void>(r=>{done=r;}),waiting=new Promise<void>(r=>{started=r;});page.on('request',r=>{if(matches(r,item.approvalId))writes++;});
 await page.route('**'+base+'/artifacts/'+item.artifactId+'/content',async route=>{intercepted=true;reads++;try{const actual=await readFixtureRoute(route);started();await gate;await route.fulfill(actual);}finally{done();}},{times:1});
 try{await page.getByRole('button',{name:'Prepare approval request',exact:true}).click();await waiting;await expect(page.getByText('Decision request: preparing',{exact:true})).toBeVisible();await expect(page.getByLabel('Full original JSON input')).toHaveCount(0);await page.getByRole('link',{name:'Overview',exact:true}).click();await page.evaluate(()=>{(window as unknown as {oldDecisionPrepare:HTMLElement}).oldDecisionPrepare.click();});release();await completed;await expect(page.getByRole('heading',{name:'Workspace overview',exact:true})).toBeVisible();await expect(page.getByTestId('decision-action-panel')).toHaveCount(0);await expect(page.getByLabel('Full original JSON input')).toHaveCount(0);expect(reads).toBe(1);expect(writes).toBe(0);}finally{release();await page.unroute('**'+base+'/artifacts/'+item.artifactId+'/content');if(intercepted)await completed;}
});
