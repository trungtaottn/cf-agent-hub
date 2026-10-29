/** Source-only policy inventory. No filesystem access: R1 policy also runs in Workers tests. */
export const R2_FEATURES=Object.freeze(['F01','F02','F03','F04','F05','F06','F07','F08','F09','F10','F11','F12','F13','F14','F15','F16','F17','F18','F19','F20','F21','F22','F23','F24','F25','F26','F27','F28','F29','F30','F34','F40','F41']);
export const R2_ROLES=Object.freeze(['application-worker','operator-worker','anchor-provider','native-cli','operator-cli-source','ui-assets']);
export const R2_KINDS=Object.freeze(['generated','types','contract','node-tests','workers-tests','operator-tests','browser-tests','docs','dependency-audit','deployed-ingress','deployed-recovery','build','native-live']);
export const R2_LIVE_KINDS=Object.freeze(['browser-tests','dependency-audit','deployed-ingress','deployed-recovery','native-live']);
import composition from './r2-composition.json' with {type:'json'};
export const R2_COMPOSITION=Object.freeze(composition);
export const R2_CONFIG_PATHS=Object.freeze({'application-worker':'wrangler.jsonc','operator-worker':'workers/operator/wrangler.jsonc','anchor-provider':'workers/recovery-anchor/wrangler.jsonc','native-cli':'package.json','operator-cli-source':'package.json','ui-assets':'package.json'});
export function componentNames(role){
 if(role==='application-worker')return ['index.js',...R2_COMPOSITION.application_sql.map(x=>x.name)];
 if(role==='operator-worker'||role==='anchor-provider')return ['index.js'];
 if(role==='native-cli')return ['agenthub.mjs'];
 if(role==='operator-cli-source')return [...R2_COMPOSITION.operator_source_closure];
 if(role==='ui-assets')return ['ui/index.html','ui/app.js','ui/styles.css'];
 throw Error('UNKNOWN_COMPONENT_ROLE');
}
