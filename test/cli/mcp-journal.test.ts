import {afterEach,describe,expect,it,vi} from 'vitest';
import {fork,type ChildProcess} from 'node:child_process';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {ProtectedSqlite} from '../../packages/cli/src/protected-sqlite';
import {Journal as LegacyJournal} from './fixtures/legacy-journal-v1';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {Journal,requestFingerprint,type SemanticRequest} from '../../packages/cli/src/journal';
import type {VerifiedPrincipalBinding} from '../../packages/client/src/types';
const roots:string[]=[],handles:Journal[]=[];
const principal:VerifiedPrincipalBinding={origin:'https://hub.example.invalid',workspaceId:'ws',principalId:'agent',slotId:'slot',slotGeneration:0,provenanceId:'provenance'};
const request:SemanticRequest={operation:'createTask',method:'POST',path:'/v2/workspaces/ws/tasks',queryCanonical:'',canonicalBody:'{"title":"Synthetic"}',origin:principal.origin,workspaceId:'ws'};
const root=()=>{const d=mkdtempSync(join(dirname(process.cwd()),'mcp-journal-'));roots.push(d);return d;};
const open=(directory:string,create=true,profile:'native'|'mcp-v1'='mcp-v1',authority=()=>true)=>{const j=new Journal({directory,create,profile,authority});handles.push(j);return j;};
const input=(key='same')=>({request,principal,suppliedKey:key});
const stamp={firstDispatchWallMs:1,firstDispatchMonotonicMs:10,clockEpochId:'synthetic',guaranteedRetentionMs:86400000 as const,requestFingerprint:requestFingerprint(request)};
afterEach(()=>{for(const h of handles.splice(0))try{h.close();}catch{}for(const d of roots.splice(0))rmSync(d,{recursive:true,force:true});vi.restoreAllMocks();});
describe('dedicated bounded MCP journal',()=>{
 it('has reciprocal profile refusal without modifying store bytes',()=>{
  for(const profile of ['native','mcp-v1'] as const){const d=root();open(d,true,profile).close();const before=readFileSync(join(d,'journal.sqlite'));expect(()=>open(d,false,profile==='native'?'mcp-v1':'native')).toThrow();expect(readFileSync(join(d,'journal.sqlite'))).toEqual(before);}
 });
 it('preserves exact arbitrary caller key and returns original entry across restart',()=>{
  const d=root(),j=open(d),key='~!Mixed:Key/[]'+ 'x'.repeat(240),a=j.recordOrReuseIntentSync(input(key));expect(a.key).toBe(key);j.close();const b=open(d,false).recordOrReuseIntentSync(input(key));expect(b).toEqual(a);
 });
 it('never renews first dispatch or reconciled state when an old key returns',()=>{
  const d=root(),j=open(d),a=j.recordOrReuseIntentSync(input());j.markFirstDispatchSync(a.id,stamp);j.authorizeReplaySync(a.id,principal,request,{clockEpochId:'synthetic',nowMonotonicMs:86400010,continuityVerified:true,suspendAwareElapsedVerified:true});j.close();const b=open(d,false).recordOrReuseIntentSync(input());expect(b.id).toBe(a.id);expect(b.firstDispatch).toEqual(stamp);expect(b.replayState).toBe('reconciliation-required');
 });
 it('settled entries survive beyond legacy retention and cannot be pruned',async()=>{
  const d=root(),j=open(d),a=j.recordOrReuseIntentSync(input());j.recordOutcomeSync(a.id,{status:201,code:null,requestId:null});vi.spyOn(Date,'now').mockReturnValue(Date.now()+8*86400000);await expect(j.pruneSettled()).rejects.toThrow();j.close();expect(open(d,false).recordOrReuseIntentSync(input()).replayState).toBe('settled');
 });
 it('does not change legacy create or explicit prune semantics',async()=>{
  const j=open(root(),true,'native'),a=j.recordIntentSync(input()),b=j.recordIntentSync(input());expect(a.id).not.toBe(b.id);expect(()=>j.recordOrReuseIntentSync(input())).toThrow();j.recordOutcomeSync(a.id,{status:201,code:null,requestId:null});vi.spyOn(Date,'now').mockReturnValue(Date.now()+8*86400000);expect(await j.pruneSettled()).toBe(1);expect(j.getSync(b.id)).not.toBeNull();
 });
 it('requires current authority even for an exact retained key',()=>{
  let allowed=true;const j=open(root(),true,'mcp-v1',()=>allowed);j.recordOrReuseIntentSync(input());allowed=false;expect(()=>j.recordOrReuseIntentSync(input())).toThrow();
 });
 it.each(['principalId','slotId','slotGeneration','provenanceId'] as const)('rejects same-key changed principal %s',field=>{
  const j=open(root());j.recordOrReuseIntentSync(input());expect(()=>j.recordOrReuseIntentSync({...input(),principal:{...principal,[field]:field==='slotGeneration'?1:'changed'}})).toThrow();
 });
 it('rejects changed semantic payload and retains original',()=>{
  const j=open(root()),a=j.recordOrReuseIntentSync(input());expect(()=>j.recordOrReuseIntentSync({...input(),request:{...request,canonicalBody:'{"title":"Other"}'}})).toThrow();expect(j.getSync(a.id)).toEqual(a);
 });
 it('refuses duplicates rather than selecting an arbitrary historical entry',()=>{
  const j=open(root());j.recordIntentSync(input());j.recordIntentSync(input());expect(()=>j.recordOrReuseIntentSync(input())).toThrow();
 });
 it.each(['',' '.repeat(2),'x'.repeat(257),'line\nbreak','nonasciié'])('rejects invalid key before inserting (%j)',key=>{const j=open(root());expect(()=>j.recordOrReuseIntentSync(input(key))).toThrow();expect(j.someValidatedSync(()=>true)).toBe(false);});
 it('requires explicit key; does not mint an interactive fallback',()=>{const j=open(root());expect(()=>j.recordOrReuseIntentSync({request,principal} as never)).toThrow();expect(j.someValidatedSync(()=>true)).toBe(false);});
});

