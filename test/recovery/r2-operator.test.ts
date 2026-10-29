import {describe,it,expect} from 'vitest';
import {exports} from 'cloudflare:workers';
const url='https://operator.example.invalid/operator/recovery';
async function assertion(claims:Record<string,unknown>={}){return (await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:JSON.stringify({claims})})).text();}
describe('R2 operator gateway remains a separate recovery authority',()=>{
 it('denies product bearer tokens and wrong service common_name before current restore admission',async()=>{
  const command={operation:'restore',workspace_id:'ws_recovery_transport',capture_id:'capture_denied',expected_authority_epoch:0,operation_id:'restore_denied',reason:'Synthetic authority boundary',payload:{manifest:{format_version:2},ledger:{}}};
  for(const headers of [{authorization:'Bearer '+ 'A'.repeat(43)},{'cf-access-jwt-assertion':await assertion({common_name:'unknown-service.access'})}] as Record<string,string>[]){
   const response=await exports.default.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(command)}));
   expect(response.status).not.toBe(200);expect(await response.text()).not.toContain('A'.repeat(43));
  }
 });
 it('does not turn caller-supplied provider fields into recovery authority',async()=>{
  const command={operation:'probe',workspace_id:'ws_recovery_transport',capture_id:null,expected_authority_epoch:0,operation_id:'probe_forgery',reason:'Synthetic closed envelope',payload:{},anchor_url:'https://attacker.invalid/current',trusted_anchor:{generation:1}};
  const response=await exports.default.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':await assertion()},body:JSON.stringify(command)}));
  expect(response.status).toBe(400);
 });
});
