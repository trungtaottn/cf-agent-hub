import {it,expect} from 'vitest';
import {matchesGlob} from 'node:path';
import {nodeInclude,nodeExclude,workersInclude,workersExclude,operatorInclude} from '../helpers/runtime-suites';
const owners=(path:string)=>[
 ['node',nodeInclude,nodeExclude],['workers',workersInclude,workersExclude],['operator',operatorInclude,[]]
].filter(([,include,exclude])=>(include as string[]).some(g=>matchesGlob(path,g))&&!(exclude as string[]).some(g=>matchesGlob(path,g))).map(([name])=>name);
it.each(['agents','runtimes','tasks','artifacts','search','imports'])('reserved_%s_domain_belongs_only_to_workers',domain=>{
 expect(owners(`test/${domain}/behavior.test.ts`)).toEqual(['workers']);
});
it.each(['test/acceptance/r2-isolation.test.ts','test/acceptance/r2-durable-work.test.ts','test/config/catalog-lifecycle.test.ts'])('reserved_sql_suite_has_exact_worker_ownership_%s',path=>expect(owners(path)).toEqual(['workers']));
it.each(['test/cli/commands.test.ts','test/acceptance/r2-release-evidence.test.ts','test/contracts/r2-shared-boundary.test.ts'])('node_ownership_%s',path=>expect(owners(path)).toEqual(['node']));
it('operator_and_future_live_suites_never_enter_ordinary_workers',()=>{
 expect(owners('test/recovery/r2-operator.test.ts')).toEqual(['operator']);
 expect(owners('test/acceptance/r2-native-conformance.test.ts')).toEqual([]);
 expect(owners('test/acceptance/r2-unknown.test.ts')).toEqual([]);
 expect(owners('test/cli/recover-workspace.test.mjs')).toEqual([]);
});
it('node_runner_uses_the_reviewed_ownership_matrix',async()=>{
 const {default:config}=await import('../../vitest.config');
 expect(config.test?.include).toEqual(nodeInclude);
 expect(config.test?.exclude).toEqual(expect.arrayContaining(nodeExclude));
});