const message=(child:ChildProcess)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child timeout')),15000);child.once('message',value=>{clearTimeout(timer);resolve(value);});child.once('error',reject);});
it('actual frozen legacy reader cannot open or prune the MCP profile',async()=>{
 const d=root(),j=open(d);const entry=j.recordOrReuseIntentSync(input());j.recordOutcomeSync(entry.id,{status:201,code:null,requestId:null});j.close();
 const before=readFileSync(join(d,'journal.sqlite'));expect(()=>new LegacyJournal({directory:d,authority:()=>true})).toThrow();expect(readFileSync(join(d,'journal.sqlite'))).toEqual(before);
});
it('two actual processes atomically reuse one original identity',async()=>{
 const d=root();open(d).close();const built=join(root(),'child.mjs');await build({entryPoints:['test/cli/mcp-journal-process.ts'],outfile:built,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const children=[fork(built,[d],{stdio:['ignore','ignore','ignore','ipc']}),fork(built,[d],{stdio:['ignore','ignore','ignore','ipc']})];
 try{await Promise.all(children.map(message));const results=children.map(message);for(const c of children)c.send('go');const [a,b]=await Promise.all(results);expect(a.id).toBeTruthy();expect(b.id).toBe(a.id);const reopened=open(d,false);let count=0;reopened.someValidatedSync(()=>{count++;return false;});expect(count).toBe(1);}
 finally{for(const c of children)c.kill();}
});
it('process death during lookup transaction leaves no partial intent and restart admits once',async()=>{
 const d=root();open(d).close();const built=join(root(),'child.mjs');await build({entryPoints:['test/cli/mcp-journal-process.ts'],outfile:built,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const child=fork(built,[d,'crash-before-insert'],{stdio:['ignore','ignore','ignore','ipc']});try{await message(child);const entered=message(child);child.send('go');expect(await entered).toEqual({phase:'in-transaction'});const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;const j=open(d,false);expect(j.someValidatedSync(()=>true)).toBe(false);const a=j.recordOrReuseIntentSync(input());expect(j.recordOrReuseIntentSync(input()).id).toBe(a.id);}finally{child.kill();}
});
it('full bounded journal still reuses known keys but refuses new keys without eviction',()=>{
 const d=root(),j=open(d),first=j.recordOrReuseIntentSync(input());j.close();const store=new ProtectedSqlite({directory:d,name:'journal.sqlite'});
 store.transaction(db=>{const row=db.prepare('SELECT * FROM journal_entries').get()!;const insert=db.prepare('INSERT INTO journal_entries VALUES (?,?,?,?)');for(let i=1;i<1000;i++){const id=randomUUID(),payload=JSON.stringify({...JSON.parse(String(row.payload)),id,key:'fixture-'+i});insert.run(id,payload,createHash('sha256').update(payload).digest('hex'),row.reserved_bytes);}});store.close();
 const full=open(d,false);expect(full.recordOrReuseIntentSync(input())).toEqual(first);expect(()=>full.recordOrReuseIntentSync(input('new'))).toThrow();expect(full.getSync(first.id)).toEqual(first);
});
