import {it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {processHarness} from './process-fixture';
import {withStateLock} from '../../packages/observation-adapter/src/state-file';
import {Deadline} from '../../packages/client/src/transport';
for(const stage of ['before-lock-open','after-lock-open','before-temp-fsync','after-temp-fsync','before-rename','after-rename','before-dir-fsync','after-dir-fsync'])it(`actual_SIGKILL_${stage}_recovers_only_complete_state_with_stable_lock`,async()=>{
 const h=await processHarness();try{const inode=fs.statSync(join(h.directory,'lock')).ino,child=h.start('crash',stage);await child.wait('ready');child.child.send({kind:'go'});await child.wait('checkpoint');child.child.kill('SIGKILL');await child.exit;
 const deadline=new Deadline(2000);try{await withStateLock(h.opts,deadline,async store=>{const s=store.read();expect(s.reportedLocalLoss).toBe(['after-rename','before-dir-fsync','after-dir-fsync'].includes(stage));store.persist(s);});}finally{deadline.dispose();}
 expect(fs.statSync(join(h.directory,'lock')).ino).toBe(inode);expect(child.stdout+child.stderr).toBe('');const stat=fs.statSync(join(h.directory,'state.json'));expect(stat.size).toBeLessThanOrEqual(131072);expect(stat.blocks*512).toBeGreaterThanOrEqual(stat.size);
 }finally{await h.close();}
},15000);
