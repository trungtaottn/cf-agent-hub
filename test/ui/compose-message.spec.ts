import {test,expect,appOrigin} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';
import type {Page} from '@playwright/test';
// Bounded test-only startup evidence: fixed phases and endpoint/status enums, never bodies or headers.
const diagnostics=new WeakMap<Page,{phase:string;events:string[];omitted:number}>();
function phase(page:Page,value:string){const d=diagnostics.get(page);if(d)d.phase=value;console.log('COMPOSE_PHASE',value);}
function observe(page:Page){const d={phase:'fixture navigation',events:[] as string[],omitted:0};diagnostics.set(page,d);
 const add=(event:string)=>{if(d.events.length<24)d.events.push(event);else d.omitted++;};
 page.on('pageerror',()=>add('page-error'));
 page.on('response',response=>{const path=new URL(response.url()).pathname;const endpoint=path==='/v2/workspaces/ws_example/auth/session'?'session':path==='/v2/workspaces/ws_example'?'workspace':path==='/v2/workspaces/ws_example/agents'?'agents':path==='/__ui_fixture/control'?'fixture-control':null;if(endpoint)add(endpoint+':'+response.status());});
}
async function open(page:Page){phase(page,'composer button readiness');const trigger=page.getByRole('button',{name:'New message',exact:true});await expect(trigger).toBeEnabled();phase(page,'composer click');await trigger.click();phase(page,'composer visible');await expect(page.getByTestId('message-composer')).toBeVisible();phase(page,'recipient visible');await expect(page.getByRole('checkbox',{name:/agent_research/})).toBeVisible();phase(page,'composer ready');}
test.beforeEach(async({page})=>{observe(page);phase(page,'fixture navigation');await page.goto(appOrigin+'/health/live');phase(page,'fixture control');await fixtureControl(page,'r2-board');phase(page,'login');await login(page);phase(page,'login settled');});
test.afterEach(async({page})=>{console.log('COMPOSE_DIAGNOSTIC',JSON.stringify(diagnostics.get(page)??{phase:'not observed'}));});
test('keyboard_composition_creates_one_real_message_and_keeps_delivery_unknown',async({page})=>{
 let posts=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/v2/workspaces/ws_example/messages')posts++;});
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Keyboard <img src=x onerror="window.injected=1">');
 await page.getByRole('button',{name:'Send message',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('message-compose-status')).toContainText('Durably admitted message');await expect(page.getByTestId('message-compose-status')).toContainText('Delivery and recipient ACK are not established');expect(posts).toBe(1);
 await page.getByRole('button',{name:'Read admitted thread',exact:true}).click();await expect(page.getByTestId('thread-section')).toContainText('Keyboard <img');await expect(page.locator('#view img')).toHaveCount(0);
});
test('actual_page_reload_restores_text_and_logout_clears_indexeddb_scope',async({page})=>{
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Private draft survives reload');
 await expect.poll(()=>page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('cfhub-composition-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<string>((resolve,reject)=>{const r=db.transaction('scopes').objectStore('scopes').get(['ws_example','human_operator']);r.onsuccess=()=>resolve(JSON.stringify(r.result));r.onerror=()=>reject(r.error);});}finally{db.close();}})).toContain('Private draft survives reload');
 await page.reload();await open(page);await expect(page.getByLabel('Message text',{exact:true})).toHaveValue('Private draft survives reload');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByTestId('message-composer')).toBeHidden();
 await expect.poll(()=>page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('cfhub-composition-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<string>((resolve,reject)=>{const r=db.transaction('scopes').objectStore('scopes').get(['ws_example','human_operator']);r.onsuccess=()=>resolve(JSON.stringify(r.result?.entries));r.onerror=()=>reject(r.error);});}finally{db.close();}})).toBe('{}');
});
test('lost_transport_and_reload_never_resend_or_replace_the_uncertain_key',async({page})=>{
 const keys:string[]=[];await page.route('**/v2/workspaces/ws_example/messages',async route=>{if(route.request().method()==='POST'){keys.push(route.request().headers()['idempotency-key']!);await route.abort('connectionfailed');}else await route.continue();});
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Unknown transport');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByTestId('message-compose-status')).toContainText('Outcome unknown');
 await page.reload();await open(page);await expect(page.getByTestId('message-compose-status')).toContainText('Outcome unknown');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();expect(keys).toHaveLength(1);const retained=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('cfhub-composition-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<string>((resolve,reject)=>{const r=db.transaction('scopes').objectStore('scopes').get(['ws_example','human_operator']);r.onsuccess=()=>resolve(r.result.entries['message-compose'].intent.key);r.onerror=()=>reject(r.error);});}finally{db.close();}});expect(retained).toBe(keys[0]);
 // Transport abort proves no automatic resend, not a committed-response-loss scenario.
});
test('two_tabs_logout_erases_and_invalidates_other_visible_composer',async({page,context})=>{
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Shared private text');const other=await context.newPage();await other.goto(appOrigin+'/overview?workspace=ws_example');await expect(other.getByTestId('session-status')).toContainText('human_operator');await open(other);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(other.getByTestId('message-composer')).toBeHidden();await expect(other.getByRole('button',{name:'Send message',exact:true})).toBeHidden();await other.close();
});
test('duplicate_form_activation_has_one_real_command_handoff',async({page})=>{
 let count=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/v2/workspaces/ws_example/messages')count++;});await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('One deliberate message');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();await page.getByTestId('message-composer').locator('form').evaluate((form:HTMLFormElement)=>{form.requestSubmit();form.requestSubmit();});await expect(page.getByTestId('message-compose-status')).toContainText('Durably admitted');expect(count).toBe(1);
});
test('changed_session_response_cannot_reveal_cached_private_draft',async({page})=>{
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Old principal private draft');await page.getByRole('link',{name:'Activity',exact:true}).click();
 // Synthetic current-session response change, not a second principal login acceptance test.
 await page.route('**/v2/workspaces/ws_example/auth/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{actor:{kind:'human',principal_id:'different_principal',agent_id:null},csrf_token:'synthetic_changed_session',expires_at:'2030-01-01T00:00:00Z'},request_id:'changed_session'})}));
 await page.getByRole('button',{name:'New message',exact:true}).click();await expect(page.getByTestId('message-composer')).toBeHidden();await expect(page.getByTestId('session-status')).not.toContainText('human_operator');await expect(page.locator('body')).not.toContainText('Old principal private draft');
});

test('reload_then_logout_without_opening_composer_erases_verified_scope',async({page})=>{
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Private unopened reload draft');
 await expect.poll(()=>compositionEntries(page)).toContain('Private unopened reload draft');
 await page.reload();await expect(page.getByTestId('session-status')).toContainText('human_operator');await expect(page.getByTestId('message-composer')).toHaveCount(0);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByTestId('session-status')).not.toContainText('human_operator');
 await expect.poll(()=>compositionEntries(page)).toBe('{}');
});
test('logout_from_unopened_second_tab_erases_scope_and_hides_open_sibling',async({page,context})=>{
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Private sibling draft');
 await expect.poll(()=>compositionEntries(page)).toContain('Private sibling draft');
 const other=await context.newPage();await other.goto(appOrigin+'/overview?workspace=ws_example');await expect(other.getByTestId('session-status')).toContainText('human_operator');await expect(other.getByTestId('message-composer')).toHaveCount(0);
 await other.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByTestId('message-composer')).toBeHidden();await expect.poll(()=>compositionEntries(page)).toBe('{}');await other.close();
});
async function compositionEntries(page:Page){
 return page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('cfhub-composition-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<string>((resolve,reject)=>{const r=db.transaction('scopes').objectStore('scopes').get(['ws_example','human_operator']);r.onsuccess=()=>resolve(JSON.stringify(r.result?.entries));r.onerror=()=>reject(r.error);});}finally{db.close();}});
}

type CompositionSnapshot={messages:{id:string}[];events:{resource_id:string}[];outcomes:{key:string;created_at:number;expires_at:number;outcome_json:string}[];outbox:unknown[];dropped:{messageId:string;status:number}[]};
async function compositionSnapshot(page:Page):Promise<CompositionSnapshot>{const value=await fixtureControl(page,'composition-snapshot') as {snapshot:CompositionSnapshot};return value.snapshot;}
test('committed_response_loss_reload_and_two_tab_read_only_recovery_preserve_one_admission',async({page,context})=>{
 const writes:{key:string|undefined;body:string|null}[]=[],checks:{key:string|undefined;body:string|null}[]=[];
 context.on('request',request=>{if(request.method()!=='POST')return;const path=new URL(request.url()).pathname;if(path==='/v2/workspaces/ws_example/messages')writes.push({key:request.headers()['idempotency-key'],body:request.postData()});if(path==='/v2/workspaces/ws_example/messages:reconcile')checks.push({key:request.headers()['idempotency-key'],body:request.postData()});});
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Committed original admission, response intentionally lost');
 await fixtureControl(page,'drop-composition-responses');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByTestId('message-compose-status')).toContainText('Outcome unknown');
 const committed=await compositionSnapshot(page);expect(committed.messages).toHaveLength(1);expect(committed.events).toHaveLength(1);expect(committed.outcomes).toHaveLength(1);expect(committed.dropped.length).toBeGreaterThanOrEqual(1);for(const dropped of committed.dropped){expect(dropped.status).toBe(201);expect(dropped.messageId).toBe(committed.dropped[0]!.messageId);}expect(writes.length).toBeGreaterThanOrEqual(1);for(const write of writes)expect(write).toEqual(writes[0]);expect(committed.outcomes[0]!.key).toBe(writes[0]!.key);expect(committed.messages[0]!.id).toBe(committed.dropped[0]!.messageId);expect(committed.events[0]!.resource_id).toBe(committed.messages[0]!.id);expect(JSON.parse(committed.outcomes[0]!.outcome_json).id).toBe(committed.messages[0]!.id);expect(committed.outbox).toHaveLength(0); // r2-board fixture deliberately configures no notification destinations.
 await fixtureControl(page,'resume-composition-responses');const attempts=writes.length;
 await page.reload();await open(page);await expect(page.getByTestId('message-compose-status')).toContainText('Outcome unknown');const other=await context.newPage();await other.goto(appOrigin+'/overview?workspace=ws_example');await expect(other.getByTestId('session-status')).toContainText('human_operator');await open(other);await expect(other.getByTestId('message-compose-status')).toContainText('Outcome unknown');
 let releaseChecks!:()=>void,checksArrived=0;const bothChecks=new Promise<void>(resolve=>{releaseChecks=resolve;});
 await context.route('**/v2/workspaces/ws_example/messages:reconcile',async route=>{if(++checksArrived===2)releaseChecks();await bothChecks;await route.continue();});
 try{await Promise.all([page.getByRole('button',{name:'Check original admission',exact:true}).click(),other.getByRole('button',{name:'Check original admission',exact:true}).click()]);await expect.poll(()=>checksArrived).toBe(2);}finally{releaseChecks();}
 await expect(page.getByTestId('message-compose-status')).toContainText('Durably admitted message '+committed.dropped[0]!.messageId);await expect(other.getByTestId('message-compose-status')).toContainText('Durably admitted message '+committed.dropped[0]!.messageId);expect(writes).toHaveLength(attempts);expect(checks).toHaveLength(2);for(const check of checks)expect(check).toEqual(writes[0]);
 const recovered=await compositionSnapshot(page);expect(recovered).toEqual(committed);await expect(page.getByRole('button',{name:'Read admitted thread',exact:true})).toBeHidden();await other.close();
});
test('read_only_check_of_never_dispatched_intent_stays_unknown_without_new_identity',async({page})=>{
 let posts=0;await page.route('**/v2/workspaces/ws_example/messages',async route=>{if(route.request().method()==='POST'){posts++;await route.abort('connectionfailed');}else await route.continue();});await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Never reached the server');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByTestId('message-compose-status')).toContainText('Outcome unknown');const before=await compositionEntries(page),sql=await compositionSnapshot(page);
 await page.getByRole('button',{name:'Check original admission',exact:true}).click();await expect(page.getByTestId('message-compose-status')).toContainText('Outcome unknown');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();expect(posts).toBe(1);expect(await compositionEntries(page)).toBe(before);expect(await compositionSnapshot(page)).toEqual(sql);
});

test('lost_actual_prepare_response_never_dispatches_domain_creation',async({page})=>{
 let creates=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/v2/workspaces/ws_example/messages')creates++;});
 await fixtureControl(page,'drop-preparation-responses');
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Preparation response lost');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByTestId('message-compose-status')).toContainText('Preparation failed');expect(creates).toBe(0);expect((await compositionSnapshot(page)).messages).toHaveLength(0);
 await page.reload();await open(page);expect(creates).toBe(0);expect(await compositionEntries(page)).toContain('"status":"prepared"');
});

test('committed_response_loss_then_outcome_removal_recovers_only_original_event_receipt',async({page})=>{
 let creates=0;const requests:{key:string;body:string;handle:string}[]=[];
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/v2/workspaces/ws_example/messages'){creates++;requests.push({key:r.headers()['idempotency-key']!,body:r.postData()!,handle:r.headers()['x-creation-admission']!});}});
 await open(page);await page.getByRole('checkbox',{name:/agent_research/}).check();await page.getByLabel('Message text',{exact:true}).fill('Original receipt after outcome removal');await fixtureControl(page,'drop-composition-responses');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByTestId('message-compose-status')).toContainText('Outcome unknown');await fixtureControl(page,'resume-composition-responses');const committed=await compositionSnapshot(page);expect(committed.messages).toHaveLength(1);const frozen=requests[0]!;expect(frozen.handle).toMatch(/^event_[a-f0-9]{48}$/);const attempts=creates;
 // Test-only retention row removal; the real collector transaction is separately exercised by Workers tests.
 await fixtureControl(page,'remove-composition-outcomes');expect((await compositionSnapshot(page)).outcomes).toHaveLength(0);await page.reload();await open(page);await page.getByRole('button',{name:'Check original admission',exact:true}).click();await expect(page.getByTestId('message-compose-status')).toContainText('Durably admitted message '+committed.messages[0]!.id);await expect(page.getByRole('button',{name:'Read admitted thread',exact:true})).toBeHidden();expect(creates).toBe(attempts);
 // Deleted original evidence plus a legal legacy key/body reuse must never confirm the old handle.
 await fixtureControl(page,'remove-composition-events');const replacement=await page.evaluate(async original=>{const session=await (await fetch('/v2/workspaces/ws_example/auth/session')).json() as {data:{csrf_token:string}};const response=await fetch('/v2/workspaces/ws_example/messages',{method:'POST',headers:{'content-type':'application/json','idempotency-key':original!.key,'x-csrf-token':session.data.csrf_token},body:original!.body});return {status:response.status,data:(await response.json() as {data:{id:string}}).data};},frozen);expect(replacement.status).toBe(201);expect(replacement.data.id).not.toBe(committed.messages[0]!.id);
 const result=await page.evaluate(async original=>{const session=await (await fetch('/v2/workspaces/ws_example/auth/session')).json() as {data:{csrf_token:string}};return (await (await fetch('/v2/workspaces/ws_example/messages:reconcile',{method:'POST',headers:{'content-type':'application/json','idempotency-key':original!.key,'x-creation-admission':original!.handle,'x-csrf-token':session.data.csrf_token},body:original!.body})).json() as {data:unknown}).data;},frozen);expect(result).toEqual({status:'unknown'});
});
