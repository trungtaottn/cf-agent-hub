import {human,owned} from './settings';
import {messageInput} from './messages';
import {messageCommand} from '../../src/messages/commands';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {CHUNK_LIMIT} from '../../src/recovery/encoding';

/** Planning estimate only. Actual capture output must independently establish chunks/bytes. */
export function estimateCapturePages(storage:DurableObjectStorage){
 const tables:Record<string,{rows:number;rawBytes:number;estimatedChunks:number}>={};let totalChunks=0,totalRows=0,totalRawBytes=0;
 for(const table of TABLE_REGISTRY){
  const sum=table.columns.map(c=>table.name==='login_attempts'&&['nonce','pkce_verifier'].includes(c.name)?'0':`coalesce(length(CAST("${c.name}" AS BLOB)),0)`).join('+');
  const order=table.primaryKey.map(c=>'"'+c+'"').join(',');
  const rows=storage.sql.exec<{byte_size:number}>('SELECT ('+sum+') AS byte_size FROM "'+table.name+'" ORDER BY '+order+' LIMIT 10001').toArray();
  if(rows.length>10000)throw Error('SYNTHETIC_BENCHMARK_ROW_BOUND');
  let chunks=0,rawBytes=0,pageRows=0,estimated=4096;
  for(const row of rows){if(row.byte_size>CHUNK_LIMIT)throw Error('SYNTHETIC_BENCHMARK_ROW_TOO_LARGE');const bound=row.byte_size*6+table.columns.length*32;
   if(pageRows===200||pageRows&&estimated+bound>CHUNK_LIMIT){chunks++;pageRows=0;estimated=4096;}
   pageRows++;estimated+=bound;rawBytes+=row.byte_size;
  }
  if(pageRows)chunks++;tables[table.name]={rows:rows.length,rawBytes,estimatedChunks:chunks};totalChunks+=chunks;totalRows+=rows.length;totalRawBytes+=rawBytes;
 }
 return {tables,totalChunks,totalRows,totalRawBytes};
}
/** Real domain commands seed valid messages and their events/outcomes; no fabricated events or copied relational rows. */
export async function seedNearSqlChunkBudget(storage:DurableObjectStorage,objectName:string,targetChunks=244){
 if(!Number.isInteger(targetChunks)||targetChunks<240||targetChunks>246)throw Error('SYNTHETIC_BENCHMARK_TARGET');
 const workspace=owned(storage,objectName),identity=human(storage),started=performance.now();let messages=0,threadId:string|undefined;
 const seed=async()=>{
  const key='sql_budget_'+messages,body=messageInput({recipient_agent_ids:['agent_research'],body:'x'.repeat(32768),...(threadId?{thread_id:threadId}:{})});
  if(new TextEncoder().encode(body.body).byteLength!==32768)throw Error('SYNTHETIC_BENCHMARK_BODY_BOUND');
  const ctx={workspace,requestId:'request_'+key,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/messages',{},body),admissionEpoch:storage.sql.exec<{config_epoch:number}>('SELECT config_epoch FROM workspace_metadata WHERE id=1').one().config_epoch,admissionGeneration:storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state WHERE id=1').one().generation};
  const result=await executeCommand(ctx,identity,messageCommand(workspace),body);if(result.status!==201)throw Error('SYNTHETIC_BENCHMARK_MESSAGE_REJECTED');threadId=result.data.thread_id;messages++;
 };
 for(;messages<500;)await seed();let estimate=estimateCapturePages(storage);
 while(estimate.totalChunks<targetChunks&&messages<800){const batch=estimate.totalChunks<230?10:1;for(let i=0;i<batch&&messages<800;i++)await seed();estimate=estimateCapturePages(storage);}
 if(estimate.totalChunks<targetChunks||estimate.totalChunks>248)throw Error('SYNTHETIC_BENCHMARK_CHUNK_ESTIMATE_UNREACHABLE');
 if(storage.sql.exec('PRAGMA foreign_key_check').toArray().length)throw Error('SYNTHETIC_BENCHMARK_FOREIGN_KEY_FAILURE');
 return {messages,bodyBytesPerMessage:32768,seedMs:performance.now()-started,estimate};
}
