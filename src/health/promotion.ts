import type {Readiness} from '../http/dto';
import {validateReadinessResponse} from '../http/generated/auth-validators.js';
export interface CodeCompatibility {minimum_schema:number;maximum_schema:number;authority_contract:number;}
export interface LiveAuthority {schema_version:number;authority_contract:number;config_epoch:number;}
const required=['schema','configuration','authentication_keys','cursor_key','recovery_binding','admission','storage_probe','scheduler_probe','scheduler','delivery'] as const;
const positive=(value:number)=>Number.isSafeInteger(value)&&value>0;
const closed=(value:unknown,keys:readonly string[]):boolean=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
/** A redirect/challenge, false ready flag, unknown check, expired probe or
 * malformed envelope cannot be counted as operational readiness. */
export function readinessFromResponse(status:number,value:unknown,nowMs:number):Readiness{
 if(status!==200)throw Error('READINESS_HTTP_STATUS');
 if(!positive(nowMs)||!validateReadinessResponse(value))throw Error('READINESS_RESPONSE_INVALID');
 const data=value.data,names=data.checks.map(check=>check.name);
 if(!data.ready||names.length!==required.length+1||new Set(names).size!==names.length||!required.every(name=>names.includes(name))||!names.includes('r2_artifacts'))throw Error('READINESS_NOT_ESTABLISHED');
 const fresh=(time:string|null)=>{if(time===null)return false;const instant=Date.parse(time);return Number.isFinite(instant)&&instant<=nowMs&&nowMs-instant<=300000;};
 if(!fresh(data.observed_at))throw Error('READINESS_STALE');
 for(const name of required){
  const check=data.checks.find(item=>item.name===name)!;
  if(check.status!=='pass'||!fresh(check.checked_at)||(name==='storage_probe'||name==='scheduler_probe')&&check.code!=='PROBE_CONFIRMED')throw Error('READINESS_NOT_ESTABLISHED');
 }
 const artifacts=data.checks.find(check=>check.name==='r2_artifacts')!;
 if(artifacts.status!=='unknown'||artifacts.code!=='CAPABILITY_UNAVAILABLE_R1'||artifacts.checked_at!==null)throw Error('UNSUPPORTED_CAPABILITY_CLAIM');
 return data;
}
/** Code rollback cannot downgrade persisted schema or authority. An older
 * artifact must explicitly support the currently installed contracts. */
export function assertCompatibleRollback(code:CodeCompatibility,current:LiveAuthority,proposedEpoch:number):void{
 if(!closed(code,['minimum_schema','maximum_schema','authority_contract'])||!closed(current,['schema_version','authority_contract','config_epoch'])||
  ![code.minimum_schema,code.maximum_schema,code.authority_contract,current.schema_version,current.authority_contract,current.config_epoch,proposedEpoch].every(positive)||
  code.minimum_schema>code.maximum_schema||current.schema_version<code.minimum_schema||current.schema_version>code.maximum_schema||code.authority_contract!==current.authority_contract||proposedEpoch!==current.config_epoch)throw Error('ROLLBACK_INCOMPATIBLE');
}
export function assertDeployedBuild(reviewed:string,observed:string):void{
 if(!/^[a-f0-9]{64}$/.test(reviewed)||!/^[a-f0-9]{64}$/.test(observed)||reviewed!==observed)throw Error('DEPLOYED_BUILD_MISMATCH');
}
