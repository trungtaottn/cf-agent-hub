import {it,expect,vi} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture,proposal,claimSetup,descriptor,testInputVerifier} from '../helpers/decision-policy';
import {artifactContext,stage,bytes,wrapBucket} from '../helpers/artifacts';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {sha256} from '../../src/config/bootstrap';
import {withTransaction,type SqlValue} from '../../src/storage/transaction';
const task={taskId:'task_a',taskVersion:2},checkpoint={summary:'Synthetic checkpoint',artifact_ids:['input_a']};
const composition=testInputVerifier;
async function committed(storage:DurableObjectStorage,name:string,now:number,content='{"task_id":"task_a","task_version":2}'){
 const hash=await sha256(content),ctx=artifactContext(storage,name,'input_fixture',now);
 await stage(ctx,'input_a',{task_id:'task_a',media_type:'application/json',byte_size:new TextEncoder().encode(content).byteLength,sha256:hash});
 await uploadArtifactContent({...ctx,idempotencyKey:'upload_input'},'input_a',bytes(content),'upload_input');
 await commitArtifact({...ctx,idempotencyKey:'commit_input'},'input_a',{expected_artifact_version:2});
 return {ctx,p:proposal(hash)};
}
it('real_committed_input_binds_native_generation_and_targets',async()=>{
 const f=await decisionFixture('input_verifier_real');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition();
  const input=await api.verifyProposalInput(ctx,task,checkpoint,p);
  expect(input).toMatchObject({sha256:p.inputs.sha256,byteLength:37,artifact:{artifactVersion:3},targetBindings:[{kind:'task',id:'task_a',version:2,projectId:null}]});
  expect(typeof input.artifact.generationId).toBe('string');expect(Object.isFrozen(input.value)).toBe(true);
  const resolved=withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,p,input));
  expect(resolved.phase).toBe('resolved');expect(resolved.artifactEdges.map((e:any)=>e.role)).toEqual(['checkpoint','input']);
 });
});
it('near_10MiB_real_R2_committed_closed_fixture_succeeds_with_native_BYOB',async()=>{
 const f=await decisionFixture('input_verifier_near_limit');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),json='{"task_id":"task_a","task_version":2}',content=json+' '.repeat(10485760-json.length),{ctx,p}=await committed(s.storage,f.name,now,content),api=await composition();
  const input=await api.verifyProposalInput(ctx,task,checkpoint,p);expect(input.byteLength).toBe(10485760);expect(input.sha256).toBe(p.inputs.sha256);
 });
},30000);

it('rejects forged provenance before touching fake getters or Proxy properties',async()=>{
 const api=await composition();let touched=0;
 const fake=new Proxy({},{get(){touched++;throw Error('MUST_NOT_READ_FAKE');}});
 expect(()=>api.recheckProposalInput({} as never,{} as never,{} as never,{} as never,{} as never,fake as never)).toThrow('DECISION_UNAVAILABLE');expect(touched).toBe(0);
});
it('rejects getter-bearing extractor arrays without evaluating their observations',async()=>{
 const f=await decisionFixture('input_extractor_array_getter');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),{createProposalInputVerifier}=await import('../../src/approvals/input-binding-source');let reads=0;
  const targets=[] as {kind:string;id:string;version:number}[];Object.defineProperty(targets,'0',{enumerable:true,get(){reads++;return {kind:'task',id:'task_a',version:2};}});
  const api=createProposalInputVerifier([{...descriptor,extractInputTargets:()=>targets}]);
  await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(reads).toBe(0);
 });
});

