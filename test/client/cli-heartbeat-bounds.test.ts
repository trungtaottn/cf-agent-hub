import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Journal} from '../../packages/cli/src/journal';
const roots:string[]=[],handles:{close():void}[]=[];
afterEach(()=>{for(const handle of handles.splice(0))try{handle.close();}catch{}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(){
 const root=mkdtempSync(join(dirname(process.cwd()),'heartbeat-bounds-'));roots.push(root);
 const journal=new Journal({directory:root,create:true,authority:()=>true});handles.push(journal);
 const principal={origin:'https://hub.example.invalid',workspaceId:'ws',principalId:'agent',slotId:'slot',slotGeneration:1,provenanceId:'proof'};
 const entry=await journal.recordIntent({principal,request:{operation:'createTask',method:'POST',path:'/v2/workspaces/ws/tasks',queryCanonical:'',canonicalBody:'{"description":"","title":"Synthetic"}',origin:principal.origin,workspaceId:principal.workspaceId},suppliedKey:'key'});
 const db=new DatabaseSync(join(root,'journal.sqlite'));handles.push(db);return {root,journal,entry,db};
}
it('does not short-circuit validation after finding a matching entry',async()=>{
 const f=await fixture();f.db.prepare('INSERT INTO journal_entries VALUES (?,?,?,?)').run('malformed','{}','wrong',4096);
 expect(()=>f.journal.someValidatedSync(()=>true)).toThrow();
});
it('bounds the number of inspected rows at 1001 even after a matching entry',async()=>{
 const f=await fixture(),template=JSON.parse(String(f.db.prepare('SELECT payload FROM journal_entries').get()!.payload));
 f.db.exec('BEGIN');for(let i=0;i<1001;i++){const id='entry_'+i,payload=JSON.stringify({...template,id});f.db.prepare('INSERT INTO journal_entries VALUES (?,?,?,?)').run(id,payload,createHash('sha256').update(payload).digest('hex'),4096);}f.db.exec('COMMIT');
 let visited=0;expect(()=>f.journal.someValidatedSync(()=>{visited++;return true;})).toThrow();expect(visited).toBe(1000);
});
it('rejects total reservation above 64 MiB while validating one row at a time',async()=>{
 const f=await fixture(),template=JSON.parse(String(f.db.prepare('SELECT payload FROM journal_entries').get()!.payload));f.db.exec('DELETE FROM journal_entries; BEGIN');
 for(let i=0;i<513;i++){const id='entry_'+i,payload=JSON.stringify({...template,id});f.db.prepare('INSERT INTO journal_entries VALUES (?,?,?,?)').run(id,payload,createHash('sha256').update(payload).digest('hex'),131072);}f.db.exec('COMMIT');
 expect(()=>f.journal.someValidatedSync(()=>false)).toThrow();
});
it('measures full bounded scan at 1000 entries and exact 64 MiB reserved',async()=>{
 const f=await fixture(),template=JSON.parse(String(f.db.prepare('SELECT payload FROM journal_entries').get()!.payload));f.db.exec('DELETE FROM journal_entries; BEGIN');
 const total=64*1024*1024,base=Math.floor(total/1000),remainder=total%1000;
 for(let i=0;i<1000;i++){const id='entry_'+i,payload=JSON.stringify({...template,id,request:{...template.request,canonicalBody:JSON.stringify({description:'x'.repeat(62000),title:'Synthetic'})}});f.db.prepare('INSERT INTO journal_entries VALUES (?,?,?,?)').run(id,payload,createHash('sha256').update(payload).digest('hex'),base+(i<remainder?1:0));}f.db.exec('COMMIT');
 const before=process.memoryUsage(),start=performance.now();let count=0,peakHeap=before.heapUsed,peakRss=before.rss;
 expect(f.journal.someValidatedSync(()=>{count++;const memory=process.memoryUsage();peakHeap=Math.max(peakHeap,memory.heapUsed);peakRss=Math.max(peakRss,memory.rss);return false;})).toBe(false);
 expect(count).toBe(1000);expect(f.db.prepare('SELECT sum(reserved_bytes) AS n FROM journal_entries').get()!.n).toBe(total);
 const measurement=JSON.stringify({benchmark:'heartbeat-journal-bounded-scan',entries:count,reservedBytes:total,elapsedMs:Math.round(performance.now()-start),peakHeapDeltaBytes:Math.max(0,peakHeap-before.heapUsed),peakRssDeltaBytes:Math.max(0,peakRss-before.rss),note:'Process memory sampling; not an allocator or production latency guarantee'});
 if(process.env.CF_HEARTBEAT_BENCHMARK_REPORT)writeFileSync(process.env.CF_HEARTBEAT_BENCHMARK_REPORT,measurement+'\n',{mode:0o600});
 console.info(measurement);
},30000);
