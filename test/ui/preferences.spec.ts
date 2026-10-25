import {test,expect,appOrigin,issuerOrigin} from '../helpers/browser';
import {login,screenshot,fixtureControl} from '../helpers/ui';
test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'fresh');});
test('restricted human has a read-only profile while own preference drafts remain usable',async({page,context})=>{
 await context.addCookies([{name:'cfhub_fixture_subject',value:'restricted-subject',url:issuerOrigin,secure:true}]);
 await login(page,'/overview','human_restricted');await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByLabel('Workspace display name',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('Workspace description',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('Accent',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('Portable profile JSON',{exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Preview profile',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Apply previewed profile',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Export portable profile',exact:true})).toBeDisabled();
 await expect(page.getByTestId('profile-authorization')).toContainText('Read-only');
 await page.getByLabel('Theme',{exact:true}).selectOption('dark');
 await page.getByRole('button',{name:'Refresh reads'}).click();
 await expect(page.getByTestId('preferences-read-state')).toHaveAttribute('data-status','ready');
 await expect(page.getByLabel('Theme',{exact:true})).toHaveValue('dark');
 await page.getByRole('button',{name:'Save preferences'}).click();
 await expect(page.getByTestId('preferences-result')).toContainText('Preferences saved');
 await expect(page.getByTestId('session-status')).toContainText('human_restricted');
 await expect(page.getByRole('button',{name:'Preview profile',exact:true})).toBeDisabled();
});
test('profile editing stays disabled until current workspace scopes arrive',async({page})=>{
 let release!:()=>void,heldRequests=0;
 const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/v2/workspaces/ws_example',async route=>{++heldRequests;await held;await route.continue();});
 try{
  await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
  await expect.poll(()=>heldRequests).toBe(1);
  await expect(page.getByLabel('Workspace display name',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Preview profile',exact:true})).toBeDisabled();
  await page.getByLabel('Theme',{exact:true}).selectOption('dark');
  release();
  await expect(page.getByRole('button',{name:'Preview profile',exact:true})).toBeEnabled();
  await expect(page.getByLabel('Workspace display name',{exact:true})).toBeEnabled();
  await expect(page.getByLabel('Theme',{exact:true})).toHaveValue('dark');
 }finally{release();}
});

test('network fault fixture: failed profile read preserves working preferences and reports section evidence',async({page})=>{
 const profileRoute='**/v2/workspaces/ws_example/profile';
 await page.route(profileRoute,route=>route.request().method()==='GET'
  ?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'DEPENDENCY_UNAVAILABLE',message:'Dependency unavailable',retryable:true,request_id:'profile-partial-fault'}})})
  :route.continue());
 await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByLabel('Theme',{exact:true})).toBeVisible();
 await expect(page.getByTestId('profile-read-state')).toHaveAttribute('data-status','error');
 await expect(page.getByTestId('profile-read-state')).toContainText('Read failed');
 await expect(page.getByTestId('profile-read-state')).toContainText('/v2/workspaces/ws_example/profile');
 await expect(page.getByTestId('profile-read-state')).toContainText('profile-partial-fault');
 await expect(page.getByTestId('profile-read-state')).toContainText('DEPENDENCY_UNAVAILABLE');
 await expect(page.getByTestId('preferences-read-state')).toHaveAttribute('data-status','ready');
 await page.getByLabel('Theme',{exact:true}).selectOption('dark');
 await page.getByRole('button',{name:'Save preferences'}).click();
 await expect(page.getByTestId('preferences-result')).toContainText('Preferences saved');
 await expect(page.getByTestId('profile-read-state')).toHaveAttribute('data-status','error');
 await page.unroute(profileRoute);await page.getByRole('button',{name:'Refresh reads'}).click();
 await expect(page.getByLabel('Workspace display name',{exact:true})).toBeVisible();
 await expect(page.getByTestId('profile-read-state')).toHaveAttribute('data-status','ready');
 await expect(page.getByLabel('Theme',{exact:true})).toHaveValue('dark');
});

test('keyboard_theme_density_and_fallback_view persist through real HTTP',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your preferences'})).toBeVisible();
 await page.getByLabel('Theme',{exact:true}).selectOption('dark');
 await page.getByLabel('Density',{exact:true}).selectOption('compact');
 await page.getByLabel('Default view',{exact:true}).selectOption('inbox');
 await page.getByRole('button',{name:'Save preferences'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('preferences-result')).toContainText('Preferences saved');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('html')).toHaveAttribute('data-density','compact');
 await expect(page.getByTestId('preference-policy')).toContainText('VIEW_UNAVAILABLE');
 await screenshot(page,'dark-compact-keyboard');
 await page.reload();await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByLabel('Theme',{exact:true})).toHaveValue('dark');
 await page.getByLabel('Theme',{exact:true}).selectOption('light');
 await page.getByRole('button',{name:'Save preferences'}).click();
 await expect(page.getByTestId('preferences-result')).toContainText('Preferences saved');
 await screenshot(page,'light-settings');
});
test('network fault fixture: uncertain preference write replays exact key/body and prevents changed intent',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 const writes:{key:string|null;body:string|null}[]=[];
 await page.route('**/v2/workspaces/ws_example/preferences',async route=>{
  if(route.request().method()!=='PUT'){await route.continue();return;}
  writes.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
  await route.continue();
 });
 // Fixture drops all matching HTTPS responses after commit until explicitly resumed, including browser transport retries. Application replay remains manual.
 await fixtureControl(page,'drop-next-preferences-response');
 await page.getByLabel('Theme',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'Save preferences'}).click();
 await expect(page.getByTestId('preferences-result')).toContainText('Outcome uncertain');
 await expect(page.getByLabel('Theme',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Save preferences'})).toBeDisabled();
 const attemptsBeforeReplay=writes.length;await fixtureControl(page,'resume-preferences-responses');
 await page.getByRole('button',{name:'Reconcile original preferences write'}).click();
 await expect(page.getByTestId('preferences-result')).toContainText('Preferences saved');
 expect(writes.length).toBe(attemptsBeforeReplay+1);expect(writes.length).toBeGreaterThanOrEqual(2);
 for(const write of writes)expect(write).toEqual(writes[0]);
});
test('profile preview/apply/export use authoritative revisions and text-safe labels',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 const label='<svg onload=alert(1)> Long profile label';
 await page.getByLabel('Workspace display name',{exact:true}).fill(label);
 await page.getByRole('button',{name:'Preview profile'}).click();
 await expect(page.getByTestId('profile-preview')).toContainText('display_name');
 await page.getByRole('button',{name:'Apply previewed profile'}).click();
 await expect(page.getByTestId('profile-result')).toContainText('Profile saved');
 await expect(page.getByTestId('profile-expected-revision')).toContainText('2');
 await expect(page.getByTestId('workspace-name')).toHaveText(label);
 expect(await page.locator('svg').count()).toBe(0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export portable profile'}).click();expect((await download).suggestedFilename()).toBe('workspace-profile.json');
});
test('network fault fixture: version conflict requires manual revision review',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByLabel('Workspace display name',{exact:true}).fill('My proposed label');
 await page.getByRole('button',{name:'Preview profile'}).click();
 await page.route('**/v2/workspaces/ws_example/profile',async route=>{
  if(route.request().method()==='PUT')await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'VERSION_CONFLICT',message:'Resource version changed',retryable:false,request_id:'conflict',details:{current_revision:99}}})});else await route.continue();
 });
 await page.getByRole('button',{name:'Apply previewed profile'}).click();
 await expect(page.getByTestId('profile-result')).toContainText('Revision changed');
 await expect(page.getByTestId('profile-result')).toContainText('99');
 await expect(page.getByRole('button',{name:'Apply previewed profile'})).toBeDisabled();
 await expect(page.getByLabel('Workspace display name',{exact:true})).toHaveValue('My proposed label');
 await expect(page.getByRole('button',{name:'Review current profile revision'})).toBeVisible();
});

