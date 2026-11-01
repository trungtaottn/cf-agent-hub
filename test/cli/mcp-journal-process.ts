import {Journal} from '../../packages/cli/src/journal';
import type {VerifiedPrincipalBinding} from '../../packages/client/src/types';
const principal:VerifiedPrincipalBinding={origin:'https://hub.example.invalid',workspaceId:'ws',principalId:'agent',slotId:'slot',slotGeneration:0,provenanceId:'provenance'};
let checks=0;
const journal=new Journal({directory:process.argv[2],profile:'mcp-v1',authority:()=>{
 if(process.argv[3]==='crash-before-insert'&&++checks===2){process.send?.({phase:'in-transaction'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);}
 return true;
}});
process.on('message',()=>{
 try{const entry=journal.recordOrReuseIntentSync({principal,request:{operation:'createTask',method:'POST',path:'/v2/workspaces/ws/tasks',queryCanonical:'',canonicalBody:'{"title":"Synthetic"}',origin:principal.origin,workspaceId:'ws'},suppliedKey:'same'});process.send?.({id:entry.id});}
 catch{process.send?.({error:'rejected'});}
 finally{journal.close();process.disconnect?.();}
});
process.send?.({ready:true});
