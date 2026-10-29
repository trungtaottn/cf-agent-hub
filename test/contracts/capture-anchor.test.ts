import {describe,it,expect} from 'vitest';
import {parseCaptureAnchor} from '../../src/recovery/capture-anchor';
const value={bindingId:'anchor_test',workspaceId:'ws_example',environmentId:'test',objectName:'workspace_example',authorityEpoch:1,sha256:'a'.repeat(64),generation:1};
describe('non-executable capture admission anchor',()=>{
 it('copies exact bounded closed provider identity',()=>{expect(parseCaptureAnchor(value)).toEqual(value);expect(parseCaptureAnchor(value)).not.toBe(value);});
 it.each([0,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects invalid persisted generation%s',generation=>{expect(()=>parseCaptureAnchor({...value,generation})).toThrow();});
 it('rejects caller resolver, missing identities, malformed hashes and excessive data',()=>{for(const v of [{...value,resolver:'https://caller.invalid'},{...value,bindingId:null},{...value,sha256:'wrong'},{...value,objectName:'x'.repeat(4097)}])expect(()=>parseCaptureAnchor(v)).toThrow();});
});

import {parseFinalization} from '../../src/recovery/capture-finalization';
describe('bounded non-executable finalization cursor',()=>{
 const record={version:1,jobId:'job_fixture',draftSha256:'b'.repeat(64),anchor:value,fence:{authorityEpoch:1,maintenanceGeneration:1},index:0,total:1};
 it('accepts immutable identity and completed coverage without mutation',()=>{expect(parseFinalization(record)).toEqual(record);expect(parseFinalization({...record,index:1}).index).toBe(1);});
 it.each([{index:-1},{index:2},{total:1001},{total:-1},{index:0.5},{draftSha256:'wrong'},{fence:{authorityEpoch:2,maintenanceGeneration:1}},{resolver:'caller'}])('rejects malformed cursor or authority%j',change=>{expect(()=>parseFinalization({...record,...change})).toThrow();});
});
