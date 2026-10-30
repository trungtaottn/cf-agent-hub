import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('fixed Worker entry owns service/controller identities and exposes no request-selected modules',()=>{
 const source=readFileSync(new URL('../../workers/native-fixture/complete-service.ts',import.meta.url),'utf8');
 assert.match(source,/class CompleteFixtureService extends DurableObject/);
 assert.match(source,/getByName\('required-fixture-controller'\)/);
 assert.match(source,/getByName\('complete-fixture-service'\)/);
 assert.match(source,/complete-service-run-claim/);
 assert.match(source,/createCompleteServiceAuthenticator/);
 assert.doesNotMatch(source,/unsafeEval|eval\(|new Function|import\(/);
});
