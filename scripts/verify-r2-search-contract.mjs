import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const encoder=new TextEncoder();
const text=value=>{if(typeof value!=='string')throw new Error('INVALID_REQUEST');return value;};

/** Static scalar contract tooling only. No SQL, resource authorization, scanning,
 * pagination, cursor creation or artifact/file-content search is implemented.
 * Bound the decoded query before AND after normalization; do not trim or fold.
 */
export function normalizeSearchQuery(value){
 const raw=text(value);
 if(!raw.length)throw new Error('INVALID_REQUEST');
 if(encoder.encode(raw).byteLength>2048)throw new Error('LIMIT_EXCEEDED');
 const normalized=raw.normalize('NFC');
 if(encoder.encode(normalized).byteLength>2048)throw new Error('LIMIT_EXCEEDED');
 return normalized;
}

export function literalSearchMatch(value,query){
 return text(value).normalize('NFC').includes(normalizeSearchQuery(query));
}

/** A prefix snippet for scalar fixtures, not an authorized product projection. */
export function searchSnippet(value){
 return Array.from(text(value).normalize('NFC')).slice(0,256).join('');
}

export function run(){
 const fixture=JSON.parse(readFileSync(new URL('../examples/search/literal-cases.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(fixture).sort(),['cases','status']);
 assert.equal(fixture.status,'static-contract-only');
 assert(Array.isArray(fixture.cases)&&fixture.cases.length>0);
 const names=new Set();
 for(const item of fixture.cases){
  assert.deepEqual(Object.keys(item).sort(),['matches','name','query','text']);
  assert.equal(typeof item.name,'string');assert(item.name.length>0&&!names.has(item.name));names.add(item.name);
  assert.equal(typeof item.matches,'boolean');
  assert.equal(literalSearchMatch(item.text,item.query),item.matches,'literal fixture '+item.name);
 }
 return {scope:'static-search-scalar-contract',cases:fixture.cases.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(run()));}catch(error){console.error(error.message);process.exitCode=1;}
}
