import {it,expect,vi,afterEach} from 'vitest';
import {ObservationWorkPool} from '../../src/observations/work';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('observation work has exactly four allocations and releases every completed reservation',()=>{
 const pool=new ObservationWorkPool(),held=Array.from({length:4},()=>pool.acquire());expect(()=>pool.acquire()).toThrowError(expect.objectContaining({status:429}));held[0].finish();const next=pool.acquire();next.finish();for(const h of held)h.finish();
 for(let i=0;i<20;i++)pool.acquire().finish();
});
it('uncancellable crypto remains counted after response deadline until actual settlement',async()=>{
 vi.useFakeTimers();const pool=new ObservationWorkPool(),settle:Array<()=>void>=[];
 const held=Array.from({length:4},()=>{const work=pool.acquire(),crypto=new Promise<void>(resolve=>settle.push(resolve));const response=work.wait(crypto,true).catch(e=>e).finally(()=>work.finish());return response;});
 await vi.advanceTimersByTimeAsync(5000);for(const result of await Promise.all(held))expect(result).toMatchObject({status:503});expect(()=>pool.acquire()).toThrowError(expect.objectContaining({status:429}));
 settle[0]();await Promise.resolve();await Promise.resolve();const next=pool.acquire();next.finish();for(const s of settle)s();await Promise.resolve();
});
it('timer-delayed execution checks absolute operational deadline even before timer callback',()=>{
 vi.useFakeTimers();const pool=new ObservationWorkPool(),work=pool.acquire();vi.setSystemTime(Date.now()+5000);expect(()=>work.check()).toThrowError(expect.objectContaining({status:503}));work.finish();
});
