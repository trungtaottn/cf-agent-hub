/** Private literal-SQL capture. Bounds are not authentication or semantic admission.
 * The source owner supplies actual storage and prepared scalar bindings. No public
 * SQL endpoint, caller-selected module, HTTP-derived membership or ActorContext.
 */
import frozenData from './complete-selectors.json';
type Scalar=string|number|null;
type Binding={W:string;C:string;human:string;principal:string;operation:string;target:string;key:string};
type Limits={queries:number;bridgeBytes:number;canonicalBytes:number};
type Descriptor={sql:string;parameters:string[];fields:{name:string;type:string}[];acceptedRows:number;bridgeRows:number;bridgeJsonBytes:number;fixtureCanonicalBytes:number};
type Vector={selectors:string[];phases:string[];privateSelectAdmissions:number;step_id?:string;id?:string};
export interface SelectedOriginal {selector:string;ordinal:number;canonical:string;byteSize:number;}
const catalog:Readonly<Record<string,Descriptor>>=frozenData.catalog;
const vectors:readonly Vector[]=[...frozenData.phaseVectors,...frozenData.externalVectors];
const TOTAL:Limits={queries:2555,bridgeBytes:180794824,canonicalBytes:7888422};
const encoder=new TextEncoder();
function reject():never {throw Error('COMPLETE_SELECTED_STATE_REJECTED');}
function requireValue(value:unknown):asserts value {if(!value)reject();}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 requireValue(value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
 const actual=Reflect.ownKeys(value);requireValue(actual.length===keys.length&&actual.every(k=>typeof k==='string'&&keys.includes(k)));
 const copy:Record<string,unknown>=Object.create(null);
 for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);requireValue(d&&d.enumerable&&Object.hasOwn(d,'value'));copy[k]=d.value;}return copy;
}
function descriptor(name:unknown):Descriptor {requireValue(typeof name==='string'&&Object.hasOwn(catalog,name));return catalog[name];}
function scalar(value:unknown,kind:string):Scalar {
 const nullable=kind.endsWith('?'),type=kind.replace(/\?$/,'');
 if(value===null){requireValue(nullable);return null;}
 if(type.startsWith('t')){const cap=Number(type.slice(1));requireValue(typeof value==='string'&&value.length<=cap&&encoder.encode(value).byteLength<=cap);return value;}
 requireValue(typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=(type==='n1'?1:0)&&value<=(type==='b'?1:type==='o'?4:Number.MAX_SAFE_INTEGER));return value;
}
/** Trusted SQLite returns plain rows. This rejects getters/custom shapes; it does
 * not claim transparent Proxy isolation in Worker JavaScript. */
