import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';

describe('locked artifact runtime primitives',()=>{
 it('conditionally creates an immutable object and refuses overwrite',async()=>{
  const key='synthetic-artifact-research/'+crypto.randomUUID();
  const options={onlyIf:new Headers({'If-None-Match':'*'})};
  const first=await (env as unknown as {ARTIFACT_BUCKET:R2Bucket}).ARTIFACT_BUCKET.put(key,'original',options);
  expect(first).not.toBeNull();
  expect(await (env as unknown as {ARTIFACT_BUCKET:R2Bucket}).ARTIFACT_BUCKET.put(key,'delayed mutation',options)).toBeNull();
  expect(await (await (env as unknown as {ARTIFACT_BUCKET:R2Bucket}).ARTIFACT_BUCKET.get(key))!.text()).toBe('original');
  await (env as unknown as {ARTIFACT_BUCKET:R2Bucket}).ARTIFACT_BUCKET.delete(key);
 });
 it('incrementally hashes bounded chunks and streams an exact-size body without tee',async()=>{
  const key='synthetic-artifact-research/'+crypto.randomUUID(),size=10*1024*1024;
  const digest=new (crypto as Crypto & {DigestStream:typeof DigestStream}).DigestStream('SHA-256'),hasher=digest.getWriter();
  const fixed=new FixedLengthStream(size),writer=fixed.writable.getWriter();
  const put=(env as unknown as {ARTIFACT_BUCKET:R2Bucket}).ARTIFACT_BUCKET.put(key,fixed.readable,{onlyIf:new Headers({'If-None-Match':'*'})});
  const start=performance.now();let chunks=0,max=0;
  for(let count=0;count<size;count+=65536){const chunk=new Uint8Array(Math.min(65536,size-count)).fill(7);max=Math.max(max,chunk.byteLength);await hasher.write(chunk);await writer.write(chunk);chunks++;}
  await hasher.close();await writer.close();const object=await put;
  const hash=[...new Uint8Array(await digest.digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  expect(object?.size).toBe(size);expect(hash).toBe('448c5a66d3f3df0d61a72afad0e438baef03b03a2981254cd5eb51a5c063ea23');
  expect(max).toBe(65536);expect(chunks).toBe(160);
  console.info(JSON.stringify({experiment:'DigestStream+FixedLengthStream',bytes:size,chunks,maxApplicationChunk:max,elapsedMs:performance.now()-start}));
  await (env as unknown as {ARTIFACT_BUCKET:R2Bucket}).ARTIFACT_BUCKET.delete(key);
 });
});
