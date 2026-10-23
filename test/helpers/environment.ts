import example from '../../examples/config/deployment.example.json';
import bundleExample from '../../examples/config/r1-bootstrap.example.json';
import type { VerificationBundle } from '../../src/config/generated/validators.js';
import { parseDeployment } from '../../src/config/deployment';
import { prepareBootstrap, sha256, canonicalJson } from '../../src/config/bootstrap';
import type { RecoveryOperatorContext } from '../../src/workspace/context';
export const nowMs = Date.parse('2026-10-23T00:00:00Z');
export async function fixture(name: string, epoch = 1) {
 const config=structuredClone(example); config.config_epoch=epoch; config.workspace_catalog[0].object_name=name;
 const bundle=structuredClone(bundleExample) as VerificationBundle; bundle.config_epoch=epoch;
 bundle.config_digest=await sha256(canonicalJson(config));
 return {config:parseDeployment(config),bundle};
}
export async function prepared(name: string,epoch=1) {
 const {config,bundle}=await fixture(name,epoch);return prepareBootstrap(config,bundle,'ws_example');
}
export const operator=(expectedEpoch=0, expectedInstallationDigest: string|null=null):RecoveryOperatorContext=>({
 principalId:'synthetic_operator',workspaceId:'ws_example',requestId:'req_fixture',operation:'install',
 expectedEpoch,expectedInstallationDigest
});
