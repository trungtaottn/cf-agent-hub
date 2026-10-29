import type {Page} from '@playwright/test';
import type {AuthSessionResponse,TaskResponse,TaskCommandResultResponse} from '../../src/http/dto';
import {test,expect,appOrigin,issuerOrigin,sendFixtureReadyRoute} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';

// Real fixture commands persist through the public HTTP/domain path. Route interception
// below injects only transport faults; it never invents successful domain mutations.
test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'r2-board');});
const review='Review evidence <img src=x onerror="window.fixtureInjected=1">';
async function board(page:Page){await login(page,'/tasks');await expect(page.getByTestId('tasks-backlog').getByRole('link',{name:'Backlog item 01',exact:true})).toBeVisible();}
async function openAction(page:Page,title:string,action:string){
 const card=page.locator('.task-card').filter({has:page.getByRole('link',{name:title,exact:true})});
 await card.getByRole('button',{name:/Actions for/}).click();await card.getByRole('button',{name:action,exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
}
async function taskId(page:Page,title:string){const href=await page.getByRole('link',{name:title,exact:true}).getAttribute('href');return new URL(href!,appOrigin).searchParams.get('task')!;}
async function getTask(page:Page,id:string){return page.evaluate(async id=>(await (await fetch('/v2/workspaces/ws_example/tasks/'+encodeURIComponent(id))).json() as TaskResponse).data,id);}
async function directCommand(page:Page,id:string,action:string,version:number,reason?:string){return page.evaluate(async({id,action,version,reason})=>{
 const session=(await(await fetch('/v2/workspaces/ws_example/auth/session')).json() as AuthSessionResponse).data;
 const response=await fetch('/v2/workspaces/ws_example/tasks/'+encodeURIComponent(id)+':'+action,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrf_token,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({expected_version:version,...(reason===undefined?{}:{reason})})});
 return {status:response.status,body:await response.json() as TaskCommandResultResponse};
},{id,action,version,reason});}

test('keyboard Ready persists exactly one transition and focus returns to current card',async({page})=>{
 await board(page);const id=await taskId(page,'Backlog item 01'),before=await getTask(page,id);
 await openAction(page,'Backlog item 01','Ready');const dialog=page.getByRole('dialog');
 const confirm=dialog.getByRole('button',{name:'Confirm command',exact:true});await expect(confirm).toBeEnabled();await confirm.focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('tasks-ready')).toContainText('Backlog item 01');
 expect((await getTask(page,id)).task_version).toBe(before.task_version+1);
});

test('Accept uses independently observed latest run and real server acceptance',async({page})=>{
 await board(page);const id=await taskId(page,review),before=await getTask(page,id);
 await openAction(page,review,'Accept result');await page.getByRole('dialog').getByLabel('Reason',{exact:true}).fill('Reviewed the current submitted evidence.');
 await page.getByRole('button',{name:'Confirm command',exact:true}).click();await expect(page.getByTestId('tasks-done')).toContainText(review);
 const after=await getTask(page,id);expect(after.task_version).toBe(before.task_version+1);expect(after.state).toBe('done');
});

test('conflict retains exact reason and requires explicit current-state review',async({page})=>{
 await board(page);const id=await taskId(page,'Backlog item 01');await openAction(page,'Backlog item 01','Cancel');
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Reason',{exact:true}).fill('Keep this reason unchanged.');
 const before=await getTask(page,id);expect((await directCommand(page,id,'ready',before.task_version)).status).toBe(200);
 await dialog.getByRole('button',{name:'Confirm command',exact:true}).click();await expect(dialog).toContainText(/conflict|changed/i);
 await expect(dialog.getByLabel('Reason',{exact:true})).toHaveValue('Keep this reason unchanged.');
 await expect(dialog.getByRole('button',{name:'Confirm command',exact:true})).not.toBeVisible();
 expect((await getTask(page,id)).state).toBe('ready');
});

