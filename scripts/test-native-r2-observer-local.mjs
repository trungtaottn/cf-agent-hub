/** Local fake-data observer/service integration; never native acceptance. */
import {runPrivateObserverLocalIntegration} from './lib/native-observer-local-host.mjs';
try{
 const report=await runPrivateObserverLocalIntegration();
 console.log(JSON.stringify(report));
 process.exitCode=report.status==='passed'?0:1;
}catch{
 console.log(JSON.stringify({type:'local-private-observer-result',version:1,status:'failed',installedAuthority:false,native_conformance:false,error:'LOCAL_OBSERVER_INTEGRATION_REJECTED'}));
 process.exitCode=1;
}
