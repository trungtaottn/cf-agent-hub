import {test,expect,appOrigin,issuerOrigin,readFixtureRoute} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';
const list='**/v2/workspaces/ws_example/approvals?*';
test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'r3-decision-reads');});
/** Real OIDC session + real generic DO empty list. No positive intercepted DTOs. */
test('authenticated approvals navigation uses existing shell and truthful empty current read',async({page})=>{
 await login(page,'/tasks');await page.getByRole('link',{name:'Approvals',exact:true}).click();await expect(page.getByRole('heading',{name:'Workspace approvals',exact:true})).toBeVisible();await expect(page).toHaveURL(/\/tasks\?.*panel=approvals/);await expect(page.getByText('No visible decisions in this bounded page.')).toBeVisible();await expect(page.getByTestId('page-status')).toHaveText('Read status: empty');await expect(page.getByRole('button',{name:/^(Approve|Reject)$/})).toHaveCount(0);await expect(page.getByText(/No product action is enabled by this view/)).toBeVisible();
 const status=await page.evaluate(async()=>{const r=await fetch('/v2/workspaces/ws_example/approvals?limit=25');const body=await r.json() as {data:unknown;page:unknown};return {status:r.status,data:body.data,page:body.page};});expect(status).toEqual({status:200,data:[],page:{has_more:false,next_cursor:null}});
});
test('scope-less signed-in principal cannot navigate or issue approval reads',async({page,context})=>{
 await context.addCookies([{name:'cfhub_fixture_subject',value:'restricted-subject',url:issuerOrigin,secure:true}]);let reads=0;page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/approvals'))reads++;});await login(page,'/overview','human_restricted');await expect(page.getByRole('link',{name:'Approvals',exact:true})).toHaveCount(0);await page.goto(appOrigin+'/tasks?workspace=ws_example&panel=approvals');await expect(page.getByText('Approvals unavailable: current human approvals:read and tasks:read are required.')).toBeVisible();expect(reads).toBe(0);
});
test('detached approval refresh callback and delayed real list cannot revive old view',async({page})=>{
 await login(page,'/tasks');await page.getByRole('link',{name:'Approvals',exact:true}).click();await expect(page.getByText('No visible decisions in this bounded page.')).toBeVisible();
 await page.getByRole('button',{name:'Refresh approvals',exact:true}).evaluate(node=>{(window as unknown as {detachedApprovalRefresh:HTMLElement}).detachedApprovalRefresh=node as HTMLElement;});
 let release!:()=>void,waiting=false,reads=0,done!:()=>void;const gate=new Promise<void>(r=>{release=r;}),completed=new Promise<void>(r=>{done=r;});await page.route(list,async route=>{reads++;const response=await readFixtureRoute(route);waiting=true;await gate;await route.fulfill(response);done();});
 try{await page.getByRole('button',{name:'Refresh approvals',exact:true}).click();await expect.poll(()=>waiting).toBe(true);await page.getByRole('link',{name:'Overview',exact:true}).click();const before=reads;await page.evaluate(()=>{(window as unknown as {detachedApprovalRefresh:HTMLElement}).detachedApprovalRefresh.click();});release();await completed;await expect(page.getByRole('heading',{name:'Workspace overview',exact:true})).toBeVisible();await expect(page.getByText('No visible decisions in this bounded page.')).toHaveCount(0);expect(reads).toBe(before);}finally{release();}
});
test('current list denial remains panel-local without unrelated logout',async({page})=>{
 await login(page,'/tasks');await page.getByRole('link',{name:'Approvals',exact:true}).click();await expect(page.getByText('No visible decisions in this bounded page.')).toBeVisible();
 await page.route(list,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'FORBIDDEN',message:'Synthetic denial',retryable:false,request_id:'denied'}})}));await page.getByRole('button',{name:'Refresh approvals',exact:true}).click();await expect(page.getByText('Decision list: forbidden · FORBIDDEN')).toBeVisible();await expect(page.getByTestId('session-status')).toContainText('human_operator');await expect(page.getByText('No visible decisions in this bounded page.')).toHaveCount(0);
});

test('late denial from a disposed Approvals view cannot log out or revive it',async({page})=>{
 await login(page,'/tasks');await page.getByRole('link',{name:'Approvals',exact:true}).click();await expect(page.getByText('No visible decisions in this bounded page.')).toBeVisible();
 let release!:()=>void,waiting=false,done!:()=>void;const gate=new Promise<void>(r=>{release=r;}),completed=new Promise<void>(r=>{done=r;});await page.route(list,async route=>{waiting=true;await gate;await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'UNAUTHENTICATED',message:'Synthetic late denial',retryable:false,request_id:'late'}})});done();});
 try{await page.getByRole('button',{name:'Refresh approvals',exact:true}).click();await expect.poll(()=>waiting).toBe(true);await page.getByRole('link',{name:'Overview',exact:true}).click();release();await completed;await expect(page.getByRole('heading',{name:'Workspace overview',exact:true})).toBeVisible();await expect(page.getByTestId('session-status')).toContainText('human_operator');await expect(page.getByTestId('approvals-panel')).toHaveCount(0);}finally{release();}
});

test('sign-in from the read panel returns to the existing tasks auth path without persisting panel state',async({page})=>{
 await page.goto(appOrigin+'/tasks?workspace=ws_example&panel=approvals');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Workspace tasks',exact:true})).toBeVisible();expect(new URL(page.url()).pathname).toBe('/tasks');expect(new URL(page.url()).searchParams.has('panel')).toBe(false);await expect(page.getByRole('link',{name:'Approvals',exact:true})).toBeVisible();
});
