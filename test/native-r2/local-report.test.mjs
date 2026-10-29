import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
const schema=JSON.parse(readFileSync(new URL('../../spec/local-r2-sandbox-result.schema.json',import.meta.url),'utf8')),valid=new Ajv({strict:true}).compile(schema);
const row=round=>({round,freshState:true,journeyDone:true,selfReviewDenied:true,wrongRuntimeProofDenied:true,configurationDisabled:true,selectedStateUnchanged:true,httpRequests:20,sqlStatements:70,responseBytes:10000,sqlBytes:10000});
const report=()=>({type:'local-r2-sandbox-result',version:1,status:'local-source-checks-passed',transport:'local-worker-dispatch',nativeConformance:false,issue48Complete:false,acceptance:'not-evaluated',cleanup:'closed',rounds:[row(1),row(2)],budgets:{httpRequestsPerRound:32,sqlStatementsPerRound:128,rowsPerQuery:128,responseBytesPerRound:2097152,sqlBytesPerRound:2097152}});
test('local result is explicitly not native acceptance',()=>assert.equal(valid(report()),true));
for(const [name,edit] of Object.entries({native:x=>x.nativeConformance=true,issue:x=>x.issue48Complete=true,acceptance:x=>x.acceptance='passed',transport:x=>x.transport='https-native-cli',extra:x=>x.token='x',rounds:x=>x.rounds.reverse(),missingRound:x=>x.rounds.pop(),extraRound:x=>x.rounds.push(row(2)),overflow:x=>x.rounds[0].sqlStatements=129,fraction:x=>x.rounds[0].httpRequests=1.5,cleanup:x=>x.cleanup='unknown',negative:x=>x.rounds[0].selfReviewDenied=false}))test('local result rejects '+name,()=>{const r=report();edit(r);assert.equal(valid(r),false);});
