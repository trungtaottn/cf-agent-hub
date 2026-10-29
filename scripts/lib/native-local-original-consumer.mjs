import {types} from 'node:util';
/** Fixed private byte-to-safe-record pairing. Not independent authority. */
import {createHash} from 'node:crypto';
import {localOriginalRoster,snapshotLocalOriginalBytes} from './native-local-originals.mjs';
const fail=()=>{throw Error('LOCAL_ORIGINAL_CONSUMER_REJECTED');},check=v=>{if(!v)fail();};
const hash=v=>createHash('sha256').update(v).digest('hex');
function closed(v,keys){check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===keys.length);return Object.fromEntries(keys.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
function array(v,n){check(v&&!types.isProxy(v)&&Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(ds.length.value===n&&Reflect.ownKeys(ds).length===n+1);return Array.from({length:n},(_,i)=>{check(ds[i]?.enumerable&&Object.hasOwn(ds[i],'value'));return ds[i].value;});}
const names=['foreignState','foreignRoute','revocation'],producers=['foreign-state','foreign-route','revocation'];
export function createLocalOriginalConsumer(identities){
 const supplied=closed(identities,names),expected=names.map((n,i)=>{const x=closed(supplied[n],['producer','capture_id']);check(x.producer===producers[i]&&typeof x.capture_id==='string'&&/^capture_[a-f0-9]{32}$/.test(x.capture_id));return Object.freeze(x);});check(new Set(expected.map(x=>x.capture_id)).size===3);let used=false;
 return Object.freeze({consume(value){check(!used);used=true;const all=closed(value,names),manifest=[];let total=0;
  for(let g=0;g<names.length;g++){
   const pair=closed(all[names[g]],['originals','records']),o=closed(pair.originals,['type','version','producer','capture_id','assurance','durability','status','entries']),producer=producers[g],roster=localOriginalRoster(producer);
   check(o.type==='local-captured-originals'&&o.version===1&&o.producer===producer&&o.capture_id===expected[g].capture_id&&o.assurance==='source-test-only'&&o.durability==='memory-only'&&o.status==='complete');
   const originals=array(o.entries,roster.length),records=array(pair.records,roster.length),entries=[];
   for(let i=0;i<roster.length;i++){
    const r=roster[i],e=closed(originals[i],['sequence','kind','selector','sha256','byte_size','bytes']);check(e.sequence===i+1&&e.kind===r.kind&&e.selector===r.selector&&typeof e.sha256==='string'&&/^[a-f0-9]{64}$/.test(e.sha256)&&Number.isSafeInteger(e.byte_size)&&e.byte_size>=0&&e.byte_size<=r.maxBytes);
    // All envelope lengths are source-bounded before detached verification copies.
    const bytes=snapshotLocalOriginalBytes(e.bytes,r.maxBytes,e.kind==='http-response');check(bytes.length===e.byte_size&&hash(bytes)===e.sha256);total+=bytes.length;check(total<=1802240);
    let s;
    if(producer==='foreign-state'){s=closed(records[i],['kind','side','selector','ordinal','sha256','byte_size']);check(s.kind==='local-foreign-selected'&&s.side===r.selector.slice(0,1)&&s.selector===r.selector.slice(2)&&s.ordinal===i+1);}
    else if(producer==='foreign-route'){s=closed(records[i],['kind','scope','operation','key','request_sha256','response_sha256','response_bytes','status']);check(s.kind==='local-foreign-route'&&s.key===r.selector&&s.scope===(i===0?'b':'a')&&s.operation===['createTask','createRuntime','createTask','readyTask','claimTask','submitTaskResult','submitTaskResult','createTask','readyTask','claimTask','failTask','failTask'][i]&&typeof s.request_sha256==='string'&&/^[a-f0-9]{64}$/.test(s.request_sha256)&&Number.isInteger(s.status)&&s.status>=100&&s.status<=599);s={sha256:s.response_sha256,byte_size:s.response_bytes};}
    else if(r.kind==='selected-json'){s=closed(records[i],['kind','selector','sha256','byte_size']);check(s.kind==='local-sql-observation'&&s.selector===r.selector);}
    else if(r.kind==='http-response'){s=closed(records[i],['kind','status','sha256','byte_size']);check(s.kind==='local-native-response'&&Number.isInteger(s.status)&&s.status>=100&&s.status<=599);}
    else{s=closed(records[i],['kind','sha256','byte_size']);check(s.kind==='local-human-revoke-response');}
    check(s.sha256===e.sha256&&s.byte_size===e.byte_size);entries.push({sequence:e.sequence,kind:e.kind,selector:e.selector,sha256:e.sha256,byte_size:e.byte_size});
   }
   manifest.push({...expected[g],entries});
  }
  const encoded=JSON.stringify(manifest);check(Buffer.byteLength(encoded)<=65536);
  return Object.freeze({type:'local-capture-pairing',version:1,status:'local-captures-matched',nativeConformance:false,durability:'memory-only',records:98,byte_size:total,manifest_sha256:hash(encoded)});
 }});
}
