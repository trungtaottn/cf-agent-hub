import type {Page} from '@playwright/test';
import type {AuthSessionResponse,ProfileDataResponse} from '../../src/http/dto';
import {test,expect,appOrigin,issuerOrigin,readFixtureRoute} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';

const title={review:'Review evidence <img src=x onerror="window.fixtureInjected=1">',history:'Requeued retained result',doing:'Active execution observation',done:'Independently accepted result',cancelled:'Cancelled retained task'};
test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'r2-board');});
async function openBoard(page:Page){await login(page,'/tasks');await expect(page.getByRole('heading',{name:'Workspace tasks',exact:true})).toBeVisible();}
async function hideBoard(page:Page){await page.evaluate(async()=>{
 const session=(await (await fetch('/v2/workspaces/ws_example/auth/session')).json() as AuthSessionResponse).data;
 const profile=(await (await fetch('/v2/workspaces/ws_example/profile')).json() as ProfileDataResponse).data;
 profile.profile.navigation.visible_views=['overview','activity'];
 const response=await fetch('/v2/workspaces/ws_example/profile',{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':session.csrf_token,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({profile:profile.profile,expected_profile_revision:profile.profile_revision})});
 if(!response.ok)throw Error('FIXTURE_HIDE_BOARD_FAILED');
 });}

test('six_columns_and_authorized_cancelled_archive_reload',async({page})=>{
 await openBoard(page);
 for(const state of ['backlog','ready','doing','waiting','review','done','cancelled'])await expect(page.getByTestId('tasks-'+state)).toBeVisible();
 await expect(page.getByTestId('tasks-cancelled')).toContainText(title.cancelled);
 await expect(page.getByTestId('tasks-done')).toContainText(title.done);
 await fixtureControl(page,'restart');await page.reload();
 await expect(page.getByTestId('tasks-cancelled')).toContainText(title.cancelled);
 await expect(page.getByTestId('tasks-review')).toContainText(title.review);
});
test('partial_page_not_workspace_total',async({page})=>{
 await openBoard(page);const backlog=page.getByTestId('tasks-backlog');
 await expect(backlog.locator('a')).toHaveCount(20);await expect(backlog).toContainText('not a workspace total');
 await page.getByRole('button',{name:'Next Backlog page',exact:true}).click();
 await expect(backlog.locator('a')).toHaveCount(3);await expect(backlog).not.toContainText('Backlog item 01');
 await page.getByRole('button',{name:'Refresh reads',exact:true}).click();await expect(backlog.locator('a')).toHaveCount(20);
});
test('section_failure_preserves_other_reads',async({page})=>{
 await page.route('**/v2/workspaces/ws_example/tasks?*',route=>new URL(route.request().url()).searchParams.get('state')==='ready'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'DEPENDENCY_UNAVAILABLE',message:'Synthetic transport fault',retryable:true,request_id:'fixture-ready-fault'}})}):route.continue());
 await openBoard(page);await expect(page.getByTestId('tasks-ready')).toHaveAttribute('data-status','error');
 await expect(page.getByTestId('tasks-ready')).toContainText('DEPENDENCY_UNAVAILABLE');await expect(page.getByTestId('tasks-backlog').locator('a')).toHaveCount(20);
 await expect(page.getByTestId('tasks-done')).toContainText(title.done);
});
test('historical_result_labeled_after_requeue_with_unchanged_latest_run',async({page})=>{
 await openBoard(page);await page.getByRole('link',{name:title.history,exact:true}).click();
 await expect(page.getByRole('heading',{name:'Task detail',exact:true,level:1})).toBeVisible();
 await expect(page.getByTestId('task-detail')).toContainText('No current result');
 await expect(page.getByTestId('task-results')).toContainText('Prior submitted result retained after requeue');
 await expect(page.getByTestId('task-results')).toContainText(/historical|retained/i);
 await fixtureControl(page,'restart');await page.reload();await expect(page.getByTestId('task-results')).toContainText('Prior submitted result retained after requeue');
});
test('bounded_workspace_event_page_does_not_claim_absent_acceptance',async({page})=>{
 await openBoard(page);await page.getByRole('link',{name:title.done,exact:true}).click();
 const detail=page.getByTestId('task-detail'),events=page.getByTestId('task-events');
 await expect(events).toHaveAttribute('data-status','empty');
 await expect(detail).toContainText('absence is not proof');
 await expect(events).toContainText('bounded workspace event page');
 const acceptance=detail.getByText(/^Acceptance evidence:/),next=page.getByRole('button',{name:'Next events page',exact:true});
 // This fixture emits fewer than 80 events; each click replaces one 20-item page.
 for(let pageNumber=0;pageNumber<4&&!await acceptance.isVisible();pageNumber++){
  await expect(next).toBeEnabled();
  const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/v2/workspaces/ws_example/events');
  await next.click();await read;await expect(events).not.toHaveAttribute('data-status','loading');
 }
 await expect(acceptance).toContainText('human_operator');await expect(events).not.toContainText('Task cancelled.');
});
test('task_404_purges_cached_board_card_and_detail_children',async({page})=>{
 await openBoard(page);await page.getByRole('link',{name:title.review,exact:true}).click();
 await expect(page.getByTestId('task-artifacts')).toContainText('<svg onload="window.fixtureInjected=2">.txt');
 const id=new URL(page.url()).searchParams.get('task')!;
 await page.route('**/v2/workspaces/ws_example/tasks/'+id,route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{code:'NOT_FOUND',message:'Synthetic resource disappearance',retryable:false,request_id:'fixture-task-404'}})}));
 await page.getByRole('button',{name:'Refresh reads',exact:true}).click();
 await expect(page.getByTestId('task-detail')).toContainText('NOT_FOUND');
 await expect(page.locator('#view')).not.toContainText('Current submitted result');
 await expect(page.locator('#view')).not.toContainText('<svg onload="window.fixtureInjected=2">.txt');
 await page.getByRole('button',{name:'Back to task board',exact:true}).click();
 await expect(page.getByRole('link',{name:title.review,exact:true})).toHaveCount(0);
});
test('runtime_presence_not_execution_lease_and_waiting_controls_r3_unavailable',async({page})=>{
 await openBoard(page);const waiting=page.getByTestId('tasks-waiting');await expect(waiting).toContainText(/unavailable|R3/i);
 await expect(waiting.getByRole('button')).toHaveCount(2);
 for(const control of await waiting.getByRole('button').all())await expect(control).toBeDisabled();
 await page.getByRole('link',{name:title.doing,exact:true}).click();
 await expect(page.getByTestId('task-run')).toContainText(/lease/i);
 await expect(page.getByTestId('task-run')).toContainText('Unavailable — no public runtime presence read');
 await expect(page.getByTestId('task-run')).not.toContainText('Runtime online');
});
test('escaped_task_artifact_names_are_literal_text',async({page})=>{
 await openBoard(page);await page.getByRole('link',{name:title.review,exact:true}).click();
 await expect(page.getByTestId('task-artifacts')).toContainText('<svg onload="window.fixtureInjected=2">.txt');
 await expect(page.locator('#view img,#view svg,#view script')).toHaveCount(0);
 expect(await page.evaluate(()=>Object.hasOwn(window,'fixtureInjected'))).toBe(false);
 await expect(page.getByTestId('task-results')).toContainText('Current submitted result');
});
test('tasks_only_scope_has_no_optional_event_or_artifact_requests',async({page,context})=>{
 await context.addCookies([{name:'cfhub_fixture_subject',value:'tasks-only-subject',url:issuerOrigin,secure:true}]);
 const optional:string[]=[];page.on('request',request=>{if(/\/events(?:\?|$)|\/artifacts\//.test(request.url()))optional.push(request.url());});
 await login(page,'/tasks','human_tasks_only');await page.getByRole('link',{name:title.history,exact:true}).click();
 await expect(page.getByTestId('task-detail')).toContainText(title.history);await expect(page.getByTestId('task-events')).toContainText(/unavailable/i);
 expect(optional).toEqual([]);await expect(page.getByTestId('session-status')).toContainText('human_tasks_only');
});
test('hidden_board_does_not_pause_engine_and_focus_falls_back',async({page})=>{
 await openBoard(page);await hideBoard(page);const navigation=page.getByRole('link',{name:'Tasks',exact:true});await navigation.focus();
 await page.getByRole('button',{name:'Refresh reads',exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
 await expect(navigation).toHaveCount(0);await expect(page.getByRole('link',{name:'Overview',exact:true})).toBeFocused();
 await fixtureControl(page,'r2-advance-backlog');await page.goto(appOrigin+'/tasks?workspace=ws_example');
 await expect(page.getByTestId('tasks-ready')).toContainText('Backlog item 01');await expect(navigation).toHaveCount(0);
});
test('profile_default_alias_and_hidden_fallback_preserve_settings_draft',async({page})=>{
 await openBoard(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByLabel('Default view',{exact:true}).selectOption('kanban');await page.getByRole('button',{name:'Save preferences',exact:true}).click();
 await expect(page.getByTestId('preferences-result')).toContainText('Preferences saved');
 await expect(page.getByTestId('preference-policy')).not.toContainText('VIEW_UNAVAILABLE');
 await page.goto(appOrigin+'/?workspace=ws_example');await expect(page.getByRole('heading',{name:'Workspace tasks',exact:true})).toBeVisible();
 await hideBoard(page);await page.goto(appOrigin+'/?workspace=ws_example');await expect(page.getByRole('heading',{name:'Workspace overview',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Theme',{exact:true}).selectOption('dark');
 await page.getByRole('button',{name:'Refresh reads',exact:true}).click();await expect(page.getByLabel('Theme',{exact:true})).toHaveValue('dark');
});
test('revoked_resource_removed_and_late_response_ignored',async({page})=>{
 await openBoard(page);let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let held=0,settled=0;
 await page.route('**/v2/workspaces/ws_example/tasks/*/results*',async route=>{const response=await readFixtureRoute(route);++held;await barrier;await route.fulfill(response);++settled;});
 try{
  await page.getByRole('link',{name:title.history,exact:true}).click();await expect.poll(()=>held).toBe(1);
  await fixtureControl(page,'r2-revoke-human');await page.getByRole('button',{name:'Refresh reads',exact:true}).click();
  await expect(page.getByTestId('session-status')).toContainText('Access denied');release();await expect.poll(()=>settled).toBe(1);
  await expect(page.locator('#view')).not.toContainText('Prior submitted result retained after requeue');
  await expect(page.locator('#view')).not.toContainText(title.review);
 }finally{release();}
});
test('keyboard_narrow_screen_headings_and_state_text',async({page})=>{
 await page.setViewportSize({width:360,height:760});await openBoard(page);
 const tasks=page.getByRole('link',{name:'Tasks',exact:true});await tasks.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#main')).toBeFocused();
 for(const state of ['backlog','ready','doing','waiting','review','done','cancelled'])await expect(page.getByTestId('tasks-'+state).getByRole('heading',{level:2})).toBeVisible();
 await expect(page.getByTestId('tasks-backlog')).toContainText(/response|observed/i);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'.superpowers/r1-completion/screenshots/r2-kanban-narrow.png',fullPage:true});
});

test('narrow_task_detail_wraps_long_canonical_text',async({page})=>{
 await page.setViewportSize({width:360,height:760});await openBoard(page);
 const longText='SyntheticLongWord'.repeat(80);
 await page.route('**/v2/workspaces/ws_example/tasks/*',async route=>{
  if(route.request().method()!=='GET'||new URL(route.request().url()).pathname.endsWith('/results')){await route.continue();return;}
  const response=await readFixtureRoute(route),body=JSON.parse(response.body.toString('utf8'));
  if(body.data?.title)body.data={...body.data,title:longText,description:longText};
  await route.fulfill({...response,body:JSON.stringify(body)});
 });
 await page.getByRole('link',{name:title.review,exact:true}).click();
 await expect(page.getByTestId('task-detail')).toContainText(longText);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