test('lost response retains original key/body across navigation and explicit replay',async({page})=>{
 await board(page);const id=await taskId(page,'Backlog item 01'),before=await getTask(page,id);const requests:{key:string|null;body:string|null}[]=[];let lose=true;
 await page.route('**/tasks/'+id+':ready',async route=>{requests.push({key:route.request().headers()['idempotency-key']??null,body:route.request().postData()});if(lose){lose=false;const response=await sendFixtureReadyRoute(route);expect(response.status).toBe(200);const result=JSON.parse(response.body.toString('utf8')) as TaskCommandResultResponse;expect(result.data.task).toMatchObject({id,state:'ready',task_version:before.task_version+1});expect(await getTask(page,id)).toMatchObject({id,state:'ready',task_version:before.task_version+1});await route.abort();}else await route.continue();});
 await openAction(page,'Backlog item 01','Ready');await page.getByRole('button',{name:'Confirm command',exact:true}).click();await expect(page.getByRole('dialog')).toContainText(/uncertain|unknown/i);
 await page.keyboard.press('Escape');await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('link',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:/Reopen/}).click();await page.getByRole('button',{name:'Reconcile original command',exact:true}).click();
 await expect.poll(()=>requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);expect((await getTask(page,id)).task_version).toBe(2);
});

test('revocation between render and command clears sensitive command state',async({page})=>{
 await board(page);await openAction(page,'Backlog item 01','Cancel');await page.getByRole('dialog').getByLabel('Reason',{exact:true}).fill('Private draft reason');
 await fixtureControl(page,'r2-revoke-human');await page.getByRole('button',{name:'Confirm command',exact:true}).click();
 await expect(page.getByTestId('session-status')).toContainText('Access denied');await expect(page.locator('body')).not.toContainText('Private draft reason');
});

test('current tasks-only grant cannot submit any board command or direct command',async({page,context})=>{
 await context.addCookies([{name:'cfhub_fixture_subject',value:'tasks-only-subject',url:issuerOrigin,secure:true}]);await login(page,'/tasks','human_tasks_only');
 const id=await taskId(page,'Backlog item 01'),before=await getTask(page,id),card=page.locator('.task-card').filter({has:page.getByRole('link',{name:'Backlog item 01',exact:true})});
 await card.getByRole('button',{name:/Actions for/}).click();await expect(card.getByRole('button',{name:'Ready',exact:true})).toBeDisabled();
 expect((await directCommand(page,id,'ready',before.task_version)).status).toBe(403);
});

test('native dialog reason node and selection survive background reads',async({page})=>{
 await board(page);await openAction(page,'Backlog item 01','Cancel');const reason=page.getByRole('dialog').getByLabel('Reason',{exact:true});await reason.fill('Preserve selection');
 await reason.evaluate(node=>{const field=node as HTMLTextAreaElement;field.setSelectionRange(3,8);(window as any).fixtureReasonNode=field;});
 await page.getByRole('button',{name:'Refresh reads',exact:true}).evaluate(node=>(node as HTMLButtonElement).click());
 await expect(reason).toHaveValue('Preserve selection');expect(await reason.evaluate(node=>node===(window as any).fixtureReasonNode&&(node as HTMLTextAreaElement).selectionStart===3&&(node as HTMLTextAreaElement).selectionEnd===8)).toBe(true);
});

