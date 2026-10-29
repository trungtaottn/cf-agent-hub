import {describe,it,expect,vi} from 'vitest';
import {signRecord,signRecordAsync,verifyRecord} from '../../src/recovery/manifest';
const integrity={keyId:'key_synthetic',key:Buffer.alloc(32,7).toString('base64')};
const record={id:'synthetic_record',auth:{key_id:'key_synthetic',algorithm:'HMAC-SHA256' as const,tag:'0'.repeat(64)}};
describe('async current recovery crypto guard boundaries',()=>{
 it.each([1,2,3])('awaits verify guard at boundary%s and rejects before publishing verification',async stop=>{const signed=await signRecord(record,integrity);let calls=0;await expect(verifyRecord(signed,integrity,async()=>{await Promise.resolve();if(++calls===stop)throw Error('ANCHOR_CHANGED');})).rejects.toThrow('ANCHOR_CHANGED');expect(calls).toBe(stop);});
 it.each([1,2,3])('awaits signing guard at boundary%s',async stop=>{let calls=0;await expect(signRecordAsync(record,integrity,async()=>{await Promise.resolve();if(++calls===stop)throw Error('ANCHOR_CHANGED');})).rejects.toThrow('ANCHOR_CHANGED');expect(calls).toBe(stop);});
 it('does not verify after a post-import key guard rejection',async()=>{const signed=await signRecord(record,integrity),spy=vi.spyOn(crypto.subtle,'verify');let calls=0;try{await expect(verifyRecord(signed,integrity,async()=>{if(++calls===2)throw Error('ANCHOR_CHANGED');})).rejects.toThrow();expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}});
 it('signs immutable input clone across guard awaits',async()=>{const input=structuredClone(record);const result=await signRecordAsync(input,integrity,async()=>{input.id='changed_after_start';});expect(result.id).toBe('synthetic_record');await expect(verifyRecord(result,integrity)).resolves.toBeUndefined();});
});