function allTables(storage:DurableObjectStorage){
 return Object.fromEntries(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray().map(({name})=>[name,storage.sql.exec('SELECT * FROM "'+name.replaceAll('"','""')+'"').toArray().map(row=>JSON.stringify(row)).sort()]));
}
const checkedStorage=(storage:DurableObjectStorage)=>new Proxy(storage,{get(target,key){if(key==='sql')return new Proxy(target.sql,{get(sql,k){if(k==='exec')return (query:string,...args:SqlValue[])=>{if(!/^\s*SELECT\b/i.test(query))throw Error('SQL_WRITE_TRIPWIRE');return sql.exec(query,...args);};const v=Reflect.get(sql,k,sql);return typeof v==='function'?v.bind(sql):v;}});const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
const queryBucket=(bucket:R2Bucket,get?:R2Bucket['get'])=>new Proxy(bucket,{get(target,key){if(key==='get'&&get)return get;if(['put','delete','list','head'].includes(String(key)))return ()=>{throw Error('R2_WRITE_OR_EXTRA_READ_TRIPWIRE');};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
const replaceBody=(object:R2ObjectBody,body:ReadableStream<Uint8Array>,patch:Record<string,unknown>={})=>new Proxy(object,{get(target,key){if(key==='body')return body;if(Object.hasOwn(patch,key))return patch[String(key)];return Reflect.get(target,key,target);}});

it('verification_and_consuming_recheck_are_SELECT_only_across_every_table_and_preserve_real_lease',async()=>{
 const f=await decisionFixture('input_all_tables');await runInDurableObject(f.stub,async(_o,s)=>{
  const setup=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,setup.now),{executeCommand}=await import('../../src/workspace/commands'),{claimTaskCommand}=await import('../../src/tasks/claim'),{claimContext,PROOF_A}=await import('../helpers/claims');
  executeCommand(await claimContext(s.storage,f.name,setup.body,'verifier_lease',setup.now,'task_b'),setup.identity,claimTaskCommand('task_b','verifier_run',PROOF_A),setup.body);
  let now=setup.now;const workspace={...ctx.workspace,storage:checkedStorage(s.storage),clock:{nowMs:()=>now}},safe={...ctx,workspace,bucket:queryBucket(ctx.bucket!)},before=allTables(s.storage),api=await composition();
  const input=await api.verifyProposalInput(safe,task,checkpoint,p);now+=60000;
  const resolution=withTransaction(workspace.storage,tx=>api.recheckProposalInput(tx,safe,task,checkpoint,p,input));
  expect(resolution.expiresAt).toBe(setup.now+120000);expect(resolution.resolvedAt).toBe(setup.now);expect(allTables(s.storage)).toEqual(before);
  now=setup.now+120000;expect(()=>withTransaction(workspace.storage,tx=>api.recheckProposalInput(tx,safe,task,checkpoint,p,input))).toThrow('DECISION_UNAVAILABLE');expect(allTables(s.storage)).toEqual(before);
 });
});
it('private_receipt_rejects_clone_wrap_other_composition_and_changed_intent_without_writes',async()=>{
 const f=await decisionFixture('input_private_provenance');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),input=await api.verifyProposalInput(ctx,task,checkpoint,p),other=await composition(),before=allTables(s.storage);
  for(const fake of [{...input},structuredClone(input),JSON.parse(JSON.stringify(input)),new Proxy(input,{})])expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,p,fake))).toThrow('DECISION_UNAVAILABLE');
  expect(()=>withTransaction(s.storage,tx=>other.recheckProposalInput(tx,ctx,task,checkpoint,p,input))).toThrow('DECISION_UNAVAILABLE');
  for(const cp of [{...checkpoint,summary:'Changed'},{...checkpoint,artifact_ids:[]}])expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,cp,p,input))).toThrow('DECISION_UNAVAILABLE');
  expect(()=>{(input.value as {task_id:string}).task_id='task_b';}).toThrow();expect(Object.isFrozen(input.policy)).toBe(true);expect(Object.isFrozen(input.targetBindings[0])).toBe(true);expect(allTables(s.storage)).toEqual(before);
 });
});
it('original_context_identity_workspace_bucket_clock_and_intent_are_pinned_before_get_await',async()=>{
 const f=await decisionFixture('input_pinned_context');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),cp=structuredClone(checkpoint),original=structuredClone(p),originalWorkspace=ctx.workspace;
  const bucket=ctx.bucket!;ctx.bucket=wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{
   const result=await bucket.get(...args);ctx.identity={...ctx.identity,credentialId:'credential_other'} as typeof ctx.identity;ctx.admission.authorityEpoch=99;ctx.workspace={...originalWorkspace,objectName:'wrong_object',clock:{nowMs:()=>now+999999}};ctx.bucket={} as R2Bucket;p.summary='Changed';cp.summary='Changed';return result;
  }});
  const result=await api.verifyProposalInput(ctx,task,cp,p);expect(result.policy.workspaceId).toBe('ws_example');expect(result.sha256).toBe(original.inputs.sha256);
  expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,original,result))).toThrow('DECISION_UNAVAILABLE');
 });
});
it.each([
 ['duplicate decoded keys','{"task_id":"task_a","task_id":"task_a","task_version":2}'],
 ['unknown schema field','{"task_id":"task_a","task_version":2,"extra":true}'],
 ['wrong schema version','{"task_id":"task_a","task_version":0}'],
 ['target version','{"task_id":"task_a","task_version":3}'],
 ['scope cannot replace target','{"task_id":"task_b","task_version":2}'],
 ['BOM','\uFEFF{"task_id":"task_a","task_version":2}'],
 ['depth limit','['.repeat(65)+'0'+']'.repeat(65)],
 ['node limit','['+'0,'.repeat(100000)+'0]'],
])('closed_parser_and_schema_reject_actual_committed_bytes: %s',async(label,content)=>{
 const f=await decisionFixture('input_closed_'+label.replaceAll(' ','_').toLowerCase());await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now,content),api=await composition(),before=allTables(s.storage);await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(allTables(s.storage)).toEqual(before);
 });
});
it('intent_is_closed_prebounded_combined_and_role_references_are_conjunctions',async()=>{
 const f=await decisionFixture('input_intent_bounds');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition();let gets=0;const safe={...ctx,bucket:wrapBucket(ctx.bucket!,{get:async(...args:Parameters<R2Bucket['get']>)=>{gets++;return ctx.bucket!.get(...args);}})};
  const cases=[{cp:{...checkpoint,artifact_ids:['input_a','input_a']},p},{cp:{...checkpoint,extra:true},p},{cp:{...checkpoint,summary:'x'.repeat(65537)},p},{cp:{...checkpoint,summary:'x'.repeat(33000)},p:{...p,summary:'y'.repeat(33000)}},{cp:{...checkpoint,artifact_ids:['missing']},p},{cp:checkpoint,p:{...p,artifact_ids:['input_a','input_a']}},{cp:checkpoint,p:{...p,scope:{...p.scope,resource_ids:['task_b']}}}];
  for(const c of cases)await expect(api.verifyProposalInput(safe,task,c.cp,c.p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(gets).toBe(1); // only target mismatch reaches bytes
  const verified=await api.verifyProposalInput(ctx,task,checkpoint,{...p,artifact_ids:['input_a']});const resolution=withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,{...p,artifact_ids:['input_a']},verified));expect(resolution.artifactEdges.map(e=>e.role)).toEqual(['checkpoint','proposal','input']);expect(resolution.artifacts).toHaveLength(1);
 });
});
it('literal_true_schema_precedes_pure_closed_target_extraction_and_exact_coverage',async()=>{
 const f=await decisionFixture('input_source_schema');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),{createProposalInputVerifier}=await import('../../src/approvals/input-binding-source');let extracted=0;
  for(const value of [false,{},Promise.resolve(true)]){
   const api=createProposalInputVerifier([{...descriptor,validateInput:(()=>value) as never,extractInputTargets:()=>{extracted++;return [];}}]);await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');
  }
  expect(extracted).toBe(0);
  for(const targets of [[],[{kind:'task',id:'task_a',version:2},{kind:'task',id:'task_a',version:2}],[{kind:'message',id:'task_a',version:2}],[{kind:'task',id:'task_a',version:2,extra:true}],Promise.resolve([{kind:'task',id:'task_a',version:2}])]){
   const api=createProposalInputVerifier([{...descriptor,extractInputTargets:(()=>targets) as never}]);await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');
  }
 });
});

