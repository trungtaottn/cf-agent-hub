import {it,expect} from 'vitest';
import {createDecisionFixtureDiagnostics} from '../helpers/decision-fixture-diagnostics';

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
