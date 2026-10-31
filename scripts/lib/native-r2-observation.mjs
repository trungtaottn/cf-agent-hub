const costKeys=['commands','mutations','artifact_bytes','output_bytes'];
const accounted=(usage,cost)=>usage&&Object.keys(usage).sort().join(',')===[...costKeys].sort().join(',')&&costKeys.every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0&&usage[key]<=cost[key]);
const OBSERVATION_BINDINGS=['stepId','invocationId','processExit','executableSha256','requestCount','httpStatus','configSha256','scenarioSha256','authorityRecordSha256','principalId','agentId','workspaceId','processRecordSha256'];
export function validateNativeObservation(value,expected,cost){
 const keys=[...OBSERVATION_BINDINGS,'secretCount','recordSha256','usage'];
 return Boolean(value&&Object.keys(value).sort().join(',')===keys.sort().join(',')&&OBSERVATION_BINDINGS.every(key=>value[key]===expected[key])&&value.secretCount===0&&typeof value.recordSha256==='string'&&/^[a-f0-9]{64}$/.test(value.recordSha256)&&accounted(value.usage,cost));
}
