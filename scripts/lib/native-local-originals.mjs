import {types} from 'node:util';
/** Bounded private local captures, never native authority or durable evidence. */
import {createHash,randomBytes} from 'node:crypto';
const reject=()=>{throw Error('LOCAL_ORIGINAL_CAPTURE_REJECTED');};
const check=v=>{if(!v)reject();};
const row=(kind,selector,maxBytes)=>Object.freeze({kind,selector,maxBytes});
const selected=selector=>row('selected-json',selector,16384);
const tables=['tasks','runs','task_results','task_acceptances','events','task_history','idempotency_outcomes'];
const phase=[...['A','B'].flatMap(side=>tables.map(t=>selected(side+':'+t))),...['A:credential','A:runtime','A:metadata','B:metadata'].map(selected)];
const sql=['credential','runtime','metadata','grant'].map(selected);
const rosters=Object.freeze({
 'foreign-state':Object.freeze([ ...phase,...phase,selected('A:positive'),...phase,...phase,selected('A:positive') ]),
 'foreign-route':Object.freeze(['foreign_b_create','foreign_enroll',...['submit','fail'].flatMap(k=>['create','ready','claim','negative','positive'].map(s=>'foreign_'+k+'_'+s))].map(s=>row('http-response',s,16384))),
 revocation:Object.freeze([row('http-response','enroll',65536),row('http-response','own-positive',65536),...sql,row('returned-object','human-revoke',65536),...sql,row('http-response','fresh-denial',65536)])
});
export function localOriginalRoster(producer){check(typeof producer==='string'&&Object.hasOwn(rosters,producer));return rosters[producer];}
function closed(value,keys){check(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(ds).length===keys.length);return Object.fromEntries(keys.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
const typed=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get;
/** Admission precedes copying. No shared backing, custom accessor or caller code. */
export function snapshotLocalOriginalBytes(value,maxBytes,allowEmpty=false){
 check(value&&!types.isProxy(value)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value)));
 const length=getLength.call(value),buffer=getBuffer.call(value);check(Object.getPrototypeOf(buffer)===ArrayBuffer.prototype&&Number.isSafeInteger(maxBytes)&&maxBytes>=0&&maxBytes<=65536&&length<=maxBytes&&(allowEmpty||length>0));
 check(Reflect.ownKeys(value).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));
 const result=new Uint8Array(length);Uint8Array.prototype.set.call(result,value);return Buffer.from(result.buffer);
}
export function createLocalOriginalCapture(producer){
 const roster=localOriginalRoster(producer),identity=Object.freeze({producer,capture_id:'capture_'+randomBytes(16).toString('hex')}),entries=[];let failed=false,total=0;
 const ceiling=roster.reduce((n,r)=>n+r.maxBytes,0);
 return Object.freeze({identity,append(value){try{check(!failed&&entries.length<roster.length);const v=closed(value,['kind','selector','bytes']),expected=roster[entries.length];check(v.kind===expected.kind&&v.selector===expected.selector);const bytes=snapshotLocalOriginalBytes(v.bytes,expected.maxBytes,v.kind==='http-response');check(total+bytes.length<=ceiling);total+=bytes.length;const entry=Object.freeze({sequence:entries.length+1,kind:v.kind,selector:v.selector,sha256:createHash('sha256').update(bytes).digest('hex'),byte_size:bytes.length,bytes});entries.push(entry);const {bytes:privateBytes,...safe}=entry;return Object.freeze(safe);}catch{failed=true;reject();}},read(){return {type:'local-captured-originals',version:1,...identity,assurance:'source-test-only',durability:'memory-only',status:failed?'failed':entries.length===roster.length?'complete':'partial',entries:entries.map(entry=>({...entry,bytes:Buffer.from(entry.bytes)}))};}});
}
