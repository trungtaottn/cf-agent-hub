import {validateApprovalDecisionRequest} from '../../../src/http/generated/decision-validators.js';
import {snapshot,canonicalBody} from './native-request';
import {ClientFault} from './transport';
import type {BrowserApprovalReadOperation,BrowserDecisionOperation} from './types';
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>record(v)&&Object.keys(v).every(k=>keys.includes(k));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
/** Browser-only closed path adapter; no native inventory or caller-selected authority. */
export function prepareBrowserDecision(workspace:string,operation:BrowserApprovalReadOperation|BrowserDecisionOperation,input:unknown):{path:string;body?:string}{
 if(!['listApprovals','getApproval','approveApproval','rejectApproval'].includes(operation))throw new ClientFault('OPERATION_UNAVAILABLE');
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(workspace))throw new ClientFault('INVALID_REQUEST');
 const write=operation==='approveApproval'||operation==='rejectApproval';
 if(!closed(input,operation==='listApprovals'?['query']:write?['path','body']:['path'])||operation==='listApprovals'&&input.query!==undefined&&!closed(input.query,['cursor','limit'])||operation!=='listApprovals'&&!closed(input.path,['approval_id'])||write&&!validateApprovalDecisionRequest(input.body))throw new ClientFault('INVALID_REQUEST');
 const request=snapshot(input);let path='/v2/workspaces/'+workspace+'/approvals';
 if(operation==='listApprovals'){
  if(!closed(request,['query'])||request.query!==undefined&&!closed(request.query,['cursor','limit']))throw new ClientFault('INVALID_REQUEST');
  const q=(request.query??{}) as Record<string,unknown>;
  if(q.cursor!==undefined&&(typeof q.cursor!=='string'||q.cursor.length===0||q.cursor.length>2048)||q.limit!==undefined&&(!Number.isInteger(q.limit)||Number(q.limit)<1||Number(q.limit)>200))throw new ClientFault('INVALID_REQUEST');
  const query=new URLSearchParams();for(const key of ['cursor','limit'])if(q[key]!==undefined)query.set(key,String(q[key]));
  if(query.size)path+='?'+query.toString();return {path};
 }
 if(!closed(request,write?['path','body']:['path'])||!closed(request.path,['approval_id'])||!id(request.path.approval_id))throw new ClientFault('INVALID_REQUEST');
 path+='/'+encodeURIComponent(request.path.approval_id);
 if(!write)return {path};
 if(!validateApprovalDecisionRequest(request.body))throw new ClientFault('INVALID_REQUEST');
 const body=canonicalBody(request.body);if(new TextEncoder().encode(body).byteLength>65536)throw new ClientFault('INVALID_REQUEST');
 return {path:path+':'+(operation==='approveApproval'?'approve':'reject'),body};
}
