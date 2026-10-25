import type {AuthStartDataResponse} from '../../src/http/dto';
import type {Page} from '@playwright/test';
import {expect,appOrigin} from './browser';
export async function login(page:Page,returnPath='/overview',principal='human_operator'){
 await page.goto(appOrigin+'/health/live');
 const url=await page.evaluate(async path=>{
  const r=await fetch('/v2/workspaces/ws_example/auth/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({return_path:path})});
  if(!r.ok)throw Error('FIXTURE_LOGIN_START_FAILED');return (await r.json() as AuthStartDataResponse).data.authorization_url as string;
 },returnPath);
 await page.goto(url);await expect(page.getByRole('heading',{name:'Workspace overview'})).toBeVisible();
 await expect(page.getByTestId('session-status')).toContainText(principal);
}
export async function screenshot(page:Page,name:string){await page.screenshot({path:'.superpowers/r1-completion/screenshots/'+name+'.png',fullPage:true});}
export async function fixtureControl(page:Page,action:string){
 return page.evaluate(async value=>{const r=await fetch('/__ui_fixture/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:value})});if(!r.ok)throw Error('FIXTURE_CONTROL_FAILED');return r.json();},action);
}