export function decodeCompleteRows(name:unknown,value:unknown){
 const d=descriptor(name),guarded=name!=='Z';requireValue(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype);
 const length=Object.getOwnPropertyDescriptor(value,'length')?.value;requireValue(Number.isSafeInteger(length)&&length>=0&&length<=d.acceptedRows);
 const keys=Reflect.ownKeys(value);requireValue(keys.length===length+1&&keys.every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<length));
 const rows:Readonly<Record<string,Scalar>>[]=[],parts:string[]=[];let byteSize=2;
 const charge=(n:number)=>{byteSize+=n;requireValue(byteSize<=d.fixtureCanonicalBytes);};
 for(let i=0;i<length;i++){
  const item=Object.getOwnPropertyDescriptor(value,String(i));requireValue(item&&item.enumerable&&Object.hasOwn(item,'value'));
  const raw=closed(item.value,[...(guarded?['__valid']:[]),...d.fields.map(f=>f.name)]);if(guarded)requireValue(raw.__valid===1);
  const row:Record<string,Scalar>={};for(const f of d.fields)row[f.name]=scalar(raw[f.name],f.type);
  const fields:string[]=[];charge((i?1:0)+2);
  for(const [j,key]of Object.keys(row).sort().entries()){const k=JSON.stringify(key),v=JSON.stringify(row[key]);charge((j?1:0)+encoder.encode(k).byteLength+1+encoder.encode(v).byteLength);fields.push(k+':'+v);}
  rows.push(Object.freeze(row));parts.push('{'+fields.join(',')+'}');
 }
 if(name==='Z')requireValue(rows.length===4&&['preferences','outbox','catalog_plans','import_plans'].every((label,i)=>rows[i].table_name===label&&rows[i].present===0));
 return Object.freeze({rows:Object.freeze(rows),canonical:'['+parts.join(',')+']',byteSize});
}
function vector(stepId:unknown,phase:unknown):Vector {
 requireValue(typeof stepId==='string'&&typeof phase==='string');
 const v=vectors.find(v=>(v.step_id??v.id)===stepId);requireValue(v&&v.privateSelectAdmissions>0&&v.phases.includes(phase));return v;
}
function cost(v:Vector):Limits {
 const names=[...v.selectors,...(v.selectors.includes('IW')?Array<string>(28).fill('I'):[])];
 return {queries:names.length,bridgeBytes:names.reduce((n,k)=>n+catalog[k].bridgeJsonBytes,0),canonicalBytes:names.reduce((n,k)=>n+catalog[k].fixtureCanonicalBytes,0)};
}
export function completePhaseReservation(stepId:unknown,phase:unknown):Limits{return cost(vector(stepId,phase));}
function snapshotBindings(value:unknown):Readonly<Binding>{
 const v=closed(value,['W','C','human','principal','operation','target','key']);
 for(const k of ['W','C','human','principal'])requireValue(typeof v[k]==='string'&&v[k].length>0&&v[k].length<=96&&!/[^A-Za-z0-9_-]/.test(v[k]));
 requireValue(typeof v.operation==='string'&&v.operation.length<=32&&/^domain\.[A-Za-z][A-Za-z0-9]*$/.test(v.operation));
 requireValue(typeof v.target==='string'&&v.target.length>0&&v.target.length<=192&&!/[^A-Za-z0-9_/:.-]/.test(v.target));
 requireValue(typeof v.key==='string'&&/^r2_[a-f0-9]{32}$/.test(v.key));return Object.freeze(v) as Readonly<Binding>;
}
export function createCompleteSelectedState(storage:DurableObjectStorage,preparedBindings:unknown,lowerLimits:unknown=TOTAL){
 const binding=snapshotBindings(preparedBindings),rawLimits=closed(lowerLimits,['queries','bridgeBytes','canonicalBytes']),limits={...TOTAL};
 for(const k of Object.keys(TOTAL) as (keyof Limits)[]){const n=rawLimits[k];requireValue(typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=TOTAL[k]);limits[k]=n;}
 const reserved:Limits={queries:0,bridgeBytes:0,canonicalBytes:0},used=new Set<string>();let failed=false,closedReader=false,active=false,actualQueries=0,actualCanonicalBytes=0;
 const fail=():never=>{failed=true;return reject();};
 const healthy=()=>{if(failed||closedReader||active)fail();};
 function readPhase(request:unknown){
  let ownsActive=false;
  try{
   healthy();const r=closed(request,['stepId','phase']),v=vector(r.stepId,r.phase),key=String(r.stepId)+'\0'+String(r.phase);if(used.has(key))fail();
   const reservation=cost(v);for(const k of Object.keys(TOTAL) as (keyof Limits)[])if(reserved[k]+reservation[k]>limits[k])fail();
   // Atomic admission happens before any SQL. A later failure never refunds it.
   for(const k of Object.keys(TOTAL) as (keyof Limits)[])reserved[k]+=reservation[k];used.add(key);active=true;ownsActive=true;
   const originals:Readonly<SelectedOriginal>[]=[];let phaseQueries=0,phaseBytes=0;
   storage.transactionSync(()=>{
    function query(name:string,values:Readonly<Record<string,string>>){
     if(failed||closedReader||!active)fail();
     const d=descriptor(name);phaseQueries++;actualQueries++;if(phaseQueries>reservation.queries)fail();
     // Literal LIMIT/lookahead and guarded primitive projections bound the bridge
     // before SQLite allocates rows. No caller SQL or dynamic column selection.
     const cursor=storage.sql.exec(d.sql,...d.parameters.map(k=>{const value=values[k];if(typeof value!=='string')fail();return value;}));
     if(failed||closedReader||!active)fail();
     const rows:unknown[]=[];for(const row of cursor){if(failed||closedReader||!active||rows.length>=d.bridgeRows)fail();rows.push(row);}
     if(failed||closedReader||!active)fail();
     const result=decodeCompleteRows(name,rows);phaseBytes+=result.byteSize;actualCanonicalBytes+=result.byteSize;if(phaseBytes>reservation.canonicalBytes)fail();
     originals.push(Object.freeze({selector:name,ordinal:originals.length,canonical:result.canonical,byteSize:result.byteSize}));return result.rows;
    }
    for(const name of v.selectors){
     const rows=query(name,binding);
     if(name==='IW')for(const row of rows){
      // Tuple identities are discovered independently from the bounded SQL index,
      // never response-ID filters. The full28-query allowance was already spent.
      const tuple=snapshotBindings({...binding,principal:row.principal_id,operation:row.operation,target:row.target,key:row.key});
      const selected=query('I',tuple);if(selected.length!==1)fail();
      for(const k of ['principal_id','operation','target','key'] as const)if(selected[0][k]!==row[k])fail();
     }
    }
   });
   if(failed)fail();return Object.freeze({scope:'private-selected-state' as const,installedAuthority:false as const,stepId:r.stepId as string,phase:r.phase as string,originals:Object.freeze(originals)});
  }catch{failed=true;return reject();}finally{if(ownsActive)active=false;}
 }
 return Object.freeze({readPhase,snapshot:()=>Object.freeze({installedAuthority:false,failed,closed:closedReader,active,actualQueries,actualCanonicalBytes,reserved:Object.freeze({...reserved})}),close:()=>{if(active)fail();closedReader=true;}});
}
