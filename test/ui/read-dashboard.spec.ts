import type {AuthSessionResponse,AuthStartDataResponse} from '../../src/http/dto';
import {test,expect,appOrigin,issuerOrigin} from '../helpers/browser';
import {login,screenshot,fixtureControl} from '../helpers/ui';
test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'fresh');});
test('fresh_workspace_has_no_activity_or_demo_agents',async({page})=>{
 await login(page);
 await expect(page.getByTestId('events-section')).toContainText('Workspace configuration installed.');
 await expect(page.getByRole('link',{name:'Read thread'})).toHaveCount(0);
 await expect(page.getByTestId('agents-evidence')).toHaveText('Not reported');
 await expect(page.getByRole('link',{name:'Tasks',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Kanban',exact:true})).toHaveCount(0);
 const stored=await page.evaluate(async()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage),databases:await indexedDB.databases(),cookie:document.cookie,text:document.documentElement.outerHTML}));
 expect(stored.local).toEqual([]);expect(stored.session).toEqual([]);expect(stored.databases).toEqual([]);expect(stored.cookie).toBe('');
 expect(stored.text).not.toContain('Bearer ');expect(stored.text).not.toContain('csrf_token');await screenshot(page,'fresh-light');
});
test('authorized restricted human receives a genuine successful empty activity response',async({page,context})=>{
 await context.addCookies([{name:'cfhub_fixture_subject',value:'restricted-subject',url:issuerOrigin,secure:true}]);
 await login(page,'/overview','human_restricted');
 await expect(page.getByTestId('events-section')).toContainText('No activity recorded');
 await expect(page.getByTestId('events-section')).toContainText('Successful empty response');
 await screenshot(page,'empty-light');
});
test('human_inbox_navigation_never_impersonates_agent',async({page})=>{
 const requested:string[]=[];page.on('request',r=>requested.push(r.url()));
 await login(page);await page.getByRole('link',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Agent inbox'})).toBeVisible();
 await expect(page.getByTestId('inbox-explanation')).toContainText('Native clients poll their own agent inbox');
 expect(requested.some(url=>url.includes('/inbox'))).toBe(false);
});
test('network fault fixture: failed_read_is_not_zero_or_empty and partial_failure_preserves_truthful_sections',async({page})=>{
 await page.route('**/v2/workspaces/ws_example/events',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'DEPENDENCY_UNAVAILABLE',message:'Dependency unavailable',retryable:true,request_id:'fault-events'}})}));
 await login(page);await expect(page.getByTestId('events-section')).toContainText('Read failed');
 await expect(page.getByTestId('events-section')).not.toContainText('No activity recorded');
 await expect(page.getByTestId('configuration-section')).toContainText('Profile revision');
 await expect(page.getByTestId('page-status')).toContainText('partial');
 await screenshot(page,'partial');await screenshot(page,'error');
});
test('network fault fixture: cached_read_becomes_stale_with_time_label',async({page})=>{
 await login(page);const before=await page.getByTestId('events-section').locator('time').getAttribute('datetime');
 await page.route('**/v2/workspaces/ws_example/events',route=>route.abort('internetdisconnected'));
 await page.getByRole('button',{name:'Refresh reads'}).click();
 await expect(page.getByTestId('events-section')).toContainText('Stale');
 await expect(page.getByTestId('events-section').locator('time')).toHaveAttribute('datetime',before!);
 await screenshot(page,'stale');
});
test('network fault fixture: disconnected first read and loading states stay truthful',async({page})=>{
 await page.route('**/v2/workspaces/ws_example/events',async route=>{await new Promise(r=>setTimeout(r,500));await route.abort('internetdisconnected');});
 await login(page);await expect(page.getByTestId('events-section')).toContainText('Loading');await screenshot(page,'loading');
 await expect(page.getByTestId('events-section')).toContainText('Disconnected');await screenshot(page,'disconnected');
});
test('network fault fixture: revoked_session_clears_sensitive_cache and late responses across sections',async({page})=>{
 await login(page);
 await page.route('**/v2/workspaces/ws_example/events',async route=>{await new Promise(r=>setTimeout(r,250));await route.continue();});
 await page.route('**/v2/workspaces/ws_example/configuration',route=>route.fulfill({status:403,contentType:'text/html',body:'private diagnostic'}));
 await page.getByRole('button',{name:'Refresh reads'}).click();
 await expect(page.getByTestId('session-status')).toContainText('Access denied');
 await expect(page.getByTestId('configuration-section')).not.toContainText('Profile revision');
 await expect(page.getByTestId('events-section')).toContainText('Access denied');
 await page.waitForTimeout(350);await expect(page.getByTestId('events-section')).not.toContainText('No activity recorded');
 await screenshot(page,'forbidden');
});
test('fresh_human_follows_persisted_event_thread_id, survives restart and untrusted_body_is_text',async({page,browser})=>{
 await login(page);
 const accepted=await page.evaluate(async()=>{
  const session=(await (await fetch('/v2/workspaces/ws_example/auth/session')).json() as AuthSessionResponse).data;
  const r=await fetch('/v2/workspaces/ws_example/messages',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf_token,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({recipient_agent_ids:['agent_research'],body:'<img src=x onerror="document.body.dataset.compromised=1"> durable browser journey',refs:[],artifact_ids:[]})});
  if(!r.ok)throw Error('DURABLE_HTTP_SEND_FAILED_'+r.status);return (await r.json() as {data:unknown}).data;
 });
 expect(accepted).toBeTruthy();
 await fixtureControl(page,'restart');
 const fresh=await browser.newContext();const reader=await fresh.newPage();
 try{
  await login(reader);await reader.getByRole('link',{name:'Activity',exact:true}).click();
  const threadLink=reader.getByRole('link',{name:'Read thread'}).first();await expect(threadLink).toBeVisible();await threadLink.click();
  await expect(reader.getByRole('heading',{name:'Thread history',level:1})).toBeVisible();
  await expect(reader.getByTestId('thread-section')).toContainText('<img src=x onerror=');
  expect(await reader.locator('img[src="x"]').count()).toBe(0);
  expect(await reader.locator('body').getAttribute('data-compromised')).toBeNull();
  await expect(reader.getByTestId('thread-section')).toContainText('Stored');
  await expect(reader.getByTestId('thread-section')).toContainText('Transport: Not reported');
  await expect(reader.getByTestId('thread-section')).toContainText('ACK: Not reported');
  await screenshot(reader,'thread');
 }finally{await fresh.close();}
 const restricted=await browser.newContext();await restricted.addCookies([{name:'cfhub_fixture_subject',value:'restricted-subject',url:issuerOrigin,secure:true}]);
 const denied=await restricted.newPage();
 try{
  await denied.goto(appOrigin+'/health/live');
  const url=await denied.evaluate(async()=>{const r=await fetch('/v2/workspaces/ws_example/auth/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({return_path:'/overview'})});return (await r.json() as AuthStartDataResponse).data.authorization_url as string;});
  await denied.goto(url);await expect(denied.getByRole('link',{name:'Read thread'})).toHaveCount(0);
  await expect(denied.getByTestId('session-status')).toContainText('human_restricted');
  await expect(denied.getByTestId('events-section')).not.toContainText('durable browser journey');
 }finally{await restricted.close();}
});
test('network fault fixture: thread resource isolation survives a failed next thread read',async({page})=>{
 await login(page);
 const threads=await page.evaluate(async()=>{
  const session=(await (await fetch('/v2/workspaces/ws_example/auth/session')).json() as AuthSessionResponse).data;
  const ids:string[]=[];
  for(const body of ['First thread retained text','Second thread retained text']){
   const response=await fetch('/v2/workspaces/ws_example/messages',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf_token,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({recipient_agent_ids:['agent_research'],body,refs:[],artifact_ids:[]})});
   if(response.status!==201)throw Error('DURABLE_HTTP_SEND_FAILED_'+response.status);
   ids.push((await response.json() as {data:{thread_id:string}}).data.thread_id);
  }
  return ids;
 });
 await page.getByRole('button',{name:'Refresh reads'}).click();
 await page.locator('a[href$="thread='+encodeURIComponent(threads[0]!)+'"]').click();
 await expect(page.getByTestId('thread-section')).toContainText('First thread retained text');
 await page.getByRole('link',{name:'Activity',exact:true}).click();
 await page.route('**/threads/'+threads[1],async route=>{
  await new Promise(resolve=>setTimeout(resolve,250));
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'DEPENDENCY_UNAVAILABLE',message:'Dependency unavailable',retryable:true,request_id:'second_thread_fault'}})});
 });
 await page.locator('a[href$="thread='+encodeURIComponent(threads[1]!)+'"]').click();
 await expect(page.getByTestId('thread-section')).not.toContainText('First thread retained text',{timeout:1500});
 await expect(page.getByTestId('thread-section')).toContainText('Read failed');
 await expect(page.getByTestId('thread-section')).toContainText('/threads/'+threads[1]);
 await expect(page.getByRole('button',{name:'Load more thread history'})).toHaveCount(0);
});
test('network fault fixture: latest page cursor stays with the latest rendered events',async({page})=>{
 await login(page);
 const observed=await page.evaluate(async()=>await (await fetch('/v2/workspaces/ws_example/events')).json()) as {data:Array<Record<string,unknown>>;page:Record<string,unknown>;request_id:string};
 expect(observed.data.length).toBeGreaterThan(0);
 let calls=0,requestedCursor:string|null=null,releaseOlder!:()=>void;
 const olderHeld=new Promise<void>(resolve=>{releaseOlder=resolve;});
 await page.route('**/v2/workspaces/ws_example/events*',async route=>{
  const url=new URL(route.request().url());++calls;
  if(url.searchParams.has('cursor')){
   requestedCursor=url.searchParams.get('cursor');
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...observed,data:[],page:{has_more:false,next_cursor:null},request_id:'page_tail'})});return;
  }
  const older=calls===1;if(older)await olderHeld;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...observed,data:[{...observed.data[0],sequence:older?11:22}],page:{has_more:true,next_cursor:older?'older_cursor':'newer_cursor'},request_id:older?'older_read':'newer_read'})});
 });
 try{
  await page.getByRole('button',{name:'Refresh reads'}).click();await expect.poll(()=>calls).toBe(1);
  await page.getByRole('button',{name:'Refresh reads'}).click();
  await expect(page.getByTestId('events-section')).toContainText('Sequence 22');
  const olderResponse=page.waitForResponse(response=>response.url().endsWith('/events')&&response.status()===200);
  releaseOlder();await olderResponse;
  // Let the browser consume the deliberately delayed older response.
  await page.waitForTimeout(100);
  await expect(page.getByTestId('events-section')).toContainText('Sequence 22');
  await page.getByRole('button',{name:'Load more activity'}).click();
  await expect.poll(()=>requestedCursor).toBe('newer_cursor');
 }finally{releaseOlder();}
});
