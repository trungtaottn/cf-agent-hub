import {request} from 'node:https';
import {approvedHttpsUrl,parseDeployment,resolveWorkspace} from '../../src/config/deployment.ts';
import {prepareBootstrap} from '../../src/config/bootstrap.ts';
import {validateInstall} from '../../src/recovery/generated/install-validator.js';
import {readProtectedJson,fail} from './protected-io.mjs';
import {integrityKey,authenticateBundle} from './bundle-integrity.mjs';
const slug=x=>typeof x==='string'&&/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(x)&&x.length<=128;
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
function parseOperator(value){
 if(!closed(value,['origin','environment_id','workspace_id','allowed_workspace_ids','service','integrity_key','operation_id','expected_authority_epoch','reason']))fail();
 if(typeof value.origin!=='string'||new URL(value.origin).origin!==value.origin||!approvedHttpsUrl(value.origin+'/')||
  !slug(value.environment_id)||!slug(value.workspace_id)||!slug(value.operation_id)||!Number.isSafeInteger(value.expected_authority_epoch)||value.expected_authority_epoch<0||
  typeof value.reason!=='string'||value.reason.length<1||value.reason.length>1024)fail();
 const allowed=value.allowed_workspace_ids,service=value.service;
 if(!Array.isArray(allowed)||allowed.length<1||allowed.length>1000||allowed.some(x=>!slug(x))||new Set(allowed).size!==allowed.length||!allowed.includes(value.workspace_id)||
  !closed(service,['client_id','client_secret','principal_id'])||!slug(service.principal_id)||
  typeof service.client_id!=='string'||service.client_id.length<1||service.client_id.length>2048||
  typeof service.client_secret!=='string'||service.client_secret.length<1||service.client_secret.length>4096||/[\r\n]/.test(service.client_id+service.client_secret))fail();
 return value;
}
async function transport(operator,body){
 return new Promise((resolve,reject)=>{
  const outgoing=request(new URL(operator.origin+'/operator/recovery'),{method:'POST',agent:false,headers:{
   'content-type':'application/json','content-length':Buffer.byteLength(body),
   'CF-Access-Client-Id':operator.service.client_id,'CF-Access-Client-Secret':operator.service.client_secret
  }},response=>{
   if(response.statusCode!==200){response.resume();reject(Error('OPERATOR_STATUS'));return;}
   let total=0;const chunks=[];
   response.on('data',chunk=>{total+=chunk.length;if(total>65536){response.destroy(Error('OPERATOR_RESPONSE_LIMIT'));return;}chunks.push(chunk);});
   response.on('error',reject);
   response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('OPERATOR_RESPONSE'));}});
  });
  const timeout=setTimeout(()=>outgoing.destroy(Error('OPERATOR_TIMEOUT')),5000);
  outgoing.on('close',()=>clearTimeout(timeout));outgoing.on('error',reject);outgoing.end(body);
 });
}
export async function install(options){
 const operator=parseOperator(readProtectedJson(options['--operator-config'],65536));
 const config=parseDeployment(readProtectedJson(options['--config'])),bundle=readProtectedJson(options['--bundle']);
 authenticateBundle(bundle,integrityKey(operator.integrity_key));
 const prepared=await prepareBootstrap(config,bundle,operator.workspace_id),mapping=resolveWorkspace(config,operator.workspace_id);
 const envelope={operation:'install',workspace_id:operator.workspace_id,capture_id:null,expected_authority_epoch:operator.expected_authority_epoch,operation_id:operator.operation_id,reason:operator.reason,payload:{config,verification_bundle:bundle}};
 if(!validateInstall(envelope))fail();
 const body=JSON.stringify(envelope);if(Buffer.byteLength(body)>65536)fail();
 const result=await transport(operator,body),receipt=result?.data;
 if(!closed(result,['request_id','data'])||typeof result.request_id!=='string'||!result.request_id.length||
  !closed(receipt,['workspace_id','object_name','epoch','installation_digest','operator_principal_id','operation_id','original_request_id'])||
  receipt.workspace_id!==operator.workspace_id||receipt.object_name!==mapping.objectName||receipt.epoch!==config.config_epoch||receipt.installation_digest!==prepared.installationDigest||
  receipt.operator_principal_id!==operator.service.principal_id||receipt.operation_id!==operator.operation_id||typeof receipt.original_request_id!=='string'||!receipt.original_request_id.length)fail();
 process.stdout.write(JSON.stringify({operation:'install',environment_id:operator.environment_id,request_id:result.request_id,receipt})+'\n');
}
