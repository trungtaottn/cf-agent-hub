import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {readOperatorRequest} from '../../src/recovery/operator';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {OPERATOR_RAW_LIMIT} from '../../src/recovery/operator-envelope';
function command(op='restore',current=true){const c=JSON.parse(readFileSync('examples/recovery/r1-commands.json','utf8')).commands.find((x:{operation:string})=>x.operation===op);if(current&&c.payload.manifest){const m=c.payload.manifest;m.format_version=2;m.checkpoint.contract_revision='0.2';m.checkpoint.schema_version=17;m.database.table_counts=Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,0]));}return c;}
function request(value:unknown,padding=0){return new Request('https://operator.example.invalid/operator/recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)+' '.repeat(padding)});}
describe('operator transport raw and semantic size boundaries',()=>{
 it('preserves legacy413 when oversized input cannot identify a valid JSON envelope',async()=>{
  const body='{"operation":"install","reason":"'+'x'.repeat(66000);
  await expect(readOperatorRequest(new Request('https://operator.example.invalid/operator/recovery',{method:'POST',headers:{'content-type':'application/json'},body}))).rejects.toMatchObject({status:413});
 });
 it.each(['install','probe','capture'])('preserves raw413 before schema validation for malformed oversized legacy %s',async operation=>{
  const body={...command(operation,false),reason:'x'.repeat(66000)};
  await expect(readOperatorRequest(request(body))).rejects.toMatchObject({status:413});
 });
 it('accepts current restore above historical64KiB but rejects the same historical tuple',async()=>{const c=command();const bytes=new TextEncoder().encode(JSON.stringify(c)).length;await expect(readOperatorRequest(request(c,65537-bytes))).resolves.toEqual(c);const old=command('restore',false);await expect(readOperatorRequest(request(old,65537-new TextEncoder().encode(JSON.stringify(old)).length))).rejects.toMatchObject({status:413});});
 it('other operations cannot acquire the larger parser allowance',async()=>{const c=command('probe');const n=JSON.stringify(c).length;await expect(readOperatorRequest(request(c,65536-n))).resolves.toEqual(c);await expect(readOperatorRequest(request(c,65537-n))).rejects.toMatchObject({status:413});});
 it('rejects unknown resolver and raw-count fields before authority lookup',async()=>{for(const field of ['trustedAnchor','resolverUrl','rawBytes'])await expect(readOperatorRequest(request({...command(),[field]:'forged'}))).rejects.toMatchObject({status:400});});
 it('rejects unsupported source versions from larger body allowance',async()=>{for(const v of [15,7]){const c=command();c.payload.manifest.checkpoint.schema_version=v;await expect(readOperatorRequest(request(c,65537-JSON.stringify(c).length))).rejects.toThrow();}});
 it('cancels raw overflow despite false Content-Length and without JSON allocation',async()=>{let cancelled=false;const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(OPERATOR_RAW_LIMIT+1));},cancel(){cancelled=true;}});await expect(readOperatorRequest(new Request('https://operator.example.invalid/operator/recovery',{method:'POST',headers:{'content-type':'application/json','content-length':'1'},body:stream,duplex:'half'} as RequestInit))).rejects.toMatchObject({status:413});expect(cancelled).toBe(true);});
 it.each(['{','null','[]','{"operation":"resume"}'])('rejects malformed or incomplete JSON %s',async body=>{await expect(readOperatorRequest(new Request('https://operator.example.invalid/operator/recovery',{method:'POST',headers:{'content-type':'application/json'},body}))).rejects.toMatchObject({status:400});});
});
