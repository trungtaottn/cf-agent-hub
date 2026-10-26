import type {AuthSessionResponse,ProfileDataResponse} from '../../src/http/dto';
import {test,expect,appOrigin} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';

test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'fresh');});

async function restrictNavigation(page:import('@playwright/test').Page){
 return page.evaluate(async()=>{
  const session=(await (await fetch('/v2/workspaces/ws_example/auth/session')).json() as AuthSessionResponse).data;
  const current=(await (await fetch('/v2/workspaces/ws_example/profile')).json() as ProfileDataResponse).data;
  current.profile.navigation.visible_views=['overview'];
  const result=await fetch('/v2/workspaces/ws_example/profile',{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':session.csrf_token,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({profile:current.profile,expected_profile_revision:current.profile_revision})});
  if(!result.ok)throw Error('FIXTURE_PROFILE_WRITE_FAILED_'+result.status);
 });
}

test('removing a focused navigation link moves focus to a stable fallback',async({page})=>{
 await login(page);
 const activity=page.getByRole('link',{name:'Activity',exact:true});
 await expect(activity).toBeVisible();
 await restrictNavigation(page);
 await activity.focus();
 await page.getByRole('button',{name:'Refresh reads'}).evaluate(button=>(button as HTMLButtonElement).click());
 await expect(activity).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Overview',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Workspace overview'})).toBeVisible();
});

test('hidden activity remains an authorized deep link until current authority is revoked',async({page})=>{
 await login(page);await restrictNavigation(page);
 await page.goto(appOrigin+'/activity?workspace=ws_example');
 await expect(page.getByRole('link',{name:'Activity',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('events-section')).toHaveAttribute('data-status','ready');
 await fixtureControl(page,'restrict-overrides');
 await page.getByRole('button',{name:'Refresh reads'}).click();
 await expect(page.getByTestId('session-status')).toContainText('Access denied');
 await expect(page.getByTestId('events-section')).toHaveAttribute('data-status','forbidden');
 await expect(page.getByTestId('events-section')).not.toContainText('Workspace profile updated');
});

test('stale profile keeps last observed navigation without granting another workspace',async({page})=>{
 await login(page);await restrictNavigation(page);await page.reload();
 await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByTestId('profile-read-state')).toHaveAttribute('data-status','ready');
 await expect(page.getByRole('link',{name:'Activity',exact:true})).toHaveCount(0);
 await page.route('**/v2/workspaces/ws_example/profile',route=>route.abort('internetdisconnected'));
 await page.getByRole('button',{name:'Refresh reads'}).click();
 await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByTestId('profile-read-state')).toHaveAttribute('data-status','stale');
 await expect(page.getByRole('link',{name:'Activity',exact:true})).toHaveCount(0);
 const denied=await page.goto(appOrigin+'/overview?workspace=ws_other');
 expect(denied?.status()).toBe(404);
 await expect(page.locator('body')).toContainText('NOT_FOUND');
 await expect(page.locator('body')).not.toContainText('Profile revision');
 await expect(page.getByTestId('workspace-name')).toHaveCount(0);
});

test('without an observed profile only supported defaults appear and missing navigation is rejected',async({page})=>{
 await page.route('**/v2/workspaces/ws_example/profile',route=>route.abort('internetdisconnected'));
 await login(page);
 await expect(page.getByRole('link',{name:'Activity',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Settings',exact:true})).toBeVisible();
 for(const name of ['Agents','Tasks','Approvals','Kanban'])await expect(page.getByRole('link',{name,exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByTestId('profile-read-state')).toHaveAttribute('data-status','disconnected');
 await page.unroute('**/v2/workspaces/ws_example/profile');
 await page.getByRole('button',{name:'Refresh reads'}).click();
 await expect(page.getByTestId('profile-read-state')).toHaveAttribute('data-status','ready');
 await page.getByText('Edit complete portable profile').click();
 const editor=page.getByLabel('Portable profile JSON',{exact:true}),draft=JSON.parse(await editor.inputValue());
 delete draft.navigation.visible_views;
 let writes=0;
 await page.route('**/v2/workspaces/ws_example/profile:preview',async route=>{++writes;await route.continue();});
 await editor.fill(JSON.stringify(draft));
 await page.getByRole('button',{name:'Preview profile',exact:true}).click();
 await expect(page.getByTestId('profile-result')).toContainText('/profile/navigation/visible_views');
 expect(writes).toBe(0);
});
