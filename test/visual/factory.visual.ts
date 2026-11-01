import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {test,expect,appOrigin} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';
const source='77ee610c13a61077dc866a66556eafdfcb1d2553',tree='3c6eb659c6ad6d30ddd30bc6b22500d819a6c73a';
const out='factory-visual-evidence',captures:Array<{file:string;sha256:string;viewport:{width:number;height:number};surface:string}>=[];
let browserVersion='';
test.beforeAll(async()=>{
 expect(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()).toBe(source);
 expect(execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim()).toBe(tree);
 expect(process.env.CFHUB_VISUAL_DRIVER_SHA).toMatch(/^[a-f0-9]{40}$/);await mkdir(out,{recursive:true});
});
for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]] as const){
 test('actual synthetic Factory surfaces '+label,async({page,browser})=>{
  browserVersion=browser.version();await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(appOrigin+'/health/live');await fixtureControl(page,'r2-board');await login(page,'/tasks');
  await expect(page.getByRole('button',{name:'Factory evidence',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Factory evidence',exact:true}).click();
  await expect(page.getByTestId('factory-profile')).toHaveAttribute('data-status','ready');
  for(const state of ['backlog','ready','doing','waiting','review','done','cancelled'])await expect(page.getByTestId('factory-tasks-'+state)).toHaveAttribute('data-status',/^(ready|empty)$/);
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>window.scrollTo(0,0));
  const shot=async(surface:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);const file=label+'-'+surface+'.png',bytes=await page.screenshot({path:out+'/'+file,fullPage:false});captures.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),viewport,surface});};
  await shot('overview');
  const runResponse=page.waitForResponse(response=>/\/runs\/[^/?]+$/.test(new URL(response.url()).pathname)&&response.request().method()==='GET');
  await page.getByRole('link',{name:'Review evidence <img src=x onerror="window.fixtureInjected=1">',exact:true}).click();
  const observedRun=await runResponse;expect(observedRun.ok()).toBe(true);const run=(await observedRun.json()).data as {id:string;status:string};expect(run.status).toBe('submitted');expect(new URL(observedRun.url()).pathname.endsWith('/'+encodeURIComponent(run.id))).toBe(true);
  await expect(page.getByTestId('task-run')).toHaveAttribute('data-status','ready');await expect(page.getByTestId('task-run')).toContainText('Run: '+run.id+' · Status: submitted');
  await expect(page.getByTestId('task-results')).toContainText('Current submitted result');await expect(page.getByTestId('task-artifacts')).toHaveAttribute('data-status','ready');await expect(page.getByTestId('task-events')).toHaveAttribute('data-status',/^(ready|empty)$/);
  await page.getByTestId('factory-workstation').evaluate(el=>el.scrollIntoView({block:'start'}));await shot('workstation');
  await page.getByTestId('factory-evidence').evaluate(el=>el.scrollIntoView({block:'start'}));await shot('qc');
 });
}
test.afterAll(async()=>{
 if(captures.length!==6)throw Error('VISUAL_CAPTURE_INCOMPLETE');
 execFileSync('git',['diff','--exit-code']);
 const captureTest=await readFile('test/visual/factory.visual.ts');
 await writeFile(out+'/receipt.json',JSON.stringify({version:1,kind:'synthetic-browser-screenshots',product_sha:source,product_tree:tree,driver_sha:process.env.CFHUB_VISUAL_DRIVER_SHA,capture_test_sha256:createHash('sha256').update(captureTest).digest('hex'),browser_version:browserVersion,node:process.version,fixture:'r2-board synthetic human_operator',captured_at:new Date().toISOString(),scope:'Six actual browser viewport captures; not a complete UX audit or live deployment',captures},null,2)+'\n');
});
