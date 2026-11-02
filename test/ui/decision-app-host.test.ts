import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {factoryAppSource as appSource} from '../helpers/factory-app-source.mjs';
import ts from 'typescript';
import {DecisionActions} from '../../src/ui/approvals/decision-actions';
import {renderDecisionActions} from '../../src/ui/approvals/decision-action-view';
import {renderDecisionDetail} from '../../src/ui/approvals/decision-detail';
import {renderDecisionList} from '../../src/ui/approvals/decision-list';
import {decisionCallbackCurrent} from '../../src/ui/approvals/panel';
import {el,button} from '../../src/ui/dom';
import {asFixture,domFixture,descendants} from '../helpers/dom-fixture';
beforeEach(()=>{vi.stubGlobal('document',domFixture);vi.stubGlobal('navigator',{onLine:true});});afterEach(()=>vi.unstubAllGlobals());
/** Actual app body, structural DOM only; actual browser held-read proof is separate. */
it('actual preparing render hides the old read detail synchronously while new exact inspection is held',async()=>{
 const source=ts.createSourceFile('app.ts',appSource,ts.ScriptTarget.Latest,true),fn=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='renderApprovals')!;
 const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
 const approval={id:'approval',task_id:'task',approval_version:1,proposal_version:1,task_version_at_request:1,status:'pending',assigned_human_principal_ids:['human'],expires_at:'2100-01-01T00:00:00Z',proposal:{summary:'Private summary',action:'fixture_only',inputs:{artifact_id:'input',sha256:'a'.repeat(64)}}};
 const reads={selectedId:'approval',page:null,list:{state:{status:'ready',data:[approval],errorCode:null}},detail:{state:{status:'ready',data:{approval,task:{id:'task',state:'waiting',task_version:2,approval_id:'approval'},artifact:{id:'input',artifact_version:1},input:{text:'PRIVATE_OLD_INPUT',sha256:'a'.repeat(64),byteSize:17}},errorCode:null}},refreshList:vi.fn(),refreshDetail:vi.fn(),select:vi.fn(),next:vi.fn()};
 let release!:(r:any)=>void,paint:()=>HTMLElement,displayed:ReturnType<typeof asFixture>;
 const actions=new DecisionActions({workspaceId:'ws',currentBinding:()=>({principalId:'human',generation:1,renderGeneration:1,online:true}),currentObservationRevision:()=>1,observe:async()=>new Promise(r=>{release=r;}),readAccess:vi.fn(),command:vi.fn(),changed:()=>{if(paint)displayed=asFixture(paint());}});
 paint=new Function('el','button','renderDecisionList','renderDecisionDetail','renderDecisionActions','decisionCallbackCurrent','decisionReads','decisionActions',`let approvalsAvailable=true,approvalDecisionsAvailable=true,denied=false,source='https://hub.invalid',workspace='ws',session={actor:{kind:'human',principal_id:'human'}},models={workspace:{state:{status:'ready'}}};const decisionContext=()=>({authority:1,connection:1,principalId:'human',view:1,render:1,active:true,online:true});${code};return renderApprovals;`)(el,button,renderDecisionList,renderDecisionDetail,renderDecisionActions,decisionCallbackCurrent,reads,actions);
 displayed=asFixture(paint());expect(displayed.textContent).toContain('PRIVATE_OLD_INPUT');
 const pending=actions.prepare('approval','approveApproval');expect(displayed!.textContent).not.toContain('PRIVATE_OLD_INPUT');expect(displayed!.textContent).toContain('preparing');
 release({ok:false,status:null,requestId:null,error:{code:'READ_FAILED',message:'Unavailable',retryable:false}});await pending;
});
it.each(['pending','uncertain'] as const)('actual global refresh preserves %s intent and never rereads raw content behind action view',async status=>{
 const source=ts.createSourceFile('app.ts',appSource,ts.ScriptTarget.Latest,true),fn=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='refreshReads')!;
 const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
 const reads={selectedId:'approval',refreshList:vi.fn(async()=>{}),refreshDetail:vi.fn(async()=>{})},actions={state:{status,operation:'approveApproval'},invalidatePreparation:vi.fn(),invalidateAuthority:vi.fn(),refreshOutcome:vi.fn(async()=>{})};
 const refresh=new Function('decisionReads','decisionActions',`let session={actor:{kind:'human'}},denied=false,authority=1,eventsAvailable=false,operationsAvailable=false,profileAvailable=false,preferencesAvailable=false,tasksAvailable=true,approvalsAvailable=true,approvalDecisionsAvailable=true,currentView='approvals',threadId=null;const taskActions={invalidatePreparation(){}},models={configuration:{state:{data:{enabled_features:[]}}},workspace:{state:{status:'ready',data:{effective_scopes:['tasks:read','artifacts:read','approvals:read','approvals:decide']}}}},taskReads={setCapabilities(){},disconnect(){}},render=()=>{},request=()=>{},refreshModel=async()=>{},disposeDecisions=()=>{},refreshEvents=async()=>{},refreshThread=async()=>{};${code};return refreshReads;`)(reads,actions);
 await refresh();expect(reads.refreshDetail).not.toHaveBeenCalled();expect(actions.invalidatePreparation).not.toHaveBeenCalled();expect(actions.invalidateAuthority).not.toHaveBeenCalled();expect(actions.refreshOutcome).toHaveBeenCalledTimes(status==='uncertain'?1:0);
});
it('actual disposal clears read bytes and action intent before one final paint',()=>{
 const source=ts.createSourceFile('app.ts',appSource,ts.ScriptTarget.Latest,true),fn=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='disposeDecisions')!;
 const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText,paints:any[]=[];
 const dispose=new Function('paint',`let approvalViewGeneration=1,approvalRenderGeneration=1,approvalDisposing=false,currentView='approvals',bytes='private bytes',intent='private intent';const render=()=>paint({bytes,intent});const decisionActions={invalidateAuthority(){intent=null;if(!approvalDisposing)render();}},decisionReads={invalidate(){bytes=null;if(!approvalDisposing)render();}};${code};return disposeDecisions;`)((value:any)=>paints.push(value));
 dispose();expect(paints).toEqual([{bytes:null,intent:null}]);
});
