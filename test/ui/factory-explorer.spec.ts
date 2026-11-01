import type {Page} from '@playwright/test';
import type {AuthSessionResponse,ProfileDataResponse} from '../../src/http/dto';
import {test,expect,appOrigin,issuerOrigin,readFixtureRoute} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';
const review='Review evidence <img src=x onerror="window.fixtureInjected=1">';
async function factory(page:Page){await login(page,'/tasks');await page.getByRole('button',{name:'Factory evidence',exact:true}).click();await expect(page.getByTestId('factory-explorer')).toBeVisible();}
test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'r2-board');});

test('factory_is_explicit_transient_readonly_and_bounded',async({page})=>{
 await login(page,'/tasks');await expect(page.getByTestId('task-board')).toBeVisible();await expect(page.getByTestId('factory-explorer')).toHaveCount(0);
 const writes:string[]=[],detailReads:string[]=[];page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/v2/')&&r.method()!=='GET')writes.push(path);if(/\/tasks\/[^/]+|\/runs\/|\/artifacts\//.test(path))detailReads.push(path);});
 await page.getByRole('button',{name:'Factory evidence',exact:true}).click();
 for(const state of ['backlog','ready','doing','waiting','review','done','cancelled'])await expect(page.getByTestId('factory-tasks-'+state)).toBeVisible();
 for(const surface of ['factory-overview','factory-workstation','factory-evidence'])await expect(page.getByTestId(surface)).toBeVisible();
 await expect(page.getByTestId('factory-tasks-backlog')).toContainText('not a workspace total');expect(detailReads).toEqual([]);
 await page.getByRole('button',{name:'Next Backlog page',exact:true}).click();await expect(page.getByTestId('factory-tasks-backlog').getByRole('link')).toHaveCount(3);
 expect(writes).toEqual([]);await page.reload();await expect(page.getByTestId('task-board')).toBeVisible();await expect(page.getByTestId('factory-explorer')).toHaveCount(0);
});
test('workstation_and_qc_keep_current_historical_and_unavailable_distinct',async({page})=>{
 await factory(page);await page.getByRole('link',{name:'Requeued retained result',exact:true}).click();
 await expect(page.getByTestId('factory-workstation')).toContainText('Runtime presence: Unavailable');
 await expect(page.getByTestId('factory-evidence')).toContainText('Prior submitted result retained after requeue');
 await expect(page.getByTestId('factory-evidence')).toContainText(/historical/i);
 await expect(page.getByTestId('factory-workstation')).not.toContainText('Runtime online');
 await page.getByRole('button',{name:'Open existing task controls',exact:true}).click();
 await expect(page.getByTestId('task-detail')).toBeVisible();await expect(page.getByTestId('factory-explorer')).toHaveCount(0);
});
test('retained_waiting_is_read_fixture_not_new_approval_authority',async({page})=>{
 await fixtureControl(page,'factory-retained-waiting');await factory(page);
 const waiting=page.getByTestId('factory-tasks-waiting');await expect(waiting).toContainText('Seeded retained Waiting');
 await waiting.getByRole('link').click();await expect(page.getByTestId('factory-explorer')).toContainText(/human decision execution is not implemented/);
 for(const name of ['Approve','Reject'])for(const control of await page.getByTestId('factory-explorer').getByRole('button',{name,exact:true}).all())await expect(control).toBeDisabled();
});
test('hostile_names_are_inert_and_optional_failure_is_not_empty',async({page})=>{
 await page.route('**/v2/workspaces/ws_example/artifacts/*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'DEPENDENCY_UNAVAILABLE',message:'Synthetic artifact fault',retryable:true,request_id:'factory-artifact-fault'}})}));
 await factory(page);await page.getByRole('link',{name:review,exact:true}).click();
 await expect(page.getByTestId('factory-explorer')).toContainText(review);await expect(page.getByTestId('task-artifacts')).toHaveAttribute('data-status','error');
 await expect(page.getByTestId('task-results')).toContainText('Current submitted result');
 await expect(page.locator('#view img,#view svg,#view script')).toHaveCount(0);expect(await page.evaluate(()=>Object.hasOwn(window,'fixtureInjected'))).toBe(false);
});
test('tasks_only_principal_has_no_optional_reads_or_hidden_department_metadata',async({page,context})=>{
 await context.addCookies([{name:'cfhub_fixture_subject',value:'tasks-only-subject',url:issuerOrigin,secure:true}]);
 const optional:string[]=[];page.on('request',r=>{if(/\/events(?:\?|$)|\/artifacts\//.test(r.url()))optional.push(r.url());});
 await login(page,'/tasks','human_tasks_only');await page.getByRole('button',{name:'Factory evidence',exact:true}).click();await page.getByRole('link',{name:'Requeued retained result',exact:true}).click();
 await expect(page.getByTestId('task-events')).toContainText(/unavailable/i);expect(optional).toEqual([]);await expect(page.getByTestId('session-status')).toContainText('human_tasks_only');
});
test('revocation_clears_factory_and_late_private_result_cannot_return',async({page})=>{
 await factory(page);let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});let held=0,settled=0;
 await page.route('**/v2/workspaces/ws_example/tasks/*/results*',async route=>{const response=await readFixtureRoute(route);held++;await barrier;await route.fulfill(response);settled++;});
 try{await page.getByRole('link',{name:'Requeued retained result',exact:true}).click();await expect.poll(()=>held).toBe(1);await fixtureControl(page,'r2-revoke-human');await page.getByRole('button',{name:'Refresh reads',exact:true}).click();await expect(page.getByTestId('session-status')).toContainText('Access denied');release();await expect.poll(()=>settled).toBe(1);await expect(page.getByTestId('factory-explorer')).toHaveCount(0);await expect(page.locator('#view')).not.toContainText('Prior submitted result retained after requeue');}finally{release();}
});
test('keyboard_narrow_reducedmotion_surfaces_are_not_graph_only',async({page})=>{
 await page.setViewportSize({width:360,height:760});await page.emulateMedia({reducedMotion:'reduce'});await login(page,'/tasks');
 await expect(page.getByRole('button',{name:'Factory evidence',exact:true})).toBeEnabled();
 const toggle=page.getByRole('button',{name:'Task board',exact:true});await toggle.focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Factory evidence',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.getByTestId('factory-overview')).toBeVisible();await page.keyboard.press('Tab');await expect(page.getByLabel('Project filter',{exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByLabel('Work role filter',{exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(page.getByLabel('Project filter',{exact:true})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('optional403_is_local_and_existing_accept_rechecks_fresh_session',async({page})=>{
 await factory(page);
 await page.route('**/v2/workspaces/ws_example/artifacts/*',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'FORBIDDEN',message:'Synthetic optional resource denial',retryable:false,request_id:'factory-artifact-denied'}})}));
 await page.getByRole('link',{name:review,exact:true}).click();await expect(page.getByTestId('task-artifacts')).toHaveAttribute('data-status','forbidden');await expect(page.getByTestId('task-results')).toContainText('Current submitted result');await expect(page.getByTestId('session-status')).toContainText('human_operator');
 await page.getByRole('button',{name:'Open existing task controls',exact:true}).click();
 const detail=page.getByTestId('task-detail');await detail.getByRole('button',{name:/Actions for/}).click();
 const authRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/v2/workspaces/ws_example/auth/session');await detail.getByRole('button',{name:'Accept result',exact:true}).click();await authRead;
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Reason',{exact:true}).fill('Independent explicit acceptance after optional evidence denial');await expect(dialog.getByRole('button',{name:'Confirm command',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Confirm command',exact:true}).click();await expect(dialog).toContainText('Server confirmed');
});
test('profile403_clears_old_department_labels_without_erasing_task_reads',async({page})=>{
 await factory(page);await expect(page.locator('#workspace-name')).not.toBeEmpty();
 await page.route('**/v2/workspaces/ws_example/profile',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'FORBIDDEN',message:'Synthetic profile denial',retryable:false,request_id:'factory-profile-denied'}})}));
 await page.getByRole('button',{name:'Refresh reads',exact:true}).click();await expect(page.getByTestId('factory-profile')).toHaveAttribute('data-status','forbidden');await expect(page.locator('#workspace-name')).toBeEmpty();await expect(page.getByTestId('factory-tasks-backlog').getByRole('link')).toHaveCount(20);await expect(page.getByTestId('session-status')).toContainText('human_operator');
});
test('event403_on_explicit_refresh_is_section_local_not_whole_session_denial',async({page})=>{
 await factory(page);await page.getByRole('link',{name:review,exact:true}).click();await expect(page.getByTestId('task-results')).toContainText('Current submitted result');
 await page.route('**/v2/workspaces/ws_example/events*',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'FORBIDDEN',message:'Synthetic event denial',retryable:false,request_id:'factory-event-denied'}})}));
 await page.getByRole('button',{name:'Refresh reads',exact:true}).click();await expect(page.getByTestId('task-events')).toHaveAttribute('data-status','forbidden');await expect(page.getByTestId('task-results')).toContainText('Current submitted result');await expect(page.getByTestId('factory-explorer')).toBeVisible();await expect(page.getByTestId('session-status')).toContainText('human_operator');
});

