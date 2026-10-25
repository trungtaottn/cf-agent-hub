import {describe,expect,it} from 'vitest';
import {unstable_readConfig} from 'wrangler';

// Exercise Wrangler's resolved configurations: an undeclared named environment
// can otherwise retain the default operator binding while changing its name.
describe('isolated operator environments',()=>{
 it.each(['test','dev'])('%s operator binds the matching application authority',env=>{
  const app=unstable_readConfig({config:'wrangler.jsonc',env},{hideWarnings:true});
  const operator=unstable_readConfig({config:'workers/operator/wrangler.jsonc',env},{hideWarnings:true});
  expect(operator.durable_objects.bindings).toEqual([{name:'WORKSPACE',class_name:'WorkspaceDO',script_name:app.name}]);
  expect(operator.name).not.toBe(app.name);
  expect(operator.durable_objects.bindings[0]?.script_name).not.toBe('cf-agent-hub');
 });
 it.each(['test','dev'])('%s operator retains explicit authentication and closed public entry points',env=>{
  const operator=unstable_readConfig({config:'workers/operator/wrangler.jsonc',env},{hideWarnings:true});
  expect(operator.secrets?.required).toEqual(['OPERATOR_POLICY','BOOTSTRAP_INTEGRITY_KEY']);
  expect(operator.workers_dev).toBe(false);
  expect(operator.preview_urls).toBe(false);
  expect(operator.routes??[]).toEqual([]);
  expect(operator.route).toBeUndefined();
 });
});
