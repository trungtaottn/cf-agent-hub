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
 await page.getByRole('button',{name:'Read admitted thread',exact:true}).click();await expect(page.getByTestId('thread')).toContainText('Keyboard <img');await expect(page.locator('#view img')).toHaveCount(0);
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
