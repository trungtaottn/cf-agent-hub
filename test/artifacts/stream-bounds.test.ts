import {it,expect} from 'vitest';
import {inspectArtifactStream} from '../../src/artifacts/stream';
it('serial digest pump preserves downstream backpressure with one source chunk held',async()=>{
 let pulls=0,writeCalls=0,maxWrite=0,release!:()=>void,started!:()=>void;
 const blocked=new Promise<void>(r=>{release=r;}),writing=new Promise<void>(r=>{started=r;});
 const body=new ReadableStream<Uint8Array>({pull(c){pulls++;if(pulls===3)c.close();else c.enqueue(new Uint8Array(131072));}},{highWaterMark:0});
 const sink=new WritableStream<Uint8Array>({async write(chunk){writeCalls++;maxWrite=Math.max(maxWrite,chunk.length);if(writeCalls===1){started();await blocked;}}}).getWriter();
 const begin=performance.now(),pending=inspectArtifactStream(body,262144,sink);await writing;await Promise.resolve();expect(pulls).toBe(1);expect(writeCalls).toBe(1);release();expect(await pending).toMatchObject({byteSize:262144});expect(maxWrite).toBe(65536);expect(writeCalls).toBe(4);expect(pulls).toBe(3);
 console.info(JSON.stringify({experiment:'production-backpressure',bytes:262144,sourceChunks:2,maxSourceChunk:131072,maxSinkChunk:maxWrite,pullsWhileSinkBlocked:1,elapsedMs:performance.now()-begin}));
});
it('source error aborts downstream and sink error cancels upstream without draining more chunks',async()=>{
 let aborted=false;const sourceError=new Error('synthetic-source');const failedSource=new ReadableStream<Uint8Array>({pull(c){c.error(sourceError);}},{highWaterMark:0});const sink=new WritableStream<Uint8Array>({abort(){aborted=true;}}).getWriter();await expect(inspectArtifactStream(failedSource,5,sink)).rejects.toBe(sourceError);expect(aborted).toBe(true);
 let pulls=0,cancelled=false;const source=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(5));},cancel(){cancelled=true;}},{highWaterMark:0}),sinkError=new Error('synthetic-sink'),failedSink=new WritableStream<Uint8Array>({write(){throw sinkError;}}).getWriter();await expect(inspectArtifactStream(source,5,failedSink)).rejects.toBe(sinkError);expect(pulls).toBe(1);expect(cancelled).toBe(true);
});