it('direct_SQL_corruption_races_invalidate_full_snapshots_at_get_and_final_transaction',async()=>{
 const f=await decisionFixture('input_sql_races');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),input=await api.verifyProposalInput(ctx,task,checkpoint,p);
  const cases:[string,string,Record<string,SqlValue>][]=[
   ['native_credentials',"credential_id='credential_research_1'",{enabled:0}],['native_credentials',"credential_id='credential_research_1'",{expires_at:now}],['native_credentials',"credential_id='credential_research_1'",{scopes_json:'[]'}],['native_credentials',"credential_id='credential_research_1'",{project_ids_json:'[]'}],
   ...[{enabled:0},{issuer:'https://wrong.example.invalid'},{subject:'wrong'},{config_epoch:2},{scopes_json:'[]'},{project_ids_json:'[]'}].map(patch=>['human_grants',"principal_id='human_reviewer'",patch] as unknown as [string,string,Record<string,SqlValue>]),
   ['tasks',"id='task_a'",{task_version:3}],['tasks',"id='task_a'",{proposal_version:1}],['tasks',"id='task_a'",{project_id:'project_a'}],
   ['workspace_metadata','id=1',{config_digest:'f'.repeat(64)}],['workspace_metadata','id=1',{installation_digest:'e'.repeat(64)}],['workspace_metadata','id=1',{config_epoch:2}],['maintenance_state','id=1',{generation:1}],['maintenance_state','id=1',{state:'capturing'}],
   ...[{media_type:'application/json; charset=utf-8'},{media_type:'Application/JSON'},{byte_size:38},{sha256:'f'.repeat(64)},{artifact_version:4},{committed_at:now+1},{status:'uploaded',expires_at:now+1,committed_at:null},{filename:'different.json'},{active_generation_id:null},{status:'uploaded',expires_at:now+1,committed_at:null}].map(patch=>['artifacts',"id='input_a'",patch] as unknown as [string,string,Record<string,SqlValue>]),
   ...[{object_key:'never_a_public_key'},{expected_byte_size:38,observed_byte_size:38},{expected_sha256:'a'.repeat(64),observed_sha256:'a'.repeat(64)},{state:'tombstoned'},{updated_at:now+1},{effect_state:'uncertain',effect_drained_at:null},{admission_generation:1}].map(patch=>['artifact_generations',"artifact_id='input_a'",patch] as unknown as [string,string,Record<string,SqlValue>]),
  ];
  for(const [table,where,patch] of cases){
   const row=s.storage.sql.exec<Record<string,SqlValue>>('SELECT * FROM '+table+' WHERE '+where).one();
   const change=()=>{s.storage.sql.exec('UPDATE '+table+' SET '+Object.keys(patch).map(column=>column+'=?').join(',')+' WHERE '+where,...Object.values(patch));};
   const restore=()=>{s.storage.sql.exec('UPDATE '+table+' SET '+Object.keys(patch).map(column=>column+'=?').join(',')+' WHERE '+where,...Object.keys(patch).map(column=>row[column]));};
   change();const before=allTables(s.storage);expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,p,input)),table+JSON.stringify(patch)).toThrow('DECISION_UNAVAILABLE');expect(allTables(s.storage)).toEqual(before);restore();
   const base=ctx.bucket!,racing={...ctx,bucket:wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=await base.get(...args);change();return object;}})};
   await expect(api.verifyProposalInput(racing,task,checkpoint,p),table+JSON.stringify(patch)).rejects.toThrow('DECISION_UNAVAILABLE');restore();
  }
  // Unsupported persisted checkpoint association remains denied for every reference role.
  s.storage.sql.exec("INSERT INTO artifact_associations VALUES('ws_example','input_a','checkpoint','unsupported_checkpoint')");await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,p,input))).toThrow('DECISION_UNAVAILABLE');
 });
},30000);
it('installed_reviewer_ceiling_policy_and_semantic_identity_are_current_conjunctions',async()=>{
 const f=await decisionFixture('input_installed_races');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),input=await api.verifyProposalInput(ctx,task,checkpoint,p),original=s.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json;
  for(const mutation of [
   (c:typeof f.input.config)=>{c.human_grants[1].enabled=false;},(c:typeof f.input.config)=>{c.human_grants[1].scopes=c.human_grants[1].scopes.filter(scope=>scope!=='approvals:decide');},(c:typeof f.input.config)=>{c.human_grants[1].project_ids=[];},
   (c:typeof f.input.config)=>{c.workspace_policies[0].decision_policy!.policy_version++;},(c:typeof f.input.config)=>{c.workspace_policies[0].decision_policy!.expiry_seconds++;},(c:typeof f.input.config)=>{c.workspace_policies[0].decision_policy!.actions[0].schema_version++;},(c:typeof f.input.config)=>{c.workspace_policies[0].decision_policy!.actions[0].schema_sha256='f'.repeat(64);},
  ]){
   const c=JSON.parse(original) as typeof f.input.config;mutation(c);const change=()=>s.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(c));change();expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,p,input))).toThrow('DECISION_UNAVAILABLE');s.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',original);const base=ctx.bucket!,racing={...ctx,bucket:wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=await base.get(...args);change();return object;}})};await expect(api.verifyProposalInput(racing,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');s.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',original);
  }
  const {createProposalInputVerifier}=await import('../../src/approvals/input-binding-source'),changed=createProposalInputVerifier([{...descriptor,semanticRevision:'synthetic-task-review@3'}]);expect(()=>withTransaction(s.storage,tx=>changed.recheckProposalInput(tx,ctx,task,checkpoint,p,input))).toThrow('DECISION_UNAVAILABLE');
 });
});
it('fresh_trusted_clock_detects_exact_credential_expiry_after_each_read_await',async()=>{
 const f=await decisionFixture('input_read_expiry');await runInDurableObject(f.stub,async(_o,s)=>{
  const setup=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,setup.now),api=await composition();let now=setup.now,reads=0;
  s.storage.sql.exec("UPDATE native_credentials SET expires_at=? WHERE credential_id='credential_research_1'",now+1000);
  const base=ctx.bucket!,racing={...ctx,workspace:{...ctx.workspace,clock:{nowMs:()=>now}},bucket:wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=(await base.get(...args))!,body=object.body;return replaceBody(object,new Proxy(body,{get(target,key){if(key==='getReader')return ()=>{const reader=target.getReader({mode:'byob'}) as ReadableStreamBYOBReader&{readAtLeast(n:number,v:Uint8Array):Promise<{done:boolean;value?:Uint8Array}>};return {readAtLeast:async(n:number,v:Uint8Array)=>{const result=await reader.readAtLeast(n,v);reads++;now=setup.now+1000;return result;},cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock()};};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}));}})};
  const before=allTables(s.storage);await expect(api.verifyProposalInput(racing,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(reads).toBe(1);expect(allTables(s.storage)).toEqual(before);
 });
});
it('hash_await_rechecks_current_SQL',async()=>{
 const f=await decisionFixture('input_hash_race');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),original=crypto.subtle.digest.bind(crypto.subtle);
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args:Parameters<SubtleCrypto['digest']>)=>{const result=await original(...args);s.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_reviewer'");return result;});
  try{await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');}finally{spy.mockRestore();}
 });
});

