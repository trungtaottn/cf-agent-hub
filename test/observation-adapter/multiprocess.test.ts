import {it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {processHarness} from './process-fixture';
import {withStateLock} from '../../packages/observation-adapter/src/state-file';
import {Deadline} from '../../packages/client/src/transport';
import {binding} from './helpers';
it('independently_opened_real_flock_contenders_enter_once_and_preserve_inode',async()=>{
 const h=await processHarness();try{const inode=fs.statSync(join(h.directory,'lock')).ino,runners=[h.start(),h.start(),h.start()];await Promise.all(runners.map(r=>r.wait('ready')));for(const r of runners)r.child.send({kind:'go'});
 await Promise.all(runners.map(r=>Promise.race([r.wait('entered'),r.wait('unavailable')])));expect(runners.filter(r=>r.messages.some(m=>m.kind==='entered'))).toHaveLength(1);for(const r of runners)if(r.messages.some(m=>m.kind==='entered'))r.child.send({kind:'release'});await Promise.all(runners.map(r=>r.exit));expect(fs.statSync(join(h.directory,'lock')).ino).toBe(inode);for(const r of runners)expect(r.stdout+r.stderr).toBe('');
 }finally{await h.close();}
},15000);
it('shared_open_file_description_negative_control_detects_both_contenders',async()=>{
 const h=await processHarness();const fd=fs.openSync(join(h.directory,'lock'),fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);try{const runners=[h.start('shared-negative','',fd),h.start('shared-negative','',fd)];await Promise.all(runners.map(r=>r.wait('ready')));for(const r of runners)r.child.send({kind:'go'});await Promise.all(runners.map(r=>r.wait('entered')));expect(runners.filter(r=>r.messages.some(m=>m.kind==='entered'))).toHaveLength(2);for(const r of runners)r.child.send({kind:'release'});await Promise.all(runners.map(r=>r.exit));for(const r of runners)expect(r.stdout+r.stderr).toBe('');}finally{fs.closeSync(fd);await h.close();}
},15000);
it('separate_private_lanes_progress_independently',async()=>{
 const h=await processHarness();try{const dir=join(h.root,'other-state'),deadline=new Deadline(2000);try{await withStateLock({...h.opts,directory:dir,purpose:'initialize'},deadline,async s=>s.initialize({...binding,checkoutSlotId:'other-checkout'}));}finally{deadline.dispose();}
 const runners=[h.start(),h.start('normal','',undefined,dir)];await Promise.all(runners.map(r=>r.wait('ready')));for(const r of runners)r.child.send({kind:'go'});await Promise.all(runners.map(r=>r.wait('entered')));for(const r of runners)r.child.send({kind:'release'});await Promise.all(runners.map(r=>r.exit));for(const r of runners)expect(r.stdout+r.stderr).toBe('');}finally{await h.close();}
},15000);
it('parent_sigkill_releases_actual_open_description_without_unlinking_lock',async()=>{
 const h=await processHarness();try{const inode=fs.statSync(join(h.directory,'lock')).ino,first=h.start();await first.wait('ready');first.child.send({kind:'go'});await first.wait('entered');first.child.kill('SIGKILL');await first.exit;const second=h.start();await second.wait('ready');second.child.send({kind:'go'});await second.wait('entered');second.child.send({kind:'release'});await second.exit;expect(fs.statSync(join(h.directory,'lock')).ino).toBe(inode);expect(first.stdout+first.stderr+second.stdout+second.stderr).toBe('');}finally{await h.close();}
},15000);
it('killed_acquisition_child_is_reaped_and_parent_never_enters',async()=>{
 const h=await processHarness();try{const r=h.start('normal','acquisition-child');await r.wait('ready');r.child.send({kind:'go'});await r.wait('acquisition-child');const pid=r.messages.find(m=>m.kind==='acquisition-child')!.childPid!;process.kill(pid,'SIGKILL');await r.wait('unavailable');await r.exit;expect(r.messages.some(m=>m.kind==='entered')).toBe(false);expect(()=>process.kill(pid,0)).toThrow();const second=h.start();await second.wait('ready');second.child.send({kind:'go'});await second.wait('entered');second.child.send({kind:'release'});await second.exit;expect(r.stdout+r.stderr+second.stdout+second.stderr).toBe('');}finally{await h.close();}
},15000);
it('whole_deadline_kills_and_reaps_stopped_real_acquisition_child',async()=>{
 const h=await processHarness();try{const r=h.start('normal','acquisition-child');await r.wait('ready');r.child.send({kind:'go'});await r.wait('acquisition-child');const pid=r.messages.find(m=>m.kind==='acquisition-child')!.childPid!;await r.wait('unavailable');await r.exit;expect(r.messages.some(m=>m.kind==='entered')).toBe(false);expect(()=>process.kill(pid,0)).toThrow();expect(r.stdout+r.stderr).toBe('');}finally{await h.close();}
},15000);
it('parent_death_with_stopped_child_releases_descriptor_after_child_teardown',async()=>{
 const h=await processHarness();let pid:number|undefined;try{const inode=fs.statSync(join(h.directory,'lock')).ino,r=h.start('normal','acquisition-child');await r.wait('ready');r.child.send({kind:'go'});await r.wait('acquisition-child');pid=r.messages.find(m=>m.kind==='acquisition-child')!.childPid!;r.child.kill('SIGKILL');await r.exit;process.kill(pid,'SIGKILL');pid=undefined;const second=h.start();await second.wait('ready');second.child.send({kind:'go'});await second.wait('entered');second.child.send({kind:'release'});await second.exit;expect(fs.statSync(join(h.directory,'lock')).ino).toBe(inode);expect(r.stdout+r.stderr+second.stdout+second.stderr).toBe('');}finally{if(pid)try{process.kill(pid,'SIGKILL');}catch{}await h.close();}
},15000);
it('blocking_sync_fsync_crosses_deadline_while_retaining_real_lock_without_late_mutation',async()=>{
 const h=await processHarness();try{const first=h.start('crash','slow-filesync');await first.wait('ready');first.child.send({kind:'go'});await first.wait('blocking-filesync');const began=performance.now(),second=h.start();await second.wait('ready');second.child.send({kind:'go'});await second.wait('unavailable');expect(first.messages.some(m=>m.kind==='unavailable')).toBe(false);expect(second.messages.some(m=>m.kind==='entered')).toBe(false);await first.wait('unavailable');await Promise.all([first.exit,second.exit]);expect(performance.now()-began).toBeGreaterThanOrEqual(400);const before=fs.readFileSync(join(h.directory,'state.json'),'utf8');await new Promise(r=>setTimeout(r,40));expect(fs.readFileSync(join(h.directory,'state.json'),'utf8')).toBe(before);expect(JSON.parse(before).reportedLocalLoss).toBe(false);expect(first.stdout+first.stderr+second.stdout+second.stderr).toBe('');}finally{await h.close();}
},15000);
