import {it,expect} from 'vitest';
import {createDecisionFixtureDiagnostics,handleDecisionFixtureControl} from '../helpers/decision-fixture-diagnostics';

const request=()=>new Request('https://hub.fixture.example.invalid/__ui_fixture/control',{method:'POST',body:'{"action":"reset"}'});
const privateError=()=>Error('synthetic-secret-token\nprivate-request-body');

it('catches parser rejection without dispatching and emits only constant parse diagnostics',async()=>{
 const logs:string[]=[];let dispatched=false;
 const response=await handleDecisionFixtureControl(request(),{
  parse:async()=>{throw privateError();},
  dispatch:async()=>{dispatched=true;return {};},log:message=>logs.push(message),
 });
 expect(dispatched).toBe(false);expect(response.status).toBe(400);expect(await response.text()).toBe('');
 expect(logs).toEqual(['DECISION_FIXTURE_CONTROL_FAILED parse']);
});
it.each(['dispatch','reset-config','reset-update','reset-bootstrap','reset-install','reset-storage','reset-seed'])('catches %s failure without exposing exception data',async phase=>{
 const logs:string[]=[];
 const response=await handleDecisionFixtureControl(request(),{
  parse:async()=> 'reset',
  dispatch:async(action,diagnostic)=>{expect(action).toBe('reset');if(phase!=='dispatch')diagnostic.at(phase);throw privateError();},
  log:message=>logs.push(message),
 });
 expect(response.status).toBe(400);expect(await response.text()).toBe('');
 expect(logs).toEqual(['DECISION_FIXTURE_CONTROL_FAILED '+phase]);
});
it('preserves successful dispatch response and emits no failure log',async()=>{
 const logs:string[]=[];const original=request();
 const response=await handleDecisionFixtureControl(original,{
  parse:async received=>{expect(received).toBe(original);return 'read-state';},
  dispatch:async(action,diagnostic)=>{expect(action).toBe('read-state');expect(diagnostic.failure()).toBe('DECISION_FIXTURE_CONTROL_FAILED dispatch');return {cases:{},attempts:[]};},
  log:message=>logs.push(message),
 });
 expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/json');
 expect(await response.json()).toEqual({ok:true,cases:{},attempts:[]});expect(logs).toEqual([]);
});
it('keeps overlapping catch boundaries isolated, including a subsequent parse failure',async()=>{
 const logs:string[]=[];let release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const first=handleDecisionFixtureControl(request(),{
  parse:async()=> 'reset',
  dispatch:async(_action,diagnostic)=>{diagnostic.at('reset-install');started();await waiting;throw privateError();},
  log:message=>logs.push(message),
 });
 await ready;
 const second=await handleDecisionFixtureControl(request(),{
  parse:async()=> 'read-state',dispatch:async()=>{throw privateError();},log:message=>logs.push(message),
 });
 release();const firstResponse=await first;
 const third=await handleDecisionFixtureControl(request(),{
  parse:async()=>{throw privateError();},dispatch:async()=>({}),log:message=>logs.push(message),
 });
 for(const response of [firstResponse,second,third]){expect(response.status).toBe(400);expect(await response.text()).toBe('');}
 expect(logs).toEqual(['DECISION_FIXTURE_CONTROL_FAILED dispatch','DECISION_FIXTURE_CONTROL_FAILED reset-install','DECISION_FIXTURE_CONTROL_FAILED parse']);
});


it('records only the current closed control/reset phase without retaining previous phases',()=>{
 const recorder=createDecisionFixtureDiagnostics();
 expect(recorder.failure()).toBe('DECISION_FIXTURE_CONTROL_FAILED parse');
 for(const phase of ['dispatch','reset-config','reset-update','reset-bootstrap','reset-install','reset-storage','reset-seed']){
  recorder.at(phase);expect(recorder.failure()).toBe('DECISION_FIXTURE_CONTROL_FAILED '+phase);
 }
});
it('never serializes unknown strings, objects, getters, proxy hooks or raw exception content',()=>{
 let hooks=0;const hostile=new Proxy({}, {get(){hooks++;throw Error('PRIVATE');},getPrototypeOf(){hooks++;throw Error('PRIVATE');}});
 for(const phase of ['private-token','reset-seed\nPRIVATE','x'.repeat(10000),null,undefined,Symbol('PRIVATE'),{get value(){hooks++;throw Error('PRIVATE');}},hostile]){
  const recorder=createDecisionFixtureDiagnostics();recorder.at(phase);expect(recorder.failure()).toBe('DECISION_FIXTURE_CONTROL_FAILED unknown');
 }
 expect(hooks).toBe(0);
});
it('keeps concurrent request phase records independent',()=>{
 const a=createDecisionFixtureDiagnostics(),b=createDecisionFixtureDiagnostics();a.at('reset-install');b.at('dispatch');
 expect(a.failure()).toBe('DECISION_FIXTURE_CONTROL_FAILED reset-install');expect(b.failure()).toBe('DECISION_FIXTURE_CONTROL_FAILED dispatch');
});
