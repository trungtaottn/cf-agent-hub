import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {fixture} from '../helpers/environment';
import {prepareBootstrap} from '../../src/config/bootstrap';
const canonical=(x:any):string=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
it('installation_digest_matches_adr_material_and_sorted_credentials',async()=>{
 const {config,bundle}=await fixture('digest');
 config.static_credential_refs.push({...config.static_credential_refs[0],credential_id:'credential_a'});
 bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_a',token_sha256:'2'.repeat(64)});
 bundle.retired_credentials=[
  {workspace_id:'ws_example',credential_id:'retired_z',agent_id:'agent_research',token_sha256:'3'.repeat(64),retired_at_epoch:1},
  {workspace_id:'ws_example',credential_id:'retired_a',agent_id:'agent_research',token_sha256:'4'.repeat(64),retired_at_epoch:1}
 ];
 bundle.config_digest=createHash('sha256').update(canonical(config)).digest('hex');
 const expected=createHash('sha256').update(canonical({config,credentials:[bundle.credentials[1],bundle.credentials[0]],retired_credentials:[bundle.retired_credentials[1],bundle.retired_credentials[0]]})).digest('hex');
 expect((await prepareBootstrap(config,bundle,'ws_example')).installationDigest).toBe(expected);
 bundle.credentials.reverse();bundle.retired_credentials.reverse();
 expect((await prepareBootstrap(config,bundle,'ws_example')).installationDigest).toBe(expected);
});
