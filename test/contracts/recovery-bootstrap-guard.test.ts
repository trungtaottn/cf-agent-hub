import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {sha256,prepareBootstrap} from '../../src/config/bootstrap';
describe('fresh authority guard after bootstrap hashing',()=>{
 it('awaits an asynchronous rejecting guard before publishing a digest',async()=>{let reached=false;await expect(sha256('synthetic',async()=>{await Promise.resolve();reached=true;throw Error('ANCHOR_ROTATED');})).rejects.toThrow('ANCHOR_ROTATED');expect(reached).toBe(true);});
 it('does not begin the second bootstrap digest when the first guard rejects',async()=>{const c=JSON.parse(readFileSync('examples/recovery/r1-commands.json','utf8')).commands.find((v:any)=>v.operation==='install');const spy=vi.spyOn(crypto.subtle,'digest');try{await expect(prepareBootstrap(c.payload.config,c.payload.verification_bundle,c.workspace_id,async()=>{await Promise.resolve();throw Error('ANCHOR_ROTATED');})).rejects.toThrow('ANCHOR_ROTATED');expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}});
});
