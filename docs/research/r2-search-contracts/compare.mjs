import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const CAP=2000,LIMIT=1;
let hiddenSequence=0;
const visible=id=>({visible:true,id}),hidden=()=>({visible:false,id:'hidden_'+(++hiddenSequence)});
const fail={status:503,error:{code:'DEPENDENCY_UNAVAILABLE'}};
// Pure array model: NOT SQLite/Workers query execution or production authorization.
// Scanned candidates have already been placed in immutable global order.
// Array end models reaching an established high-water ceiling, not an uncounted
// extra candidate read. Real implementation must prove this bounded seek/end test.
function page(rows,start,mode){
 let examined=0,i=start;const found=[];
 while(i<rows.length&&examined<CAP){
  const item=rows[i];examined++;i++;
  if(item.visible)found.push({id:item.id,position:i});
  if(mode==='candidate'&&found.length===LIMIT)break;
  if(mode==='authorized'&&found.length===LIMIT+1)break;
 }
 if(mode==='candidate')return {public:{status:200,data:found.map(x=>x.id),has_more:i<rows.length},next:i,examined};
 const lookahead=found.length>LIMIT;
 if(!lookahead&&i<rows.length)return {public:fail,next:null,examined};
 const emitted=found.slice(0,LIMIT);
 // Continuation position is last RETURNED authorized resource, not hidden frontier.
 return {public:{status:200,data:emitted.map(x=>x.id),has_more:lookahead},next:lookahead?emitted.at(-1).position:null,examined};
}
function traverse(rows,mode){
 const publicPages=[],examined=[];let position=0;
 do{
  const p=page(rows,position,mode);publicPages.push(p.public);examined.push(p.examined);
  assert(p.examined<=CAP,'candidate cap breached');
  if(p.public.status===503||!p.public.has_more)break;
  assert(p.next>position,'no monotonic authorized progress');position=p.next;
 }while(true);
 return {public_pages:publicPages,examined_per_request:examined};
}
const hs=n=>Array.from({length:n},hidden);
const cases={
 empty:[],hidden_1:hs(1),hidden_2000:hs(2000),hidden_2001:hs(2001),hidden_4001:hs(4001),
 visible_only:[visible('v1'),visible('v2'),visible('v3')],
 hidden_prefix:[...hs(1998),visible('v1'),visible('v2'),visible('v3')],
 hidden_between:[visible('v1'),...hs(1000),visible('v2'),...hs(900),visible('v3')],
 hidden_suffix:[visible('v1'),visible('v2'),visible('v3'),...hs(1999)],
 excessive_prefix:[...hs(2000),visible('v1'),visible('v2'),visible('v3')],
 excessive_suffix:[visible('v1'),visible('v2'),visible('v3'),...hs(2000)],
};
const results=Object.fromEntries(Object.entries(cases).map(([name,rows])=>[name,{candidates:rows.length,candidate:traverse(rows,'candidate'),authorized:traverse(rows,'authorized')}]));
const baseline=results.visible_only.authorized.public_pages;
for(const name of ['hidden_prefix','hidden_between','hidden_suffix'])assert.deepEqual(results[name].authorized.public_pages,baseline,name+' successful transcript changed');
for(const name of ['empty','hidden_1','hidden_2000'])assert.deepEqual(results[name].authorized.public_pages,[{status:200,data:[],has_more:false}]);
for(const name of ['hidden_2001','hidden_4001','excessive_prefix'])assert.deepEqual(results[name].authorized.public_pages,[fail]);
assert.notDeepEqual(results.empty.candidate.public_pages,results.hidden_2001.candidate.public_pages,'old model must demonstrate leakage');
assert.deepEqual(results.excessive_suffix.authorized.public_pages.at(-1),fail);
// Exhaustive finite family: same three visible records, 0..8 hidden rows in each gap.
let variants=0;
for(let a=0;a<=8;a++)for(let b=0;b<=8;b++)for(let c=0;c<=8;c++)for(let d=0;d<=8;d++){
 const rows=[...hs(a),visible('v1'),...hs(b),visible('v2'),...hs(c),visible('v3'),...hs(d)];
 assert.deepEqual(traverse(rows,'authorized').public_pages,baseline);variants++;
}
// Real WebCrypto length experiment with fresh nonces. Padding is illustrative,
// not a specified wire format, production codec, or supported cursor-fit proof.
const key=await crypto.subtle.importKey('raw',new Uint8Array(32),{name:'AES-GCM'},false,['encrypt']);
const cryptoLengths=[];
for(const n of [1,100])for(const padded of [false,true]){
 const raw=new TextEncoder().encode(JSON.stringify({lastScanned:{createdAt:1,id:'h'.repeat(n)}}));
 const clear=padded?new Uint8Array(256):raw;if(padded)clear.set(raw);
 const nonce=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},key,clear);
 cryptoLengths.push({hidden_id_bytes:n,padded,raw_plaintext_bytes:raw.length,encrypted_plaintext_bytes:clear.length,ciphertext_tag_bytes:encrypted.byteLength,encoded_cursor_bytes:Buffer.concat([Buffer.from(nonce),Buffer.from(encrypted)]).toString('base64url').length});
}
assert.equal(cryptoLengths.filter(x=>x.padded)[0].encoded_cursor_bytes,cryptoLengths.filter(x=>x.padded)[1].encoded_cursor_bytes);
const output={timestamp_utc:new Date().toISOString(),scope:'synthetic static pagination model and WebCrypto length experiment; NOT product tests',node:process.version,cap:CAP,limit:LIMIT,script_sha256:createHash('sha256').update(await import('node:fs/promises').then(fs=>fs.readFile(fileURLToPath(import.meta.url)))).digest('hex'),asserted_successful_hidden_insertion_variants:variants,cases:results,crypto_lengths:cryptoLengths,decision:'authorized-only continuation; preserve cap; whole-request generic503 if lookahead/termination unproven at cap',limitations:['Array model does not prove actual SQLite physical work or bounded Workers execution.','Candidate cap is per request; physical query/authorization cost must be proven before activation.','503 availability and timing remain observable side channels; successful transcript invariance does not remove them.','Changing authorization between requests is outside fixed-grants model.','Padding format, maximum supported identifiers and cursor-fit proof belong to shared implementation owners.']};
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({variants,cases:Object.keys(cases).length,decision:output.decision,crypto_lengths:cryptoLengths},null,2));