it('post_parse_cooperative_yield_processes_revocation_and_cancellation_before_mint',async()=>{
 const f=await decisionFixture('input_post_parse_yield');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),{createProposalInputVerifier}=await import('../../src/approvals/input-binding-source');
  for(const mode of ['SQL','cancel']){
   const controller=new AbortController();let fired=false;
   const api=createProposalInputVerifier([{...descriptor,extractInputTargets:value=>{setTimeout(()=>{fired=true;if(mode==='SQL')s.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_reviewer'");else controller.abort();},0);return descriptor.extractInputTargets(value);}}]);
   await expect(api.verifyProposalInput({...ctx,signal:controller.signal},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(fired).toBe(true);s.storage.sql.exec("UPDATE human_grants SET enabled=1 WHERE principal_id='human_reviewer'");
  }
 });
});
it('pending_get_read_hash_and_hung_cleanup_are_cancellable_without_late_mint',async()=>{
 const f=await decisionFixture('input_pending_operations');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),base=ctx.bucket!;
  for(const mode of ['get','read','hash']){
   const controller=new AbortController();let cancelled=0,lateGet:((value:R2ObjectBody|null)=>void)|undefined;
   const body={getReader:()=>({readAtLeast:()=>new Promise(()=>{}),cancel:()=>{cancelled++;return new Promise(()=>{});},releaseLock:()=>{}}),cancel:()=>{cancelled++;return new Promise(()=>{});}} as unknown as ReadableStream<Uint8Array>;
   const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{if(mode==='get')return new Promise<R2ObjectBody|null>(resolve=>{lateGet=resolve;});const object=(await base.get(...args))!;if(mode==='read'){void object.body.cancel().catch(()=>{});return replaceBody(object,body);}return object;}});
   const spy=mode==='hash'?vi.spyOn(crypto.subtle,'digest').mockImplementation(()=>new Promise(()=>{})):undefined;
   const before=allTables(s.storage),pending=api.verifyProposalInput({...ctx,bucket,signal:controller.signal},task,checkpoint,p);setTimeout(()=>controller.abort(),10);
   try{await expect(pending).rejects.toThrow('DECISION_UNAVAILABLE');if(mode==='read')expect(cancelled).toBe(1);if(lateGet){const object=(await base.get('nonexistent'));// late null is inert; a separate late body test follows
     lateGet(object);await scheduler.wait(0);}
    expect(allTables(s.storage)).toEqual(before);
   }finally{spy?.mockRestore();}
  }
 });
});
it('late_get_body_is_cancelled_and_never_read_after_cancellation',async()=>{
 const f=await decisionFixture('input_late_get');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),controller=new AbortController();let resolve!:(value:R2ObjectBody|null)=>void,cancelled=0,read=0;
  const bucket=wrapBucket(ctx.bucket!,{get:()=>new Promise<R2ObjectBody|null>(done=>{resolve=done;})});const pending=api.verifyProposalInput({...ctx,bucket,signal:controller.signal},task,checkpoint,p);controller.abort();await expect(pending).rejects.toThrow('DECISION_UNAVAILABLE');
  resolve({body:{cancel(){cancelled++;return Promise.resolve();},getReader(){read++;throw Error('late body read');}}} as unknown as R2ObjectBody);await scheduler.wait(0);expect(cancelled).toBe(1);expect(read).toBe(0);
 });
});
it('30second_async_deadline_is_independent_of_candidate_lifetime_and_cancels_pending_get',async()=>{
 const f=await decisionFixture('input_operational_deadline');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),timeout=globalThis.setTimeout.bind(globalThis);let observed=0;
  // Real runtime timer, accelerated only in this test; the source still requests 30000ms.
  const spy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((fn:TimerHandler,ms?:number,...args:unknown[])=>{if(ms===30000){observed++;return timeout(fn,10,...args);}return timeout(fn,ms,...args);}) as typeof setTimeout);
  try{const before=allTables(s.storage);await expect(api.verifyProposalInput({...ctx,bucket:wrapBucket(ctx.bucket!,{get:()=>new Promise(()=>{})})},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(observed).toBe(1);expect(allTables(s.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});

it('real_native_BYOB_coalesces_one_byte_fragments_and_copies_detaching_scratch_views',async()=>{
 const f=await decisionFixture('input_native_fragments');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),content='{"task_id":"task_a","task_version":2}',{ctx,p}=await committed(s.storage,f.name,now,content),api=await composition(),base=ctx.bucket!;let reads=0;
  const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{
   const object=(await base.get(...args))!;void object.body.cancel().catch(()=>{});const fixed=new FixedLengthStream(content.length),writer=fixed.writable.getWriter();
   void (async()=>{for(const byte of new TextEncoder().encode(content))await writer.write(new Uint8Array([byte]));await writer.close();})().catch(()=>{});
   const body=new Proxy(fixed.readable,{get(target,key){if(key==='getReader')return ()=>{const reader=target.getReader({mode:'byob'}) as ReadableStreamBYOBReader&{readAtLeast(n:number,v:Uint8Array):Promise<{done:boolean;value?:Uint8Array}>};return {readAtLeast:async(n:number,v:Uint8Array)=>{reads++;const result=await reader.readAtLeast(n,v);expect(v.byteLength).toBe(0);return result;},cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock()};};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
   return replaceBody(object,body);
  }});
  const verified=await api.verifyProposalInput({...ctx,bucket},task,checkpoint,p);expect(verified.sha256).toBe(p.inputs.sha256);expect(reads).toBeLessThanOrEqual(2);
 });
});
it('frozen_clock_suppressed_timers_still_bound_immediate_malformed_BYOB_without_default_fallback',async()=>{
 const f=await decisionFixture('input_frozen_budgets');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),base=ctx.bucket!;
  for(const mode of ['empty','onebyte','overflow','short','malformed','no_byob','no_coalescing','encoding','wrong_size']){
   let reads=0,cancelled=0;const body={getReader:(options:{mode:string})=>{expect(options.mode).toBe('byob');if(mode==='no_byob')throw Error('unavailable');return {readAtLeast:mode==='no_coalescing'?undefined:async()=>{reads++;if(mode==='malformed')return {done:false,value:'not bytes'};return {done:mode==='short',value:new Uint8Array(mode==='overflow'?38:mode==='onebyte'||mode==='short'?1:0)};},cancel:()=>{cancelled++;return Promise.resolve();},releaseLock:()=>{}};},cancel:()=>{cancelled++;return Promise.resolve();}} as unknown as ReadableStream<Uint8Array>;
   const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=(await base.get(...args))!;void object.body.cancel().catch(()=>{});return replaceBody(object,body,mode==='encoding'?{httpMetadata:{contentEncoding:'gzip'}}:mode==='wrong_size'?{size:38}:{});}});
   const timer=vi.spyOn(globalThis,'setTimeout').mockImplementation((()=>0) as never);
   try{await expect(api.verifyProposalInput({...ctx,bucket},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(reads).toBeLessThanOrEqual(1);expect(cancelled).toBe(1);}finally{timer.mockRestore();}
  }
 });
});
it('one_shared_16384_reference_budget_bounds_all_guards_and_assigned_humans',async()=>{
 const {syntheticPolicy}=await import('../helpers/decision-policy'),policy=structuredClone(syntheticPolicy);policy.actions[0].reviewer_ids=['human_operator','human_reviewer',...Array.from({length:62},(_,i)=>'human_reviewer_'+(i+2))];
 const f=await decisionFixture('input_shared_reference_budget',policy,64);await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),json='{"task_id":"task_a","task_version":2}',{ctx,p}=await committed(s.storage,f.name,now,json+' '.repeat(10485760-json.length)),api=await composition(),base=ctx.bucket!;let reads=0;
  const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=(await base.get(...args))!,body=new Proxy(object.body,{get(target,key){if(key==='getReader')return ()=>{const reader=target.getReader({mode:'byob'}) as ReadableStreamBYOBReader&{readAtLeast(n:number,v:Uint8Array):Promise<{done:boolean;value?:Uint8Array}>};return {readAtLeast:(n:number,v:Uint8Array)=>{reads++;return reader.readAtLeast(n,v);},cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock()};};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});return replaceBody(object,body);}});
  const before=allTables(s.storage);await expect(api.verifyProposalInput({...ctx,bucket},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(reads).toBeGreaterThan(0);expect(reads).toBeLessThan(161);expect(allTables(s.storage)).toEqual(before);
 });
});
it('five_real_distinct_artifacts_allow_26214400_byte_union_but_deny_six_or_one_extra_byte',async()=>{
 const f=await decisionFixture('input_real_union');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition();
  for(const [id,size] of [['aux_one',10485760],['aux_two',10485760],['aux_three',5242842],['aux_four',1],['aux_five',1],['aux_over',2]] as const){
   const content=' '.repeat(size),hash=await sha256(content);await stage(ctx,id,{task_id:'task_a',media_type:'text/plain',byte_size:size,sha256:hash});await uploadArtifactContent({...ctx,idempotencyKey:'upload_'+id},id,bytes(content),'upload_'+id);await commitArtifact({...ctx,idempotencyKey:'commit_'+id},id,{expected_artifact_version:2});
  }
  const cp={...checkpoint,artifact_ids:['input_a','aux_one','aux_two']},pr={...p,artifact_ids:['aux_three','aux_four']},verified=await api.verifyProposalInput(ctx,task,cp,pr),resolved=withTransaction(s.storage,tx=>api.recheckProposalInput(tx,ctx,task,cp,pr,verified));
  expect(resolved.artifacts).toHaveLength(5);expect(resolved.artifacts.reduce((sum,a)=>sum+a.byteLength,0)).toBe(26214400);
  await expect(api.verifyProposalInput(ctx,task,cp,{...pr,artifact_ids:['aux_three','aux_four','aux_five']})).rejects.toThrow('DECISION_UNAVAILABLE');await expect(api.verifyProposalInput(ctx,task,cp,{...pr,artifact_ids:['aux_three','aux_over']})).rejects.toThrow('DECISION_UNAVAILABLE');
 });
},30000);