test('profile_denial_clears_orphan_filter_ids_and_restores_unfiltered_rows',async({page})=>{
 await factory(page);
 await page.evaluate(async()=>{
  const session=(await (await fetch('/v2/workspaces/ws_example/auth/session')).json() as AuthSessionResponse).data;
  const current=(await (await fetch('/v2/workspaces/ws_example/profile')).json() as ProfileDataResponse).data;
  current.profile.projects.push({id:'factory_private_project',display_name:'Private factory department',description:'Synthetic profile-only reference',archived:false});
  current.profile.work_roles.push({id:'factory_private_role',display_name:'Private factory role',description:'Synthetic profile-only reference',archived:false});
  const response=await fetch('/v2/workspaces/ws_example/profile',{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':session.csrf_token,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({profile:current.profile,expected_profile_revision:current.profile_revision})});if(!response.ok)throw Error('FACTORY_PROFILE_SETUP_FAILED');
 });
 await page.getByRole('button',{name:'Refresh reads',exact:true}).click();const project=page.getByLabel('Project filter',{exact:true}),role=page.getByLabel('Work role filter',{exact:true});
 await project.selectOption('factory_private_project');await role.selectOption('factory_private_role');await expect(page.getByTestId('factory-tasks-backlog').getByRole('link')).toHaveCount(0);
 await page.route('**/v2/workspaces/ws_example/profile',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'FORBIDDEN',message:'Synthetic profile denial',retryable:false,request_id:'factory-filter-denied'}})}));
 await page.getByRole('button',{name:'Refresh reads',exact:true}).click();await expect(page.getByTestId('factory-profile')).toHaveAttribute('data-status','forbidden');await expect(project).toHaveValue('');await expect(role).toHaveValue('');
 await expect(page.locator('#view option[value="factory_private_project"],#view option[value="factory_private_role"]')).toHaveCount(0);await expect(page.getByTestId('factory-explorer')).not.toContainText('Private factory department');await expect(page.getByTestId('factory-tasks-backlog').getByRole('link')).toHaveCount(20);
 await role.selectOption('');await expect(project).toHaveValue('');
});
