import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryLeasePaths,assertOperationCapacity,assertCapacity,RECOVERY_RETENTION_BYTES as bytes,RECOVERY_RETENTION_FILES as files} from '../../scripts/lib/recovery-capacity.mjs';
test('dispatch reserves encoded publication headroom at exact boundary',()=>{assert.doesNotThrow(()=>assertCapacity({bytes:bytes-16*1048576,files:files-16}));assert.throws(()=>assertCapacity({bytes:bytes-16*1048576+1,files:0}),/RECOVERY_RETENTION_LIMIT/);assert.throws(()=>assertCapacity({bytes:0,files:files-15}),/RECOVERY_RETENTION_LIMIT/);});
test('finish reserves state growth plus replacement plus receipt',()=>{assert.doesNotThrow(()=>assertCapacity({bytes:bytes-8*1048576,files:files-8},'finish'));assert.throws(()=>assertCapacity({bytes:bytes-8*1048576+1,files:0},'finish'),/RECOVERY_RETENTION_LIMIT/);});
test('invalid accounting fails closed rather than wrapping or freeing quota',()=>{for(const usage of [{bytes:-1,files:0},{bytes:NaN,files:0},{bytes:0,files:Infinity},{bytes:0,files:1.5}])assert.throws(()=>assertCapacity(usage),/RECOVERY_RETENTION_LIMIT/);assert.throws(()=>assertCapacity({bytes:0,files:0},'unknown'));});

test('persisted attempts and sequence cap precede new dispatch regardless of process budget',()=>{assert.doesNotThrow(()=>assertOperationCapacity(16383,63));for(const [s,a] of [[16384,0],[0,64],[-1,0],[0,NaN]])assert.throws(()=>assertOperationCapacity(s,a),/RECOVERY_RETENTION_LIMIT/);});

test('checkout-protected resources remain denied before either lease is created',async()=>{
 const {acquireRecoveryLease}=await import('../../scripts/lib/recovery-capacity.mjs');
 const {default:fs}=await import('node:fs');const {default:path}=await import('node:path');
 const config={statePath:path.join(process.cwd(),'forbidden-state.enc'),artifactDirectory:process.cwd()};
 assert.throws(()=>acquireRecoveryLease(config),/RECOVERY_INPUT_REJECTED/);
 assert.equal(fs.existsSync(path.join(process.cwd(),'.cfhub-recovery-state.lock')),false);
 assert.equal(fs.existsSync(path.join(process.cwd(),'.cfhub-recovery.lock')),false);
});

test('directory leases intersect for cross-role overlap, not only matching roles',()=>{const a=recoveryLeasePaths({statePath:'/private/y/state',artifactDirectory:'/private/x'}),b=recoveryLeasePaths({statePath:'/private/x/state',artifactDirectory:'/private/z'});assert.equal(a.filter(x=>b.includes(x)).length,1);assert.ok(a.includes('/private/x/.cfhub-recovery.lock'));});
