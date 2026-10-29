// Test-only source/target composition and read-count instrumentation. Every
// counted read delegates to the actual private provider service binding; no Map,
// cached tuple, or synthetic freshness response participates in this path.
export {default} from '../../src/index';
import {WorkspaceDO as ProductWorkspaceDO} from '../../src/workspace/workspace-do';
import type {WorkspaceEnvironment} from '../../src/workspace/context';
type TestEnvironment=WorkspaceEnvironment&{TARGET_WORKSPACE:DurableObjectNamespace<ProductWorkspaceDO>;NO_ANCHOR_WORKSPACE:DurableObjectNamespace<ProductWorkspaceDO>;TARGET_ARTIFACT_BUCKET:R2Bucket;TARGET_ANCHOR:NonNullable<WorkspaceEnvironment['RECOVERY_ANCHOR']>};
export class WorkspaceDO extends ProductWorkspaceDO {
 private counts:{reads:number};
 constructor(ctx:DurableObjectState,env:WorkspaceEnvironment){const counts={reads:0},reader=env.RECOVERY_ANCHOR;super(ctx,{...env,RECOVERY_ANCHOR:reader?{fetch:async request=>{counts.reads++;return reader.fetch(request);}}:undefined});this.counts=counts;}
 anchorReadCount(){return this.counts.reads;}
}
export class TargetWorkspaceDO extends WorkspaceDO {
 constructor(ctx:DurableObjectState,env:TestEnvironment){super(ctx,{...env,WORKSPACE:env.TARGET_WORKSPACE,ARTIFACT_BUCKET:env.TARGET_ARTIFACT_BUCKET,RECOVERY_ENVIRONMENT_ID:'current_target',RECOVERY_ANCHOR:env.TARGET_ANCHOR});}
}
export class NoAnchorWorkspaceDO extends WorkspaceDO {
 constructor(ctx:DurableObjectState,env:TestEnvironment){super(ctx,{...env,WORKSPACE:env.NO_ANCHOR_WORKSPACE,RECOVERY_ANCHOR:undefined,RECOVERY_ANCHOR_BINDING_ID:undefined});}
}
