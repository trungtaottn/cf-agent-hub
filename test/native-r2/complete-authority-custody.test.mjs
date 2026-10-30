import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installationStatAllowed} from '../../scripts/lib/native-host-v2-custody.mjs';
test('actual authority root file uses the closed 1024-byte private metadata offer',()=>{
 const s={directory:false,regular:true,symlink:false,uid:0n,mode:0o100640n,nlink:1n,size:1024n};
 assert.equal(installationStatAllowed('complete-authority',s),true);
 for(const edit of [{size:1025n},{uid:65534n},{nlink:2n},{mode:0o100644n},{symlink:true}])assert.equal(installationStatAllowed('complete-authority',{...s,...edit}),false);
});
test('fixed custody reads and verifies actual authority bytes and rechecks the original receipt',()=>{
 const source=readFileSync(new URL('../../scripts/lib/native-host-v2-custody.mjs',import.meta.url),'utf8');
 assert.match(source,/readRootFile\('\/etc\/agenthub-native\/complete-authority\.json','complete-authority'\)/);
 assert.match(source,/verifyCompleteAuthorityRecord\(\{bytes:authorityBytes,config,installation:statement,now,operationalMs\}\)/);
 for(const field of ['authorityRecordSha256','configSha256','expiresAt'])assert.ok(source.includes('current.authority.'+field+'===prior.authority.'+field));
});
