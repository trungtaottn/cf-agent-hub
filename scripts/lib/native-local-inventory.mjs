/** Known local fixture literals only. Not DLP, independent authority or native evidence. */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {validateTaskResponse,validateRuntimeIssueResponse} from '../../src/http/generated/auth-validators.js';
import {readLocalInventoryOriginals} from './native-local-original-consumer.mjs';
const fail=()=>{throw Error('LOCAL_INVENTORY_REJECTED');},check=v=>{if(!v)fail();};
const hash=v=>createHash('sha256').update(v).digest('hex');
function closed(v,keys){check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===keys.length);return Object.fromEntries(keys.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
function text(v,min,max){check(typeof v==='string'&&v.length<=max&&Buffer.byteLength(v)>=min&&Buffer.byteLength(v)<=max&&Buffer.from(v).toString('utf8')===v);return v;}
const roster=[['foreign-route','foreign_b_create'],['foreign-route','foreign_enroll'],['foreign-route','foreign_submit_negative'],['foreign-route','foreign_fail_negative'],['revocation','enroll'],['revocation','own-positive'],['revocation','fresh-denial']];
export function createLocalInventoryScanner(configuration){
 const c=closed(configuration,['tokens','fixtureSecrets']),tokens=closed(c.tokens,['submitter','reviewer','revoked','foreign']),fixture=closed(c.fixtureSecrets,['oidc','csrf','cursor']);
 const configured=[...Object.values(tokens),...Object.values(fixture)].map(v=>text(v,16,4096));check(new Set(configured).size===7);let used=false;
 return Object.freeze({scan(pairing){check(!used);used=true;
  const entries=readLocalInventoryOriginals(pairing);check(entries.length===7);let bytes=0;
  for(let i=0;i<7;i++){const e=entries[i];check(e.producer===roster[i][0]&&e.selector===roster[i][1]&&e.bytes.length===e.byte_size&&hash(e.bytes)===e.sha256);bytes+=e.byte_size;}check(bytes<=262144);
  const parse=i=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries[i].bytes));
  const foreign=parse(0);check(validateTaskResponse(foreign)&&foreign.data.workspace_id==='ws_other'&&foreign.data.assigned_agent_id===null);const identifiers=[text(foreign.data.id,1,128),text(foreign.data.workspace_id,1,128)];check(new Set(identifiers).size===2);
  const proofs=[1,4].map((i,j)=>{const v=parse(i);check(validateRuntimeIssueResponse(v)&&v.data.revealed===true&&v.data.runtime.workspace_id==='ws_example'&&v.data.runtime.agent_id===(j===0?'agent_research':'agent_revoke')&&v.data.runtime.status==='online'&&v.data.runtime.runtime_version===1&&typeof v.data.runtime_token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v.data.runtime_token));return v.data.runtime_token;});
  const secrets=[...configured,...proofs];check(new Set(secrets).size===9);const patterns=values=>values.flatMap(v=>[Buffer.from(v),Buffer.from(JSON.stringify(v).slice(1,-1))]);const secretPatterns=patterns(secrets),foreignPatterns=patterns(identifiers);check([...secretPatterns,...foreignPatterns].reduce((n,b)=>n+b.length,0)<=202668);
  const targets=[2,3,5,6].map(i=>{const e=entries[i];return {producer:e.producer,selector:e.selector,sha256:e.sha256,byte_size:e.byte_size,secret_match:secretPatterns.some(p=>e.bytes.includes(p)),foreign_identifier_match:foreignPatterns.some(p=>e.bytes.includes(p))};});check(targets.reduce((n,e)=>n+e.byte_size,0)<=163840);
  const matched=targets.some(e=>e.secret_match||e.foreign_identifier_match),status=matched?'known-match':'no-known-match';
  const original={type:'local-known-inventory-scan',version:1,scope:'source-test-only',native_conformance:false,durability:'memory-only',status,coverage:'literal-utf8-and-json-stringify-content-only',pairing_manifest_sha256:pairing.manifest_sha256,secret_count:9,foreign_identifier_count:2,sources:entries.map(({bytes,...e})=>e),targets};
  const encoded=Buffer.from(JSON.stringify(original));check(encoded.length<=4096);const result={status,nativeConformance:false,targets:4,secretCount:9,foreignIdentifierCount:2,originalSha256:hash(encoded)};Object.defineProperty(result,'readOriginal',{value:()=>({sha256:hash(encoded),bytes:Buffer.from(encoded)})});return Object.freeze(result);
 }});
}
