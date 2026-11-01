/** UI routing only: neither a new auth return path nor permission. */
export function isApprovalPanel(pathname:string,search:string):boolean{const params=new URLSearchParams(search);return pathname==='/tasks'&&params.getAll('panel').length===1&&params.get('panel')==='approvals';}
export function approvalPanelHref(workspace:string):string{return '/tasks?'+new URLSearchParams({workspace,panel:'approvals'}).toString();}
export interface DecisionCallbackBinding {authority:number;connection:number;principalId:string|null;view:number;render:number;active:boolean;online:boolean;}
/** Detached DOM callbacks cannot recover authority merely by returning A→B→A. */
export function decisionCallbackCurrent(captured:DecisionCallbackBinding,current:DecisionCallbackBinding):boolean{return captured.active&&captured.online&&current.active&&current.online&&current.principalId!==null&&captured.authority===current.authority&&captured.connection===current.connection&&captured.principalId===current.principalId&&captured.view===current.view&&captured.render===current.render;}
/** An awaited observation survives paint, but not view/authority/connection changes. */
export function decisionObservationCurrent(captured:DecisionCallbackBinding,current:DecisionCallbackBinding):boolean{return decisionCallbackCurrent(captured,{...current,render:captured.render});}
/** Only the original current task read may redact canonical task/activity caches. */
export function redactDeniedDecisionTask(captured:DecisionCallbackBinding,current:DecisionCallbackBinding,id:string,result:import('../../../packages/client/src/types').ApiResult<unknown>,forget:(id:string,code:'FORBIDDEN'|'NOT_FOUND',requestId:string|null)=>void):void{
 if(decisionObservationCurrent(captured,current)&&!result.ok&&(result.status===403||result.status===404))forget(id,result.status===403?'FORBIDDEN':'NOT_FOUND',result.requestId);
}
