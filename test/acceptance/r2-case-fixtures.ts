/** SYNTHETIC structural fixtures only. A matching JSON graph is not an authenticated
 * producer record, live native execution, browser run, or release acceptance. */
import {createHash} from 'node:crypto';
import {CASE_POLICY,CASE_OPERATIONS,canonicalCaseSubject} from '../../scripts/lib/r2-case-policy.mjs';
export const caseHash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:canonicalCaseSubject(v)).digest('hex');
const get=(v:any,path:string)=>path.split('.').reduce((x,k)=>x?.[k],v);
const clone=<T>(v:T):T=>structuredClone(v);
export function makeCaseEvidence(options:Record<string,any>={}){
 const base={revision:'1'.repeat(40),tree_sha256:caseHash('tree'),environment_id:'fixture-environment',composition_sha256:caseHash('composition'),...options};
 const context:any={workspaceId:'ws_example',configEpoch:1,nativeExecutableSha256:caseHash('native'),uiAssetsSha256:caseHash('ui'),resultGraphSha256:caseHash('graph'),...options};
 const header=(type:string,command_id:string,observed_at:number)=>({type,version:1,revision:base.revision,tree_sha256:base.tree_sha256,environment_id:base.environment_id,composition_sha256:base.composition_sha256,command_id,observed_at,observer_id:'synthetic-observer',record_sha256:caseHash(type+command_id)});
 const preparations:any={...header('r2-case-preparations','case-preparations',10),subjects:[]};
 for(const row of CASE_POLICY){
  const actor=row.lane??(row.family==='browser'?'human':row.family==='gates'||row.family==='native'||row.id.includes('/native/')||row.id.includes('/native-')?'native':row.id.includes('/human/')||row.id.includes('/human-')?'human':row.id.includes('/system/')?'system':'public');
  const suffix=caseHash(row.id).slice(0,12),native=actor==='native',human=actor==='human';
  const subject:any={workspace_id:context.workspaceId,actor_kind:actor,principal_id:native?'agent-'+suffix:human?'human-'+suffix:null,agent_id:native?'agent-'+suffix:null,credential_id:native?'credential-'+suffix:null,runtime_id:native?'runtime-'+suffix:null,task_id:'task-'+suffix,run_id:'run-'+suffix,result_id:'result-'+suffix,request_sha256:caseHash('request'+row.id),key_sha256:caseHash('key'+row.id),grant_sha256:caseHash('grant'+row.id),proof_sha256:native?caseHash('proof'+row.id):null,authority_epoch:context.configEpoch,fixture_record_sha256:caseHash('fixture'+row.id),foreign_runs:null};
  if(row.operation&&CASE_OPERATIONS[row.operation]){const operation=CASE_OPERATIONS[row.operation];if(!operation.idempotency)subject.key_sha256=null;if(!operation.runtimeProof)subject.proof_sha256=null;}
  if(row.id==='tasks/native/foreign-task-own-run')subject.foreign_runs=Object.fromEntries(['submit','fail'].map(name=>[name,{own_task_id:name+'-own-task',foreign_task_id:name+'-foreign-task',foreign_workspace_id:'foreign-workspace',run_id:name+'-run',proof_sha256:caseHash(name+'-proof'),grant_sha256:caseHash(name+'-grant')} ]));
  preparations.subjects.push({case_id:row.id,subject_sha256:caseHash(subject),subject});
 }
 const subjectDigests=new Map(preparations.subjects.map((s:any)=>[s.case_id,caseHash(s.subject)]));
 const commands=new Map<string,any>();
 const command=(id:string,kind:string,cases:any[]=[],start=20,end=30)=>({type:'command',version:1,id,kind,invocation:'r2-'+kind+'-v1',revision:base.revision,tree_sha256:base.tree_sha256,environment_id:base.environment_id,composition_sha256:base.composition_sha256,started_at:start,ended_at:end,exit_code:0,provenance:['native-live','browser-tests'].includes(kind)?'real-run':'source',case_ids:cases.map(c=>c.case_id),results:[],subjects:{cases}});
 commands.set('case-preparations',command('case-preparations','contract',[],5,10));
 const receipts:any={};
 for(const family of ['isolation','gates','native','browser']){
  const rows=CASE_POLICY.filter(c=>c.family===family),assembly='case-assembly-'+family;
  commands.set(assembly,command(assembly,'contract',[],40,50));
  const receipt={...header('r2-'+family,assembly,45),records:[] as any[]};
  for(let offset=0;offset<rows.length;offset+=128){
   const batch=rows.slice(offset,offset+128),id='case-execution-'+family+'-'+offset,kind=family==='native'?'native-live':family==='browser'?'browser-tests':'workers-tests';
   const entries=batch.map(row=>preparations.subjects.find((s:any)=>s.case_id===row.id));
   commands.set(id,command(id,kind,entries.map(({case_id,subject_sha256}:any)=>({case_id,subject_sha256}))));
   for(const row of batch){const entry=preparations.subjects.find((s:any)=>s.case_id===row.id);receipt.records.push({id:row.id,command_id:id,subject_sha256:entry.subject_sha256,observed_at:25,observations:observation(row,entry.subject,context)});}
  }
  receipts[family]=receipt;
 }
 Object.assign(context,{commands,preparations,subjectDigests});
 return {synthetic:true,preparations,receipts,commands,subjectDigests,context};
}
function observation(row:any,subject:any,context:any){
 const parent=new Map<string,string>(),find=(k:string):string=>{const p=parent.get(k);if(!p){parent.set(k,k);return k;}return p===k?k:find(p);};
 for(const key of Object.keys(row.fields))find(key);
 for(const [op,a,b] of row.rules)if(op==='same')parent.set(find(b),find(a));
 const values=new Map<string,any>(),fixed=new Set<string>();
 const initial=(type:any,k:string):any=>Array.isArray(type)?type[0]:type==='sha'?caseHash(row.id+k):type==='id'?'id-'+caseHash(row.id+k).slice(0,16):type==='n'?1:type==='ids'||type==='tables'?[]:null;
 for(const [k,type] of Object.entries(row.fields))if(!values.has(find(k)))values.set(find(k),initial(type,k));
 for(const [op,a,b] of row.rules){let value;if(op==='eq')value=b;else if(op==='subject')value=get(subject,b);else if(op==='context')value=context[b];else continue;values.set(find(a),clone(value));fixed.add(find(a));}
 for(let pass=0;pass<20;pass++)for(const [op,a,b] of row.rules){const ka=find(a),kb=typeof b==='string'?find(b):'',x=values.get(ka),y=values.get(kb);
  if(op==='includes')values.set(ka,[...new Set([...x,...b])]);
  if(op==='excludes')values.set(ka,x.filter((v:any)=>!b.includes(v)));
  if(op==='gte'&&x<b)values.set(ka,b);
  if(op==='lt'&&x>=y)values.set(kb,x+1);
  if(op==='ge_field'&&x<y)values.set(ka,y);
  if(op==='le_field'&&x>y)values.set(kb,x);
  if(op==='different'&&JSON.stringify(x)===JSON.stringify(y)){const target=fixed.has(kb)?ka:kb;if(fixed.has(target))throw Error('Conflicting fixed policy '+row.id+' '+a);values.set(target,typeof x==='string'?'different-'+caseHash(row.id+a).slice(0,12):2);}
 }
 return Object.fromEntries(Object.keys(row.fields).map(k=>[k,clone(values.get(find(k)))]));
}
