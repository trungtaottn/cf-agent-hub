// Test-only deployment variant proving absence of the trusted capability at actual DO construction.
export {default,WorkspaceDO} from '../../src/index';
import {WorkspaceDO} from '../../src/workspace/workspace-do';
import type {WorkspaceEnvironment} from '../../src/workspace/context';
export class NoAnchorWorkspaceDO extends WorkspaceDO {
 constructor(ctx:DurableObjectState,env:WorkspaceEnvironment&{NO_ANCHOR_WORKSPACE:DurableObjectNamespace<WorkspaceDO>}){
  super(ctx,{...env,WORKSPACE:env.NO_ANCHOR_WORKSPACE,RECOVERY_ANCHOR:undefined,RECOVERY_ANCHOR_BINDING_ID:undefined});
 }
}
