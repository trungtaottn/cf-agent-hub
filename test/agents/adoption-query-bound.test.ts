import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap,sha256,canonicalJson} from '../../src/config/bootstrap';
import {credentialGrantAllowed,type CredentialAuthorityRow} from '../../src/auth/credential-authority';
import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../../src/storage/transaction';
async function setup(name:string,count=2){
 const raw=await fixture(name);
 raw.config.human_grants[0].scopes=['credentials:manage','messages:read','messages:send'];
 raw.config.static_credential_refs[0].scopes=['messages:read'];
 raw.config.static_credential_refs.push({...raw.config.static_credential_refs[0],credential_id:'credential_second',scopes:['messages:send']});
 raw.bundle.credentials.push({...raw.bundle.credentials[0],credential_id:'credential_second',token_sha256:'2'.repeat(64)});
 if(count>2){
  const ref=raw.config.static_credential_refs[0],proof=raw.bundle.credentials[0];
  raw.config.static_credential_refs=Array.from({length:count},(_,i)=>({...ref,credential_id:'bounded_source_'+i}));
  raw.bundle.credentials=Array.from({length:count},(_,i)=>({...proof,credential_id:'bounded_source_'+i,token_sha256:(10000+i).toString(16).padStart(64,'0')}));
 }
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),input);return stub;
}
function candidate(nowMs:number):CredentialAuthorityRow{return {credential_id:'dynamic_candidate',workspace_id:'ws_example',agent_id:'agent_research',scopes_json:'["messages:read"]',project_ids_json:'null',expires_at:nowMs+60000,enabled:1,retired_at_epoch:null,config_epoch:1,origin:'human_managed',revoked_at:null,issued_by_principal_id:'human_operator'};}
// Schema9 adds one schema_migrations row to the fixed authority proof cost; credential seeks remain unchanged.
function measure(storage:DurableObjectStorage,row:CredentialAuthorityRow,nowMs:number){
 let rowsRead=0;const queries:{sql:string;rowsRead:number;plan:unknown[]}[]=[];
 const query=<T>(sql:string,bindings:readonly SqlValue[]=[])=>{const cursor=storage.sql.exec(sql,...bindings),rows=cursor.toArray() as T[];rowsRead+=cursor.rowsRead;queries.push({sql,rowsRead:cursor.rowsRead,plan:storage.sql.exec('EXPLAIN QUERY PLAN '+sql,...bindings).toArray()});return rows;};
 const tx:WorkspaceTransaction={all:query,one:<T>(sql:string,b?:readonly SqlValue[])=>query<T>(sql,b)[0]??null,exec:()=>{throw Error('read only');}};
 const allowed=storage.transactionSync(()=>credentialGrantAllowed(tx,row,nowMs));return {allowed,rowsRead,queries};
}
it('adoption current installed refs bound physical authority work independently of historical rows',async()=>{
 const stub=await setup('adoption-bound');const evidence=await runInDurableObject(stub,(_o,state)=>{
  const samples:unknown[]=[];
  const now=Date.now(),row=candidate(now),before=measure(state.storage,row,now);expect(before.allowed).toBe(true);expect(before.rowsRead).toBe(19);
  for(const count of [100,1000]){
   state.storage.sql.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO native_credentials(credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch,origin) SELECT 'history_'||?||'_'||x,'ws_example','agent_research',printf('%064x',?+x),'[]','null',0,0,1,1,'operator_static' FROM n`,count,count,count*100);
   const measured=measure(state.storage,row,now);samples.push({historicalRows:count,baseline:before.rowsRead,...measured});
   expect(measured.allowed).toBe(true);expect(measured.rowsRead).toBe(before.rowsRead);
   const credentialQueries=measured.queries.filter(q=>q.sql.includes('FROM native_credentials'));
   expect(credentialQueries.length).toBeLessThanOrEqual(2);
   for(const q of credentialQueries){expect(q.sql).toMatch(/credential_id=\?/);expect(q.rowsRead).toBeLessThanOrEqual(1);expect(JSON.stringify(q.plan)).toContain('SEARCH');}
  }
  return samples;
 });
 console.log('adoption-authority-query-proof',JSON.stringify(evidence));
});
it('adoption retains exact one-source grants and null versus empty projects',async()=>{
 const stub=await setup('adoption-coherent');await runInDurableObject(stub,(_o,state)=>{
  const now=Date.now(),row=candidate(now);
  withTransaction(state.storage,tx=>{
   expect(credentialGrantAllowed(tx,row,now)).toBe(true);
   expect(credentialGrantAllowed(tx,{...row,scopes_json:'["messages:read","messages:send"]'},now)).toBe(false);
   tx.exec("UPDATE native_credentials SET project_ids_json='[]' WHERE credential_id='credential_research_1'");
   expect(credentialGrantAllowed(tx,row,now)).toBe(false);
   expect(credentialGrantAllowed(tx,{...row,project_ids_json:'[]'},now)).toBe(true);
  });
 });
});
it.each(['revoked','retired','disabled','expired','epoch','foreign','absent-config','configured-disabled','configured-narrowed'] as const)('adoption denies %s source without alternate-grant union',async failure=>{
 const stub=await setup('adoption-source-'+failure);await runInDurableObject(stub,(_o,state)=>{
  const now=Date.now(),row=candidate(now);
  withTransaction(state.storage,tx=>{
   if(failure==='revoked')tx.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id='credential_research_1'",[now]);
   if(failure==='retired')tx.exec("UPDATE native_credentials SET retired_at_epoch=1,enabled=0 WHERE credential_id='credential_research_1'");
   if(failure==='disabled')tx.exec("UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'");
   if(failure==='expired')tx.exec("UPDATE native_credentials SET expires_at=? WHERE credential_id='credential_research_1'",[now]);
   if(failure==='epoch')tx.exec("UPDATE native_credentials SET config_epoch=2 WHERE credential_id='credential_research_1'");
   if(failure==='foreign')tx.exec("UPDATE native_credentials SET workspace_id='ws_foreign' WHERE credential_id='credential_research_1'");
   if(['absent-config','configured-disabled','configured-narrowed'].includes(failure)){
    const stored=tx.one<{config_json:string}>('SELECT config_json FROM workspace_metadata')!,config=JSON.parse(stored.config_json);
    if(failure==='configured-disabled')config.static_credential_refs[0].enabled=false;
    else if(failure==='configured-narrowed')config.static_credential_refs[0].scopes=['messages:send'];
    else config.static_credential_refs.shift();
    tx.exec('UPDATE workspace_metadata SET config_json=?',[JSON.stringify(config)]);
   }
   expect(credentialGrantAllowed(tx,row,now)).toBe(false);
  });
 });
});

it('adoption can use the final one of the canonical maximum 1000 current sources',async()=>{
 const stub=await setup('adoption-maximum-current',1000);await runInDurableObject(stub,(_o,state)=>{
  const now=Date.now();state.storage.sql.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id<>'bounded_source_999'",now);
  const measured=measure(state.storage,candidate(now),now),lookups=measured.queries.filter(q=>q.sql.includes('FROM native_credentials'));
  expect(measured.allowed).toBe(true);expect(lookups).toHaveLength(1000);expect(measured.rowsRead).toBe(1018);
  expect(lookups.every(q=>q.rowsRead===1&&JSON.stringify(q.plan).includes('SEARCH'))).toBe(true);
  state.storage.sql.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id='bounded_source_999'",now);
  expect(measure(state.storage,candidate(now),now).allowed).toBe(false);
 });
});
