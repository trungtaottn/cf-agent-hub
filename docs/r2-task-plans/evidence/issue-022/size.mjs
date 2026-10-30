const size=x=>Buffer.byteLength(JSON.stringify(x));
const entry=i=>({artifact_id:`artifact_${i.toString().padStart(4,'0')}`,object_key:`artifacts/workspace_example/artifact_${i.toString().padStart(4,'0')}/${'a'.repeat(64)}`,recovery_object_key:`r2/workspace_example/capture_example/artifacts/artifact_${i.toString().padStart(4,'0')}/${'a'.repeat(64)}`,byte_size:10485760,sha256:'a'.repeat(64)});
const base={version:2,artifact_index:0,artifact_bytes:0,pending:null};
const out=[0,1,100,200,1000,1001].map(n=>{const entries=Array.from({length:n},(_,i)=>entry(i));return {n,entriesBytes:size(entries),detailsBytes:size({...base,entries}),checkpointOnlyBytes:size({...base,manifest_sha256:'a'.repeat(64),artifact_count:n})};});
console.log(JSON.stringify({node:process.version,case:'illustrative canonical SHA256 immutable keys; JSON UTF8 byte lengths, not runtime throughput',results:out},null,2));
