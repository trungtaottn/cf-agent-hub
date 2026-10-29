import {describe,it,expect} from 'vitest';
import {parseControlAdmission} from '../../src/recovery/current-control-admission';
const state={epoch:2,installationDigest:'a'.repeat(64),generation:3,state:'captured',barrierId:'barrier_test',captureId:'capture_test',admissionState:'maintenance'};
const base={version:1,status:'pending',anchor:{bindingId:'anchor',workspaceId:'ws_example',environmentId:'env_example',objectName:'object_example',authorityEpoch:2,sha256:'b'.repeat(64),generation:1},local:state,jobId:'job_test',jobDigest:'c'.repeat(64),releaseDigest:'d'.repeat(64),integrityKeyId:'key_test',outcomeDigest:null};
describe('closed bounded current control admission',()=>{
 it('accepts a pending admission without public outcome',()=>expect(parseControlAdmission(base)).toEqual(base));
 it('accepts only a complete post-transition state with outcome digest',()=>{expect(parseControlAdmission({...base,status:'completed',local:{...state,state:'retired',generation:4,admissionState:'retired'},outcomeDigest:'e'.repeat(64)}).status).toBe('completed');});
 for(const changed of [{extra:true},{status:'unknown'},{version:2},{outcomeDigest:'e'.repeat(64)},{status:'completed'},{anchor:{...base.anchor,generation:0}},{local:{...state,generation:-1}},{jobId:null},{integrityKeyId:'x'.repeat(5000)}])it('rejects malformed '+JSON.stringify(changed).slice(0,80),()=>expect(()=>parseControlAdmission({...base,...changed})).toThrow());
});