test('real policy restrictions disable overrides with a visible explanation',async({page})=>{
 await login(page);await fixtureControl(page,'restrict-overrides');await page.reload();
 await expect(page.getByTestId('session-status')).toContainText('Access denied');
 await expect(page.getByTestId('configuration-section')).not.toContainText('Profile revision');
 await login(page);
 await page.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(page.getByTestId('preference-policy')).toContainText('Allowed overrides: None');
 await expect(page.getByLabel('Theme',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('Density',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('Default view',{exact:true})).toBeDisabled();
 await screenshot(page,'policy-restricted');
});
test('background read completion preserves focused navigation and keyboard activation',async({page})=>{
 let release!:()=>void,heldRequests=0;
 const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/v2/workspaces/ws_example/operations',async route=>{++heldRequests;await held;await route.continue();});
 try{
  await login(page);await expect.poll(()=>heldRequests).toBe(1);
  const settings=page.getByRole('link',{name:'Settings',exact:true});await settings.focus();
  await expect(settings).toBeFocused();release();
  await expect(page.getByTestId('operations-section')).toHaveAttribute('data-status','ready');
  await expect(settings).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Workspace settings',exact:true})).toBeVisible();
  await expect(page.getByLabel('Workspace display name',{exact:true})).toBeVisible();
 }finally{release();}
});
test('narrow screen, reduced motion and keyboard path keep hostile labels usable',async({page})=>{
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
 await login(page);await page.keyboard.press('Tab');
 await expect(page.getByRole('link',{name:'Skip to workspace content'})).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.getByRole('main')).toBeFocused();
 const settings=page.getByRole('link',{name:'Settings',exact:true});await settings.focus();await page.keyboard.press('Enter');
 await page.getByLabel('Workspace display name',{exact:true}).fill('<script>alert(1)</script>'+ 'LongLabel'.repeat(11));
 await page.getByRole('button',{name:'Preview profile'}).click();await page.getByRole('button',{name:'Apply previewed profile'}).click();
 await expect(page.getByTestId('profile-result')).toContainText('Profile saved');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('script:not([src])').count()).toBe(0);
 await screenshot(page,'narrow-system-dark-keyboard');
});
