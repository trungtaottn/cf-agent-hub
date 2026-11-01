import {it,expect} from 'vitest';
import example from '../../examples/config/deployment.example.json';
import {parseDeployment} from '../../src/config/deployment';
function configured(){const c:any=structuredClone(example);c.static_participants.push({workspace_id:'ws_example',agent_id:'agent_second',display_name:'Second synthetic'});c.workspace_policies[0].observation_pilot={enabled:true,repository_id:'repo',adapter_id:'offline',adapter_version:'1',supported_events:['read-observed','write-observed'],slots:[{agent_id:'agent_research',checkout_slot_id:'slot_a'},{agent_id:'agent_second',checkout_slot_id:'slot_b'}]};return c;}
it('observation pilot is optional and explicitly configured without grants or defaults',()=>{
 expect(parseDeployment(example).workspace_policies[0]).not.toHaveProperty('observation_pilot');
 const c=configured();expect(parseDeployment(c)).toEqual(c);
});
it('observation pilot rejects duplicate mapping, unknown agent and open fields',()=>{
 for(const change of [(p:any)=>p.slots[1].agent_id=p.slots[0].agent_id,(p:any)=>p.slots[1].checkout_slot_id=p.slots[0].checkout_slot_id,(p:any)=>p.slots[1].agent_id='agent_missing',(p:any)=>p.absolute_root='/private',(p:any)=>p.supported_events.push('unknown')]){const c=configured();change(c.workspace_policies[0].observation_pilot);expect(()=>parseDeployment(c)).toThrow();}
});
it('new public repository and checkout identifiers cannot carry filesystem roots or private URLs',()=>{
 for(const field of ['repository_id','checkout_slot_id'])for(const value of ['/home/private/repo','C:\\private\\repo','https://private.example.invalid/repo','../repo','repo/child','a'.repeat(129)]){const c=configured(),p=c.workspace_policies[0].observation_pilot;if(field==='repository_id')p.repository_id=value;else p.slots[0].checkout_slot_id=value;expect(()=>parseDeployment(c),field+': '+value).toThrow();}
});
