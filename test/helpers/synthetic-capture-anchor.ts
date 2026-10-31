import {recoveryContext} from './recovery-fixture';
import type {RecoveryWorkspace} from '../../src/recovery/protocol';
/** Synthetic controller fixture only: not the real provider, persistence or deployment proof.
 * Authority is a fixed fixture-owned tuple, never derived from request policy/expected fields.
 */
const authority=Object.freeze({authorityEpoch:1,sha256:'c'.repeat(64)});
export function withSyntheticCaptureAnchor<T extends RecoveryWorkspace>(workspace:T):T {
 const identity={workspace_id:workspace.workspaceId,environment_id:workspace.environmentId,object_name:workspace.objectName};
 workspace.trustedAnchor={bindingId:'synthetic_capture_anchor',binding:{async fetch(request:Request){
  const input=await request.json();
  if(request.method!=='POST'||new URL(request.url).pathname!=='/current'||JSON.stringify(input)!==JSON.stringify(identity))return new Response(null,{status:403});
  return Response.json({...identity,authority_epoch:authority.authorityEpoch,ledger_sha256:authority.sha256,generation:1});
 }}};
 workspace.release.binding_ids=[...workspace.release.binding_ids,'synthetic_capture_anchor'];return workspace;
}
export function syntheticCaptureContext(...args:Parameters<typeof recoveryContext>):ReturnType<typeof recoveryContext> {
 return recoveryContext(args[0],args[1],args[2],args[3],{anchor:authority,...args[4]});
}
