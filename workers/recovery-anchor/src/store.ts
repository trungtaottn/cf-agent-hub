import {closed,isSlug,canonicalBytes} from '../../../src/recovery/encoding';
import {identity,canonical,reject} from './policy';
import type {AnchorStorage,Identity,Capability,Receipt,Publication,Anchor,Tuple} from './types';
const positive=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>0;
const hash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function tuple(x:unknown):asserts x is Tuple {if(!closed(x,['authority_epoch','ledger_sha256','generation'])||!positive(x.authority_epoch)||!positive(x.generation)||!hash(x.ledger_sha256))reject();}
function publication(x:unknown):asserts x is Publication {
 if(!closed(x,['workspace_id','environment_id','object_name','operation_id','expected','next']))reject();
 identity({workspace_id:x.workspace_id,environment_id:x.environment_id,object_name:x.object_name});
 if(!isSlug(x.operation_id)||!closed(x.next,['authority_epoch','ledger_sha256'])||!positive(x.next.authority_epoch)||!hash(x.next.ledger_sha256))reject();
 if(x.expected!==null)tuple(x.expected);
 if(canonicalBytes(x).length>2048)reject();
}
const identityOf=(x:any):Identity=>({workspace_id:x.workspace_id,environment_id:x.environment_id,object_name:x.object_name});
/** One provider DO owns one immutable identity. No reset, prune or import API. */
export class AnchorStore {
 constructor(private storage:AnchorStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS anchor_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL)');storage.sql.exec('INSERT OR IGNORE INTO anchor_schema(singleton,version) VALUES(1,1)');const versions=storage.sql.exec('SELECT version FROM anchor_schema').toArray();if(versions.length!==1||versions[0].version!==1)reject();storage.sql.exec('CREATE TABLE IF NOT EXISTS anchor_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity TEXT NOT NULL, authority_epoch INTEGER NOT NULL, ledger_sha256 TEXT NOT NULL, generation INTEGER NOT NULL)');storage.sql.exec('CREATE TABLE IF NOT EXISTS anchor_receipts (operation_id TEXT PRIMARY KEY, record TEXT NOT NULL, byte_size INTEGER NOT NULL)');}
 current(input:Identity):Anchor|null {
  identity(input);const rows=this.storage.sql.exec('SELECT * FROM anchor_state').toArray();if(rows.length===0)return null;if(rows.length!==1)reject();const r=rows[0];
  if(r.identity!==canonical(input))reject();const t={authority_epoch:r.authority_epoch,ledger_sha256:r.ledger_sha256,generation:r.generation};tuple(t);return {...input,...t};
 }
 publish(value:unknown,capability:Capability):Receipt {
  if(capability!=='bootstrap'&&capability!=='rotation')reject();publication(value);const input:Publication=JSON.parse(canonical(value)),id=identityOf(input);
  if(capability==='bootstrap'&&input.expected!==null||capability==='rotation'&&input.expected===null)reject();
  return this.storage.transactionSync(()=>{
   const current=this.current(id);
   const prior=this.storage.sql.exec('SELECT record,byte_size FROM anchor_receipts WHERE operation_id=?',input.operation_id).toArray();
   if(prior.length){const raw=prior[0].record;if(typeof raw!=='string'||canonicalBytes(JSON.parse(raw)).length!==prior[0].byte_size||new TextEncoder().encode(raw).length>2048)reject();const record:any=JSON.parse(raw);if(!closed(record,['input','receipt'])||canonical(record.input)!==canonical(input)||(record.receipt as any)?.capability!==capability)reject();
    const r:any=record.receipt;if(!closed(r,['operation_id','capability','anchor'])||r.operation_id!==input.operation_id||!closed(r.anchor,['workspace_id','environment_id','object_name','authority_epoch','ledger_sha256','generation']))reject();identity(identityOf(r.anchor));tuple({authority_epoch:r.anchor.authority_epoch,ledger_sha256:r.anchor.ledger_sha256,generation:r.anchor.generation});if(canonical(identityOf(r.anchor))!==canonical(id)||!current||Number(r.anchor.generation)>current.generation||r.anchor.authority_epoch!==input.next.authority_epoch||r.anchor.ledger_sha256!==input.next.ledger_sha256||r.anchor.generation!==(input.expected?input.expected.generation+1:1))reject();return r as unknown as Receipt;
   }
   if(capability==='bootstrap'){if(current)reject();}else{if(!current||canonical(input.expected)!==canonical({authority_epoch:current.authority_epoch,ledger_sha256:current.ledger_sha256,generation:current.generation})||current.generation===Number.MAX_SAFE_INTEGER||input.next.authority_epoch<=current.authority_epoch)reject();}
   const receipt:Receipt={operation_id:input.operation_id,capability,anchor:{...id,...input.next,generation:current?current.generation+1:1}};
   const record=canonical({input,receipt}),size=new TextEncoder().encode(record).length;if(size>2048)reject();
   const counts=this.storage.sql.exec('SELECT count(*) AS count, coalesce(sum(byte_size),0) AS bytes FROM anchor_receipts').toArray()[0];if(!Number.isSafeInteger(counts.count)||!Number.isSafeInteger(counts.bytes)||Number(counts.count)<0||Number(counts.bytes)<0||Number(counts.count)>=1024||Number(counts.bytes)+size>2097152)reject();
   this.storage.sql.exec('INSERT INTO anchor_state(singleton,identity,authority_epoch,ledger_sha256,generation) VALUES(1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET authority_epoch=excluded.authority_epoch,ledger_sha256=excluded.ledger_sha256,generation=excluded.generation',canonical(id),receipt.anchor.authority_epoch,receipt.anchor.ledger_sha256,receipt.anchor.generation);
   this.storage.sql.exec('INSERT INTO anchor_receipts(operation_id,record,byte_size) VALUES(?,?,?)',input.operation_id,record,size);return receipt;
  });
 }
}
