// Genuine provider Worker/SQLite namespace. Test-only capability bindings allow
// explicit synthetic initialization; no deployed writer or credential is created.
import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
import {kCurrentWorker} from 'miniflare';
const identities=[{workspace_id:'ws_example',object_name:'provider_runtime'}];
export default defineConfig({plugins:[cloudflareTest({main:'./workers/recovery-anchor/src/index.ts',additionalExports:{RecoveryAnchorDO:'DurableObject',RecoveryAnchorWriter:'WorkerEntrypoint',RecoveryAnchorBootstrap:'WorkerEntrypoint'},remoteBindings:false,miniflare:{compatibilityDate:'2026-10-19',bindings:{ANCHOR_POLICY:JSON.stringify({environment_id:'runtime_test',identities,writers:{rotation:identities,bootstrap:identities}})},durableObjects:{ANCHORS:{className:'RecoveryAnchorDO',useSQLite:true}},serviceBindings:{TEST_BOOTSTRAP:{name:kCurrentWorker,entrypoint:'RecoveryAnchorBootstrap'},TEST_WRITER:{name:kCurrentWorker,entrypoint:'RecoveryAnchorWriter'}}}})],test:{include:['test/recovery/anchor-provider-runtime.test.ts'],fileParallelism:false}});
