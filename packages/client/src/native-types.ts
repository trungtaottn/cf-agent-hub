import type {NativeDTO} from '../../../src/contracts/native';
import type {NativeClient} from './types';

/** R3 bridge over the existing generated schema family, not an enabled-operation list. */
export type NativeSchema='Task'|'Run'|'Proposal'|'Approval'|'TaskRequestDecisionRequest'|'ApprovalDecisionRequest'|'TaskCommandResult';
export type Native<S extends NativeSchema>=NativeDTO<S>;
export type {RequestFor,ResponseFor,NativeRequestOptions,EnabledOperationId} from './types';
export type NativeInvoker=Readonly<{invoke:NativeClient['call']}>;

/** Trusted host binding only. Tool/form JSON is never transport options or authority.
 * Human session/CSRF calls remain on HubClient; this does not enable decision operations. */
export function createNativeInvoker(client:NativeClient):NativeInvoker {
 return Object.freeze({invoke:((operation,request,options)=>client.call(operation,request,options)) as NativeClient['call']});
}
