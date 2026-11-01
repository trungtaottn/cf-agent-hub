/** Isomorphic local comparison context. Consistency is never authenticated provenance. */
import {canonicalJson,sha256} from '../../src/config/bootstrap';
import {R3_JOURNEY_CASES,type R3JourneyCase} from './r3-journey-observation';
export const J1_PRECOMMAND_TABLES=['tasks','runs','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions','task_history','task_results','task_acceptances','result_artifacts','artifacts','artifact_generations','artifact_associations'] as const;
function bad():never{throw Error('J1_PRECOMMAND_CONTEXT_INVALID');}
type Check<T>=(v:unknown)=>T;
type Parsed<T extends Record<string,Check<unknown>>>={[K in keyof T]:ReturnType<T[K]>};
function object<T extends Record<string,Check<unknown>>>(shape:T):Check<Parsed<T>>{return v=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)bad();
 const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d),wanted=Object.keys(shape);
 if(keys.length!==wanted.length||keys.some(k=>typeof k!=='string'||!Object.hasOwn(shape,k)||!Object.hasOwn(d[k],'value')))bad();
 const out:Record<string,unknown>={};for(const k of wanted)out[k]=shape[k](d[k].value);return out as Parsed<T>;
};}
const lit=<T extends string|number|boolean|null>(x:T):Check<T>=>v=>v===x?x:bad();
const en=<T extends string>(xs:readonly T[]):Check<T>=>v=>typeof v==='string'&&xs.includes(v as T)?v as T:bad();
const integer:Check<number>=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:bad();
const utf8=new TextEncoder();
const id:Check<string>=v=>typeof v==='string'&&v.length>0&&v.length<=128&&utf8.encode(v).length<=128&&/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(v)?v:bad();
const hash:Check<string>=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:bad();
const nil=<T>(check:Check<T>):Check<T|null>=>v=>v===null?null:check(v);
const reviewers:Check<string[]>=v=>{if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length<1||v.length>16)bad();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==v.length+1)bad();const out:string[]=[];for(let i=0;i<v.length;i++){const p=d[String(i)];if(!p||!Object.hasOwn(p,'value'))bad();out.push(id(p.value));}if(out.some((s,i)=>i>0&&s<=out[i-1]))bad();return out;};
const empty=object(Object.fromEntries(J1_PRECOMMAND_TABLES.map(t=>[t,lit(0)])) as Record<typeof J1_PRECOMMAND_TABLES[number],Check<0>>);
const schema=object({format_version:lit(1),stage:lit('pre-command-source-fixture-context'),origin:lit('local-workers-synthetic-fixture'),acceptance_eligible:lit(false),provenance_authenticated:lit(false),case_id:en(R3_JOURNEY_CASES),chronology:lit('before-domain-setup'),
 source:object({workspace_id:lit('ws_example'),object_name:id,config_epoch:integer,config_sha256:hash,installation_sha256:hash,admission_state:lit('installed'),maintenance_state:lit('open')}),
 target:nil(object({workspace_id:lit('ws_example'),object_name:id,config_epoch:integer,config_sha256:hash,installation_sha256:hash,decision_policy_sha256:hash,preparation:lit('prepared-not-installed')})),
 descriptor:object({action_id:lit('synthetic.task-review'),schema_version:lit(1),schema_sha256:lit('89fd3cd5ab949eb46e2f43ce0eb1fa063bddef467579052051e5ad3f9216af4c'),semantic_revision:lit('synthetic-task-review@2')}),
 policy:object({version:lit(3),sha256:hash,configured_reviewer_ids:reviewers}),
 configured_principals:object({requester:object({kind:lit('agent'),principal_id:lit('agent_research')}),planned_human:nil(object({kind:lit('human'),principal_id:lit('human_operator')}))}),empty_domain_counts:empty});
export type J1PrecommandContext=ReturnType<typeof schema>;
export type J1PrecommandPacket=Readonly<{canonical_json:string;sha256:string}>;
export type J1PrecommandSink=(record:J1PrecommandPacket)=>void|Promise<void>;
export const j1RecoveryCase=(caseId:R3JourneyCase)=>caseId.endsWith('_restore')||caseId==='changed_chunk_continuation_denied';
export const j1PlannedHuman=(caseId:R3JourneyCase)=>['human_approve_replay_revoked','human_reject_replay','rejected_command_history_restore'].includes(caseId);
function parse(value:unknown):J1PrecommandContext{
 const x=schema(value),recovery=j1RecoveryCase(x.case_id);
 if(x.source.object_name!=='j1_'+x.case_id+(recovery?'_source':''))bad();
 if(j1PlannedHuman(x.case_id)!==(x.configured_principals.planned_human!==null))bad();
 if(recovery){if(!x.target||x.target.object_name!=='j1_'+x.case_id+'_target'||x.target.workspace_id!==x.source.workspace_id||x.target.config_epoch<=x.source.config_epoch||x.target.decision_policy_sha256!==x.policy.sha256)bad();}else if(x.target!==null)bad();
 if(utf8.encode(canonicalJson(x)).byteLength>8192)bad();return x;
}
export function assertJ1PrecommandContext(value:unknown):asserts value is J1PrecommandContext{parse(value);}
export async function encodeJ1PrecommandContext(value:unknown):Promise<J1PrecommandPacket>{const canonical_json=canonicalJson(parse(value));return Object.freeze({canonical_json,sha256:await sha256(canonical_json)});}