it('cleanup_cannot_replace_fixed_unavailable_with_private_source_error_or_hang',async()=>{
 const f=await decisionFixture('input_cleanup_error');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),base=ctx.bucket!;
  const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=(await base.get(...args))!;void object.body.cancel().catch(()=>{});return replaceBody(object,{getReader:()=>({readAtLeast:async()=>{throw Error('private byte reader details');},cancel:()=>{throw Error('private cleanup details');},releaseLock:()=>{throw Error('private lock details');}})} as unknown as ReadableStream<Uint8Array>);}});
  await expect(api.verifyProposalInput({...ctx,bucket},task,checkpoint,p)).rejects.toThrow(/^DECISION_UNAVAILABLE$/);
 });
});

it('staged_uploaded_wrong_digest_workspace_and_EMPTY_production_registry_never_establish_provenance',async()=>{
 const f=await decisionFixture('input_stage_states');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),content='{"task_id":"task_a","task_version":2}',hash=await sha256(content),ctx=artifactContext(s.storage,f.name,'stage_states',now),p=proposal(hash),api=await composition();
  await stage(ctx,'input_a',{task_id:'task_a',media_type:'application/json',byte_size:content.length,sha256:hash});await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');
  await uploadArtifactContent({...ctx,idempotencyKey:'upload_state'},'input_a',bytes(content),'upload_state');await expect(api.verifyProposalInput(ctx,task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');
  await commitArtifact({...ctx,idempotencyKey:'commit_state'},'input_a',{expected_artifact_version:2});
  await expect(api.verifyProposalInput(ctx,task,checkpoint,{...p,inputs:{...p.inputs,sha256:'f'.repeat(64)}})).rejects.toThrow('DECISION_UNAVAILABLE');await expect(api.verifyProposalInput({...ctx,identity:{...ctx.identity,workspaceId:'wrong_workspace'}},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');
  const {verifyProposalInput}=await import('../../src/approvals/input-binding');let gets=0;await expect(verifyProposalInput({...ctx,bucket:wrapBucket(ctx.bucket!,{get:async()=>{gets++;throw Error('must not get');}})},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(gets).toBe(0);
  const input=await api.verifyProposalInput(ctx,task,checkpoint,p);expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,{...ctx,workspace:{...ctx.workspace}},task,checkpoint,p,input))).toThrow('DECISION_UNAVAILABLE');
 });
});
it('exact_whitespace_bytes_change_actual_committed_hash_and_never_reserialize_into_identity',async()=>{
 const outputs:string[]=[];
 for(const [index,content] of ['{"task_id":"task_a","task_version":2}','{ "task_id": "task_a", "task_version": 2 }\n'].entries()){
  const f=await decisionFixture('input_whitespace_'+index);await runInDurableObject(f.stub,async(_o,s)=>{const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now,content),api=await composition(),input=await api.verifyProposalInput(ctx,task,checkpoint,p);outputs.push(input.sha256);expect(input.sha256).toBe(await sha256(content));expect(input.value).toEqual({task_id:'task_a',task_version:2});});
 }
 expect(outputs[0]).not.toBe(outputs[1]);
});

