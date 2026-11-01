import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildSync} from 'esbuild';
import {test,expect} from '../helpers/browser';
const app=ts.createSourceFile('app.ts',readFileSync(new URL('../../src/ui/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const render=app.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='renderApprovals')!.getText(app);
const bundle=buildSync({stdin:{loader:'ts',resolveDir:process.cwd(),contents:`
import {DecisionActions} from './src/ui/approvals/decision-actions';
import {renderDecisionActions} from './src/ui/approvals/decision-action-view';
import {renderDecisionDetail} from './src/ui/approvals/decision-detail';
import {renderDecisionList} from './src/ui/approvals/decision-list';
import {decisionCallbackCurrent} from './src/ui/approvals/panel';
import {el,button} from './src/ui/dom';
export function create(root:HTMLElement){
 let approvalsAvailable=true,approvalDecisionsAvailable=true,denied=false,source='https://hub.invalid',workspace='ws',session={actor:{kind:'human',principal_id:'human'}},models={workspace:{state:{status:'ready'}}},paint=0,calls=0,release;
 const decisionContext=()=>({authority:1,connection:1,principalId:'human',view:1,render:paint,active:true,online:true});
 const approval={id:'approval',task_id:'task',approval_version:1,proposal_version:1,task_version_at_request:1,status:'pending',assigned_human_principal_ids:['human'],expires_at:'2100-01-01T00:00:00Z',proposal:{summary:'Private summary',action:'fixture_only',inputs:{artifact_id:'input',sha256:'a'.repeat(64)}}};
 const decisionReads:any={selectedId:'approval',page:null,list:{state:{status:'ready',data:[approval],errorCode:null}},detail:{state:{status:'ready',data:{approval,task:{id:'task',state:'waiting',task_version:2,approval_id:'approval'},artifact:{id:'input',artifact_version:1},input:{text:'PRIVATE_OLD_INPUT',sha256:'a'.repeat(64),byteSize:17}},errorCode:null}},refreshList:async()=>{},refreshDetail:async()=>{},select:async()=>{},next:async()=>{}};
 const failure={ok:false,status:null,requestId:null,error:{code:'READ_FAILED',message:'Unavailable',retryable:false}};
 const decisionActions=new DecisionActions({workspaceId:'ws',currentBinding:()=>({principalId:'human',generation:1,renderGeneration:1,online:true}),currentObservationRevision:()=>1,observe:async()=>{calls++;return new Promise(r=>{release=r;});},readAccess:async()=>failure,command:async()=>failure,changed:()=>draw()});
 ${render}
 function draw(){paint++;root.replaceChildren(renderApprovals());}
 draw();return {calls:()=>calls,release:()=>release(failure)};
}
`},bundle:true,write:false,platform:'browser',format:'iife',globalName:'ActualDecisionHost',target:'es2022'}).outputFiles[0]!.text;
/** Actual browser DOM executing the actual app renderer body with a held model read.
 * Not a real-session/CSRF/Worker positive decision fixture or action activation. */
test('actual app preparing branch hides prior private input synchronously and fences detached controls',async({page})=>{
 await page.setContent('<main id="root"></main>');await page.addScriptTag({content:bundle});
 await page.evaluate(()=>{const w=window as any;w.harness=w.ActualDecisionHost.create(document.querySelector('#root'));w.oldPrepare=document.querySelector('[data-focus-key="decision-prepare:approveApproval"]');});
 await expect(page.getByLabel('Full original JSON input')).toHaveText('PRIVATE_OLD_INPUT');
 await page.getByRole('button',{name:'Prepare approval request',exact:true}).click();
 await expect(page.getByTestId('decision-action-panel')).toContainText('preparing');
 await expect(page.getByLabel('Full original JSON input')).toHaveCount(0);await expect(page.getByText('PRIVATE_OLD_INPUT')).toHaveCount(0);
 expect(await page.evaluate(()=>{const w=window as any;w.oldPrepare.click();return w.harness.calls();})).toBe(1);
 await page.evaluate(()=>{(window as any).harness.release();});
 await expect(page.getByTestId('decision-action-panel')).toContainText('rejected');await expect(page.getByText('PRIVATE_OLD_INPUT')).toHaveCount(0);
});
