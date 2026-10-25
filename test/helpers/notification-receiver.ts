// Controlled Node fixture: exact wire verification and durable local effect/receipt transaction.
// This demonstrates receiver-owned recovery, not global exactly-once external execution.
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {validateMessageNotification} from '../../src/http/generated/auth-validators.js';
import type {MessageNotification} from '../../src/http/dto';
export interface ReceiverBinding{workspaceId:string;recipientAgentId:string;key:string;nowSeconds:()=>number;}
const decode=(value:string):Buffer|null=>{
 if(!/^[A-Za-z0-9_-]+$/.test(value))return null;
 const bytes=Buffer.from(value,'base64url');return bytes.toString('base64url')===value?bytes:null;
};
export class NotificationReceiver{
 private readonly db:DatabaseSync;
 constructor(path:string,readonly binding:ReceiverBinding,private readonly beforeComplete?:()=>Promise<void>){
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS deliveries (binding_key TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('claimed','completed')),body_hash TEXT NOT NULL,receipt TEXT);
   CREATE TABLE IF NOT EXISTS effects (binding_key TEXT PRIMARY KEY,effect TEXT NOT NULL);`);
 }
 close(){this.db.close();}
 evidence(){return {deliveries:this.db.prepare('SELECT * FROM deliveries ORDER BY binding_key').all(),effects:this.db.prepare('SELECT * FROM effects ORDER BY binding_key').all()};}
 async receive(request:Request):Promise<Response>{
  const encoded=request.headers.get('X-CF-Agent-Hub-Delivery-Id'),timestamp=request.headers.get('X-CF-Agent-Hub-Timestamp'),signature=request.headers.get('X-CF-Agent-Hub-Signature');
  // Fetch Headers merges duplicates with a comma, which each strict alphabet rejects.
  if(request.method!=='POST'||request.headers.get('content-type')!=='application/json'||!encoded||!timestamp||!signature||!/^v1=[A-Za-z0-9_-]{43}$/.test(signature)||!/^(0|[1-9][0-9]*)$/.test(timestamp))return new Response(null,{status:401});
  const seconds=Number(timestamp),idBytes=decode(encoded),tag=decode(signature.slice(3));
  if(!Number.isSafeInteger(seconds)||!idBytes||!tag||tag.byteLength!==32)return new Response(null,{status:401});
  let deliveryId:unknown;
  try{deliveryId=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(idBytes));}catch{return new Response(null,{status:401});}
  if(typeof deliveryId!=='string'||!deliveryId||Buffer.from(JSON.stringify(deliveryId),'utf8').toString('base64url')!==encoded)return new Response(null,{status:401});
  const key=Buffer.from(this.binding.key,'utf8');if(key.byteLength<32)return new Response(null,{status:503});
  const body=Buffer.from(await request.arrayBuffer());
  // Independently expressed preimage, with Node's constant-work native tag comparison.
  const prefix=Buffer.from(['cf-agent-hub-notification-v1',encoded,timestamp,''].join('\n'),'utf8');
  const expected=createHmac('sha256',key).update(prefix).update(body).digest();
  if(!timingSafeEqual(expected,tag)||Math.abs(this.binding.nowSeconds()-seconds)>300)return new Response(null,{status:401});
  let payload:unknown;
  try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return new Response(null,{status:400});}
  if(!validateMessageNotification(payload)||payload.delivery_id!==deliveryId)return new Response(null,{status:400});
  if(payload.workspace_id!==this.binding.workspaceId||payload.recipient_agent_id!==this.binding.recipientAgentId)return new Response(null,{status:403});
  const notification:MessageNotification=payload,bindingKey=JSON.stringify([this.binding.workspaceId,this.binding.recipientAgentId,deliveryId]),hash=createHash('sha256').update(body).digest('hex');
  let claimed=false,prior:{status:string;body_hash:string;receipt:string|null}|undefined;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const inserted=this.db.prepare("INSERT OR IGNORE INTO deliveries VALUES (?,'claimed',?,NULL)").run(bindingKey,hash);claimed=inserted.changes===1;
   if(!claimed)prior=this.db.prepare('SELECT status,body_hash,receipt FROM deliveries WHERE binding_key=?').get(bindingKey) as typeof prior;
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  if(!claimed){
   if(prior?.body_hash!==hash)return new Response(null,{status:409});
   return prior.status==='completed'&&prior.receipt?new Response(prior.receipt,{status:200,headers:{'content-type':'application/json'}}):new Response(null,{status:503});
  }
  // A crash here leaves durable uncertainty. A duplicate cannot infer completion or rerun effects.
  await this.beforeComplete?.();
  const receipt=JSON.stringify({received:true,delivery_id:deliveryId});
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('INSERT INTO effects VALUES (?,?)').run(bindingKey,JSON.stringify({message_id:notification.message_id}));
   this.db.prepare("UPDATE deliveries SET status='completed',receipt=? WHERE binding_key=? AND status='claimed'").run(receipt,bindingKey);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return new Response(receipt,{status:200,headers:{'content-type':'application/json'}});
 }
}
