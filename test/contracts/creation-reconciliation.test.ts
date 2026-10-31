import {it,expect} from 'vitest';
import spec from '../../spec/openapi.json';
import {clientOperations} from '../../src/http/generated/client-operations';
import * as validators from '../../src/http/generated/auth-validators.js';
it.each(['Message','Task'])('closed %s reconciliation is browser-only and uses original body',kind=>{
 const op='reconcile'+kind+'Creation',path='/v2/workspaces/{workspace_id}/'+kind.toLowerCase()+'s:reconcile';
 const route=(spec.paths as Record<string,any>)[path]?.post;
 expect(route,'explicit canonical reconciliation route').toBeDefined();
 expect(route['x-r1-available'],'R3 recovery must not claim R1 availability').toBe(false);
 expect(route.operationId).toBe(op);expect(route.security).toEqual([{HumanSession:[]}]);
 expect(route.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/'+kind+'CreateRequest');
 const contract=(clientOperations as Record<string,any>)[op];expect(contract.native).toBe(false);expect(contract.status).toBe(200);
 const validate=(validators as unknown as Record<string,(x:unknown)=>boolean>)['validate'+kind+'CreationReconciliation'];
 expect(validate).toBeTypeOf('function');expect(validate({status:'unknown'})).toBe(true);
 for(const invalid of [{status:'unknown',reason:'absent'},{status:'confirmed'},{status:'rejected'},{status:'confirmed',[kind.toLowerCase()]:{}}])expect(validate(invalid)).toBe(false);
});
