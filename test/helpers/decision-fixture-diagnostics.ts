/** Private test harness diagnostics; never included in a product entrypoint. */
const phases=new Set(['parse','dispatch','reset-config','reset-update','reset-bootstrap','reset-install','reset-storage','reset-seed']);
/** Per-request state stores only an allowlisted constant, never an exception or input. */
export function createDecisionFixtureDiagnostics(){
 let current='parse';
 return Object.freeze({
  at(phase:unknown){current=typeof phase==='string'&&phases.has(phase)?phase:'unknown';},
  failure(){return 'DECISION_FIXTURE_CONTROL_FAILED '+current;},
 });
}