test('narrow keyboard disclosure and dialog do not use partial ARIA menu semantics',async({page})=>{
 await page.setViewportSize({width:360,height:760});await board(page);await openAction(page,'Backlog item 01','Cancel');const dialog=page.getByRole('dialog');
 await expect(page.getByRole('menu')).toHaveCount(0);await expect(dialog.getByLabel('Reason',{exact:true})).toBeVisible();
 await page.keyboard.press('Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
});

test('internal Ready and Accept drags prepare the same canonical command dialogs',async({page})=>{
 await board(page);const id=await taskId(page,'Backlog item 01'),calls:{url:string;body:any}[]=[];
 page.on('request',request=>{if(request.method()==='POST'&&/:(ready|accept-result)$/.test(request.url()))calls.push({url:request.url(),body:request.postDataJSON()});});
 await page.locator('.task-card').filter({has:page.getByRole('link',{name:'Backlog item 01',exact:true})}).dragTo(page.getByTestId('tasks-ready'));
 await expect(page.getByRole('dialog')).toContainText(id);await page.getByRole('button',{name:'Confirm command',exact:true}).click();await expect(page.getByTestId('tasks-ready')).toContainText('Backlog item 01');
 expect(calls[0]!.body).toEqual({expected_version:1});expect(calls[0]!.url).toContain('/tasks/'+id+':ready');
 await page.locator('.task-card').filter({has:page.getByRole('link',{name:review,exact:true})}).dragTo(page.getByTestId('tasks-done'));
 await page.getByRole('dialog').getByLabel('Reason',{exact:true}).fill('Independent drag review');await page.getByRole('button',{name:'Confirm command',exact:true}).click();await expect(page.getByTestId('tasks-done')).toContainText(review);
 expect(Object.keys(calls[1]!.body).sort()).toEqual(['expected_version','reason']);
});

test('double activation and external drops cannot dispatch extra commands or manufacture Doing',async({page})=>{
 await board(page);let dispatched=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(':ready'))dispatched++;});
 const data=await page.evaluateHandle(()=>{const transfer=new DataTransfer();transfer.setData('application/x-agenthub-task','foreign:task');return transfer;});
 await page.getByTestId('tasks-ready').dispatchEvent('drop',{dataTransfer:data});await page.getByTestId('tasks-doing').dispatchEvent('drop',{dataTransfer:data});await expect(page.getByRole('dialog')).not.toBeVisible();
 await openAction(page,'Backlog item 01','Ready');await page.getByRole('button',{name:'Confirm command',exact:true}).evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click();});
 await expect(page.getByTestId('tasks-ready')).toContainText('Backlog item 01');expect(dispatched).toBe(1);
});

test('wrong binding receipt stays uncertain and explicit replay recovers persisted original',async({page})=>{
 await board(page);const id=await taskId(page,'Backlog item 01');let corrupt=true;
 await page.route('**/tasks/'+id+':ready',async route=>{if(!corrupt){await route.continue();return;}corrupt=false;const response=await sendFixtureReadyRoute(route),body=JSON.parse(response.body.toString('utf8'));expect(response.status).toBe(200);expect(body.data.task).toMatchObject({id,state:'ready',task_version:2});body.data.task.id='task_wrong_binding';await route.fulfill({...response,body:JSON.stringify(body)});});
 await openAction(page,'Backlog item 01','Ready');await page.getByRole('button',{name:'Confirm command',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('INVALID_RESPONSE');
 await page.getByRole('button',{name:'Reconcile original command',exact:true}).click();await expect(page.getByTestId('tasks-ready')).toContainText('Backlog item 01');expect((await getTask(page,id)).task_version).toBe(2);
});

test('preparation 404 redacts stale card without declaring an empty workspace',async({page})=>{
 await board(page);const id=await taskId(page,'Backlog item 01');await page.route('**/tasks/'+id,route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{code:'NOT_FOUND',message:'Synthetic disappearance',retryable:false,request_id:'fixture_missing'}})}));
 await openAction(page,'Backlog item 01','Cancel');await expect(page.getByRole('dialog')).toContainText('NOT_FOUND');await expect(page.getByRole('link',{name:'Backlog item 01',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('tasks-backlog')).toContainText('Backlog item 02');
});

test('reconnect invalidates prepared confirmation and requires fresh explicit review',async({page,context})=>{
 await board(page);await openAction(page,'Backlog item 01','Cancel');await page.getByRole('dialog').getByLabel('Reason',{exact:true}).fill('Preserved offline draft');
 await context.setOffline(true);await expect(page.getByRole('button',{name:'Confirm command',exact:true})).toBeDisabled();await context.setOffline(false);
 await expect(page.getByRole('dialog').getByLabel('Reason',{exact:true})).toHaveValue('Preserved offline draft');await expect(page.getByRole('button',{name:'Confirm command',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Review current task',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm command',exact:true})).toBeEnabled();
});
