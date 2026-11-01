import {buildSync} from 'esbuild';
import {test,expect} from '../helpers/browser';
const bundle=buildSync({stdin:{contents:"export {renderDecisionDetail} from './src/ui/approvals/decision-detail'; export {renderDecisionList} from './src/ui/approvals/decision-list';",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',globalName:'DecisionRenderer',target:'es2022'}).outputFiles[0]!.text;
/** Real Chromium renderer checks only, not real-session/domain decision acceptance. */
test('decision source renderer preserves full inert JSON and keyboard access',async({page})=>{
 await page.setContent('<main id="root"></main>');await page.addScriptTag({content:bundle});
 const hostile='</pre><script>globalThis.__executed=true</script>',text=JSON.stringify({large:'x'.repeat(300000),hostile});
 await page.evaluate(({text,hostile})=>{
  const renderer=(window as unknown as {DecisionRenderer:{renderDecisionDetail:(state:unknown,now:number)=>HTMLElement;renderDecisionList:(state:unknown,onSelect:(id:string)=>void)=>HTMLElement}}).DecisionRenderer;
  const approval={id:'approval',workspace_id:'ws',task_id:'task',run_id:'run',approval_version:2,proposal_version:3,task_version_at_request:4,status:'pending',checkpoint:{summary:hostile,artifact_ids:['checkpoint']},proposal:{summary:'Exact decision',action:'fixture_only',scope:{project_id:null,resource_ids:['task']},artifact_ids:[],inputs:{artifact_id:'artifact',sha256:'a'.repeat(64)}},assigned_human_principal_ids:['human'],expires_at:'2026-11-02T00:00:00Z'};
  const root=document.querySelector('#root')!;root.appendChild(renderer.renderDecisionList({status:'ready',data:[approval],errorCode:null},id=>{document.body.dataset.selected=id;}));root.appendChild(renderer.renderDecisionDetail({status:'ready',errorCode:null,data:{approval,task:{id:'task',state:'waiting',task_version:5,approval_id:'approval'},artifact:{id:'artifact',artifact_version:7},input:{text,byteSize:new TextEncoder().encode(text).byteLength,sha256:'a'.repeat(64)}}},Date.parse('2026-11-01T00:00:00Z')));
 },{text,hostile});
 const input=page.getByLabel('Full original JSON input');await expect(input).toHaveText(text);await expect(page.locator('#root script')).toHaveCount(0);expect(await page.evaluate(()=>Object.hasOwn(window,'__executed'))).toBe(false);
 await expect(page.getByText('Current task version 5 · proposal version 3 · approval version 2 · task version at request 4')).toBeVisible();
 await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Exact decision · approval'})).toBeFocused();await page.keyboard.press('Enter');expect(await page.locator('body').getAttribute('data-selected')).toBe('approval');
 await input.focus();await expect(input).toBeFocused();await expect(page.getByText(/not execution or completion/)).toBeVisible();
});
test('decision source renderer distinguishes denied, stale and empty observations',async({page})=>{
 await page.setContent('<main id="root"></main>');await page.addScriptTag({content:bundle});
 await page.evaluate(()=>{const renderer=(window as unknown as {DecisionRenderer:{renderDecisionDetail:(state:unknown)=>HTMLElement;renderDecisionList:(state:unknown,onSelect:()=>void)=>HTMLElement}}).DecisionRenderer;const root=document.querySelector('#root')!;root.appendChild(renderer.renderDecisionDetail({status:'forbidden',data:null,errorCode:'FORBIDDEN'}));root.appendChild(renderer.renderDecisionList({status:'empty',data:[],errorCode:null},()=>{}));root.appendChild(renderer.renderDecisionDetail({status:'stale',data:null,errorCode:'NETWORK_ERROR'}));});
 await expect(page.getByText('Decision detail: forbidden · FORBIDDEN')).toBeVisible();await expect(page.getByText('Decision detail: stale · NETWORK_ERROR')).toBeVisible();await expect(page.getByText('No visible decisions in this bounded page.')).toBeVisible();await expect(page.getByLabel('Full original JSON input')).toHaveCount(0);
});
