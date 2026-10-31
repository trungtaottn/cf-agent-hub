import {CURRENT_SCHEMA_VERSION} from '../src/storage/schema-version.ts';
import {createTestHarness} from 'wrangler';
import {randomBytes} from 'node:crypto';
import {validateLiveness} from '../src/http/generated/auth-validators.js';
let harness;
try{
 if(process.versions.node!=='24.22.1')throw Error('PINNED_NODE_REQUIRED');
 harness=createTestHarness({workers:[{configPath:'./wrangler.jsonc',env:'test'},{configPath:'./workers/recovery-anchor/wrangler.jsonc',env:'test'}]});
 await harness.listen();const worker=harness.getWorker('cf-agent-hub-test');
 const live=await worker.fetch('https://runtime-boot.example.invalid/health/live');
 if(live.status!==200||!validateLiveness(await live.json()))throw Error('LIVENESS_CONTRACT_FAILED');
 const bindings=await worker.getEnv(),name='boot_'+randomBytes(12).toString('hex');
 try{
  const result=await bindings.WORKSPACE.getByName(name).command({workspaceId:'boot_workspace',objectName:name,requestId:'runtime_boot',operation:'readiness'});
  if(result.status!==503||result.code!=='NOT_INSTALLED')throw Error('EMPTY_AUTHORITY_NOT_CLOSED');
  const storage=await worker.getDurableObjectStorage('WORKSPACE',{name});
  const rows=await storage.exec('SELECT MAX(version) AS version FROM schema_migrations');
  if(rows.length!==1||rows[0].version!==CURRENT_SCHEMA_VERSION)throw Error('SQLITE_SCHEMA_BOOT_FAILED');
 }finally{if(typeof bindings[Symbol.dispose]==='function')bindings[Symbol.dispose]();}
 console.log(JSON.stringify({runtime_boot:true,node:process.versions.node,liveness_contract:true,sqlite_schema:CURRENT_SCHEMA_VERSION,empty_authority_closed:true,environment:'local-isolated-runtime'}));
}catch(error){console.log(JSON.stringify({runtime_boot:false,code:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RUNTIME_BOOT_FAILED'}));process.exitCode=1;}
finally{await harness?.close();}
