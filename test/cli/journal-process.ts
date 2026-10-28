/** Synthetic subprocess fixture only; never real credentials or endpoints. */
import {Journal} from '../../packages/cli/src/journal';
import {ProtectedSqlite} from '../../packages/cli/src/protected-sqlite';
import {LinuxReplayClock} from '../../packages/cli/src/replay-clock';
const binding={origin:'https://hub.example',workspaceId:'ws_synthetic',principalId:'agent_synthetic',slotId:'slot_synthetic',slotGeneration:1,provenanceId:'provenance_synthetic'};
const request={operation:'createTask',method:'POST',path:'/v2/workspaces/ws_synthetic/tasks',queryCanonical:'',canonicalBody:'{"title":"Synthetic task"}',origin:binding.origin,workspaceId:binding.workspaceId};
const [directory,mode,phase,id,key]=process.argv.slice(2);
const authority=(value:unknown)=>JSON.stringify(value)===JSON.stringify(binding);
const pause=()=>new Promise<void>(()=>{});
if(mode==='hold-lock'){
 const db=new ProtectedSqlite({directory,name:'journal.sqlite',create:false});
 db.transaction(()=>{process.send?.({stage:'locked'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);});db.close();process.disconnect?.();
}else if(mode==='clock'){process.send?.({clock:new LinuxReplayClock().sample()});}
else if(mode==='hot-journal'){
 const db=new ProtectedSqlite({directory,name:'journal.sqlite',create:true});
 db.transaction(sql=>sql.exec("CREATE TABLE synthetic(v TEXT); INSERT INTO synthetic VALUES ('prior')"));
 db.transaction(sql=>{sql.exec("INSERT INTO synthetic VALUES ('uncommitted')");process.send?.({stage:'transaction'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});
}else if(mode==='create'){
 const j=new Journal({directory,create:true,authority});
 if(phase==='before-record'){process.send?.({stage:phase});await pause();}
 const entry=await j.recordIntent({request,principal:binding});
 if(phase!=='intent')await j.attachKey(entry.id,'synthetic-process-key');
 if(phase==='dispatch')await j.markFirstDispatch(entry.id,new LinuxReplayClock().stamp((await import('../../packages/cli/src/journal')).requestFingerprint(request)));
 process.send?.({stage:phase,id:entry.id});await pause();
}else if(mode==='attach'){
 const j=new Journal({directory,create:false,authority});process.send?.({stage:'ready'});
 process.once('message',async()=>{let attached=false;try{await j.attachKey(id,key);attached=true;}catch{}j.close();process.send?.({stage:'result',attached,key});process.disconnect?.();});
}
