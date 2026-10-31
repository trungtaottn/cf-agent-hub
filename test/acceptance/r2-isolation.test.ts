import {it,expect,beforeEach,afterAll} from 'vitest';
import {control} from '../helpers/auth';
import {assertIsolationCoverage,isolationOperations,isolationCells,recordIsolationEvidence,isolationEvidence,requiredIsolationEvidence,assertIsolationEvidence} from '../helpers/r2-isolation-matrix';
import {isolationHttpFixture,prepareIsolationOperation,changedTables,foreignText} from '../helpers/r2-isolation-http';
import {clientOperations} from '../../src/http/generated/client-operations';
import {validateError} from '../../src/http/generated/auth-validators.js';
const completed=new Set<string>();
beforeEach(async()=>{await control('reset');});
it('every frozen R2 operation has an explicit actor and capability case alongside reviewed R3 recovery reads',()=>{expect(()=>assertIsolationCoverage(isolationOperations)).not.toThrow();});
it('coverage rejects an omitted operation and an empty actor lane',()=>{expect(()=>assertIsolationCoverage(isolationOperations.filter(x=>x.operation!=='searchWorkspace'))).toThrow('missing searchWorkspace');expect(()=>assertIsolationCoverage(isolationOperations.map(x=>x.operation==='getWorkspace'?{...x,lanes:[]}:x))).toThrow('lane coverage');});
it('coverage rejects omitted executed phase and conditional gate receipts',()=>{for(const key of ['getTask/human/foreign-workspace','commitArtifact/native/missing-binding']){const receipts=new Set(requiredIsolationEvidence());receipts.delete(key);expect(()=>assertIsolationEvidence(receipts)).toThrow(key);}});
for(const cell of isolationCells())it(cell.operation+' / '+cell.lane+' / authorized and foreign workspace',async()=>{
 const f=await isolationHttpFixture(('isolation_'+cell.operation+'_'+cell.lane).toLowerCase()),prepared=await prepareIsolationOperation(f,cell.operation,cell.lane),operation=clientOperations[cell.operation];
 const beforeA=await f.snapshot(),beforeB=await f.snapshot('b');
 const foreign=f.make(cell.operation,cell.lane,prepared.input,'b','a');
 // Login start is intentionally public; exact source origin is the relevant workspace boundary.
 if(cell.lane==='public')foreign.headers.set('origin',f.a.origin);
 const denied=await f.http(foreign),deniedText=await denied.text();
 expect(denied.status,deniedText).toBe(cell.lane==='public'?403:401);const error=JSON.parse(deniedText);expect(validateError(error)).toBe(true);expect(Object.keys(error).sort()).toEqual(['error']);expect(error.error.code).toBe(cell.lane==='public'?'FORBIDDEN':'UNAUTHENTICATED');expect(error.error.details).toBeUndefined();expect(deniedText).not.toContain(foreignText);
 expect((await f.snapshot()).digest,'foreign request cannot affect original authority').toBe(beforeA.digest);expect((await f.snapshot('b')).digest,'foreign request cannot affect destination authority').toBe(beforeB.digest);
 const response=await f.send(cell.operation,cell.lane,prepared.input),bytes=new Uint8Array(await response.arrayBuffer()),text=new TextDecoder().decode(bytes);
 expect(response.status,text).toBe(operation.status);
 if(operation.download)prepared.assertData(bytes);else{const value=JSON.parse(text);expect(operation.validateResponse?.(value),text).toBe(true);prepared.assertData(value.data);expect(text).not.toContain(foreignText);}
 const afterA=await f.snapshot(),afterB=await f.snapshot('b'),changed=changedTables(beforeA,afterA);
 expect(afterB.digest,'authorized request cannot mutate other workspace').toBe(beforeB.digest);
 for(const table of prepared.effectTables)expect(changed,table+' must have an observed durable change').toContain(table);
 if(['startAuth','getAuthSession','logoutAuth','putProfile','putPreferences','previewProfile'].includes(cell.operation))expect(changed).not.toContain('scheduler_state');
 if(prepared.readOnly)expect(changed,'bounded first-page read may not mutate domain state').toEqual([]);
 if(operation.idempotency&&!prepared.readOnly)expect(afterA.tables.idempotency_outcomes.length-beforeA.tables.idempotency_outcomes.length).toBe(1);
 completed.add(cell.operation+'/'+cell.lane);for(const phase of ['authorized','foreign-workspace'])recordIsolationEvidence(cell.operation,cell.lane,phase);
},30_000);
afterAll(()=>{expect([...isolationEvidence].sort(),'executed phases include forbidden/unbound/unavailable cases, never skips').toEqual(requiredIsolationEvidence());expect([...completed].sort(),'every matrix cell actually completed both authorization phases').toEqual(isolationCells().map(x=>x.operation+'/'+x.lane).sort());});

import "../helpers/r2-isolation-publication";

import "../helpers/r2-isolation-native";
import "../helpers/r2-isolation-boundaries";

import "../helpers/r2-isolation-awaits";