it('consuming_recheck_rejects_other_storage_transaction_even_with_identical_rows_and_original_context',async()=>{
 const f=await decisionFixture('input_transaction_origin');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,now),api=await composition(),input=await api.verifyProposalInput(ctx,task,checkpoint,p);
  // A distinct storage wrapper exposes exactly the same rows. It is still not
  // the storage object pinned by the real verifier invocation/consuming command.
  const otherStorage=new Proxy(s.storage,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  expect(()=>withTransaction(otherStorage,tx=>api.recheckProposalInput(tx,ctx,task,checkpoint,p,input))).toThrow('DECISION_UNAVAILABLE');
  let escaped!:import('../../src/storage/transaction').WorkspaceTransaction;withTransaction(s.storage,tx=>{escaped=tx;expect(()=>api.recheckProposalInput({...tx},ctx,task,checkpoint,p,input)).toThrow('DECISION_UNAVAILABLE');});
  expect(()=>api.recheckProposalInput(escaped,ctx,task,checkpoint,p,input)).toThrow('DECISION_UNAVAILABLE');
 });
});

it('cooperative_yield_every_eight_immediate_reads_processes_cancellation_with_frozen_clock',async()=>{
 const f=await decisionFixture('input_eight_read_yield');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),json='{"task_id":"task_a","task_version":2}',content=json+' '.repeat(12*65536-json.length),{ctx,p}=await committed(s.storage,f.name,now,content),api=await composition(),controller=new AbortController(),base=ctx.bucket!;let offset=0,reads=0,fired=false;
  const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=(await base.get(...args))!;void object.body.cancel().catch(()=>{});return replaceBody(object,{getReader:()=>({readAtLeast:async(_n:number,view:Uint8Array)=>{reads++;if(reads===1)setTimeout(()=>{fired=true;controller.abort();},0);const size=Math.min(view.length,content.length-offset);view.set(new TextEncoder().encode(content.slice(offset,offset+size)));offset+=size;return {done:size===0,value:view.subarray(0,size)};},cancel:()=>Promise.resolve(),releaseLock:()=>{}})} as unknown as ReadableStream<Uint8Array>);}});
  await expect(api.verifyProposalInput({...ctx,bucket,signal:controller.signal},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');expect(fired).toBe(true);expect(reads).toBe(8);
 });
});
it('retained_snapshot_is_copied_before_a_producer_reuses_mutable_chunk_storage',async()=>{
 const f=await decisionFixture('input_chunk_mutation');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),json='{"task_id":"task_a","task_version":2}',content=json+' '.repeat(70000-json.length),{ctx,p}=await committed(s.storage,f.name,now,content),api=await composition(),base=ctx.bucket!,shared=new Uint8Array(65536);let offset=0,reads=0;
  const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=(await base.get(...args))!;void object.body.cancel().catch(()=>{});return replaceBody(object,{getReader:()=>({readAtLeast:async(n:number)=>{reads++;shared.fill(0);const size=Math.min(n,content.length-offset);shared.set(new TextEncoder().encode(content.slice(offset,offset+size)));offset+=size;return {done:size===0,value:shared.subarray(0,size)};},cancel:()=>Promise.resolve(),releaseLock:()=>{}})} as unknown as ReadableStream<Uint8Array>);}});
  const input=await api.verifyProposalInput({...ctx,bucket},task,checkpoint,p);expect(input.sha256).toBe(p.inputs.sha256);expect(reads).toBe(3);
 });
});

