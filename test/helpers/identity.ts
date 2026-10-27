import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
/** Canonical operator-installed identity-management fixture. Later row edits may only narrow it. */
export async function identityFixture(name:string){
 const raw=await fixture(name);
 raw.config.human_grants[0].scopes=[...new Set([...raw.config.human_grants[0].scopes,'agents:read' as const,'agents:manage' as const,'credentials:manage' as const,'tasks:read' as const])];
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);return {stub,name,input};
}
