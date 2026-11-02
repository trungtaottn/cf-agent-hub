/** Private test harness diagnostics; never included in a product entrypoint. */
const phases=new Set(['parse','dispatch','reset-config','reset-update','reset-bootstrap','reset-install','reset-storage','reset-seed']);
export type DecisionFixtureDiagnostics=ReturnType<typeof createDecisionFixtureDiagnostics>;
/** Actual private control-route catch boundary, shared with focused failure tests. */
export async function handleDecisionFixtureControl(request:Request,options:{
 parse:(request:Request)=>Promise<string>;
 dispatch:(action:string,diagnostic:DecisionFixtureDiagnostics)=>Promise<Record<string,unknown>>;
 log:(message:string)=>void;
}):Promise<Response>{
 const diagnostic=createDecisionFixtureDiagnostics();
 try{
  const action=await options.parse(request);
  diagnostic.at('dispatch');
  return Response.json({ok:true,...await options.dispatch(action,diagnostic)});
 }catch{
  options.log(diagnostic.failure());
  return new Response(null,{status:400});
 }
}
/** Per-request state stores only an allowlisted constant, never an exception or input. */
export function createDecisionFixtureDiagnostics(){
 let current='parse';
 return Object.freeze({
  at(phase:unknown){current=typeof phase==='string'&&phases.has(phase)?phase:'unknown';},
  failure(){return 'DECISION_FIXTURE_CONTROL_FAILED '+current;},
 });
}