it('fatal_UTF8_and_exact_SQL_MIME_are_checked_against_real_ordinary_committed_bytes',async()=>{
 for(const mode of ['utf8','charset','case']){
  const f=await decisionFixture('input_actual_'+mode);await runInDurableObject(f.stub,async(_o,s)=>{
   const {now}=claimSetup(s.storage),content=mode==='utf8'?new Uint8Array([0xff]):new TextEncoder().encode('{"task_id":"task_a","task_version":2}'),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(v=>v.toString(16).padStart(2,'0')).join(''),ctx=artifactContext(s.storage,f.name,'bytes_'+mode,now),mime=mode==='charset'?'application/json; charset=utf-8':mode==='case'?'Application/JSON':'application/json';
   await stage(ctx,'input_a',{task_id:'task_a',media_type:mime,byte_size:content.byteLength,sha256:hash});await uploadArtifactContent({...ctx,idempotencyKey:'upload_bytes'},'input_a',new Blob([content]).stream(),'upload_bytes');await commitArtifact({...ctx,idempotencyKey:'commit_bytes'},'input_a',{expected_artifact_version:2});const api=await composition();await expect(api.verifyProposalInput(ctx,task,checkpoint,proposal(hash))).rejects.toThrow('DECISION_UNAVAILABLE');
  });
 }
});
it('expired_real_run_is_neither_renewed_nor_required_as_an_input_verification_permit',async()=>{
 const f=await decisionFixture('input_lease_expires');await runInDurableObject(f.stub,async(_o,s)=>{
  const setup=claimSetup(s.storage),{ctx,p}=await committed(s.storage,f.name,setup.now),{executeCommand}=await import('../../src/workspace/commands'),{claimTaskCommand}=await import('../../src/tasks/claim'),{claimContext,PROOF_A}=await import('../helpers/claims');
  executeCommand(await claimContext(s.storage,f.name,setup.body,'expires_lease',setup.now,'task_b'),setup.identity,claimTaskCommand('task_b','expires_run',PROOF_A),setup.body);
  let now=setup.now+59000;const api=await composition(),base=ctx.bucket!,bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const result=await base.get(...args);now=setup.now+60001;return result;}}),safe={...ctx,workspace:{...ctx.workspace,clock:{nowMs:()=>now}},bucket},before=allTables(s.storage);
  const input=await api.verifyProposalInput(safe,task,checkpoint,p);expect(now).toBe(setup.now+60001);expect(()=>withTransaction(s.storage,tx=>api.recheckProposalInput(tx,safe,task,checkpoint,p,input))).not.toThrow();expect(allTables(s.storage)).toEqual(before);
 });
});

it('malformed_BYOB_done_discriminant_cannot_claim_exact_EOF',async()=>{
 const f=await decisionFixture('input_malformed_done');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),content='{"task_id":"task_a","task_version":2}',{ctx,p}=await committed(s.storage,f.name,now,content),api=await composition(),base=ctx.bucket!;
  const bucket=wrapBucket(base,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=(await base.get(...args))!;void object.body.cancel().catch(()=>{});return replaceBody(object,{getReader:()=>({readAtLeast:async()=>({done:'true',value:new TextEncoder().encode(content)}),cancel:()=>Promise.resolve(),releaseLock:()=>{}})} as unknown as ReadableStream<Uint8Array>);}});
  await expect(api.verifyProposalInput({...ctx,bucket},task,checkpoint,p)).rejects.toThrow('DECISION_UNAVAILABLE');
 });
});
