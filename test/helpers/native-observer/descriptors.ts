/** Fixed private Worker-safe data/shape validation only. No authentication, SQL execution or crypto.
 * Inputs are actual private SQLite rows, not an adversarial object-execution boundary. */
import data from './descriptors.json' with {type:'json'};
type Primitive=string|number|null;
interface Field {name:string;type:string;}
interface Bound {rawScalarRowBytes:number;jsonRowBytes:number;rawScalarBytes:number;jsonArrayBytes:number;rows:number;}
export interface PreflightDescriptor {sql:string;sqlSha256:string;parameters:readonly string[];fields:readonly Readonly<Field>[];acceptedRows:number;canonicalBytes:number;bridge:Readonly<Bound>;paritySelector:string|null;}
export interface ProductDescriptor {sql:string;sqlSha256:string;fields:readonly Readonly<Field>[];parameters:readonly string[];bound:Readonly<Bound>;}
export interface ObservationLedger {authenticationCalls:number;finalCalls:number;preflightCalls:number;totalCalls:number;productCallCounts:Readonly<Record<string,number>>;productRawScalarBytes:number;productJsonArrayBytes:number;}
export interface ValidatedRows {rows:readonly Readonly<Record<string,Primitive>>[];canonical:string;byteSize:number;}
const fail=():never=>{throw Error('NATIVE_OBSERVER_ROWS_REJECTED');};
function requireValue(value:unknown):asserts value{if(!value)fail();}
function frozen<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
const source=frozen(data);
export const PREFLIGHT_ORDER=frozen(['S','F','M','C','AG','T','R','P'] as const);
export function getPreflightDescriptor(name:unknown):Readonly<PreflightDescriptor>{requireValue(typeof name==='string'&&Object.hasOwn(source.preflights,name));return source.preflights[name as keyof typeof source.preflights];}
export function getProductQueryDescriptor(id:unknown):Readonly<ProductDescriptor>{requireValue(typeof id==='number'&&Number.isInteger(id)&&id>=1&&id<=18);return source.productQueries[String(id) as keyof typeof source.productQueries];}
export function getObservationLedger(step:unknown):Readonly<ObservationLedger>{requireValue(typeof step==='string'&&step.startsWith('success/'));const name=step.slice(8);requireValue(Object.hasOwn(source.perObservationLedger,name));return source.perObservationLedger[name as keyof typeof source.perObservationLedger];}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{requireValue(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));const actual=Reflect.ownKeys(value);requireValue(actual.length===keys.length&&actual.every(k=>typeof k==='string'&&keys.includes(k)));const row:Record<string,unknown>=Object.create(null);for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);requireValue(d&&d.enumerable&&Object.hasOwn(d,'value'));row[k]=d.value;}return row;}
const encoder=new TextEncoder();
function utf8(value:string):number{return encoder.encode(value).byteLength;}
function scalar(value:unknown,kind:string):Primitive{const nullable=kind.endsWith('?'),type=kind.replace(/\?$/,'');if(value===null){requireValue(nullable);return null;}if(type[0]==='t'){const cap=Number(type.slice(1));requireValue(typeof value==='string'&&value.length<=cap&&utf8(value)<=cap);return value;}const min=type==='n1'?1:0,max=type==='b'?1:type==='o'?4:Number.MAX_SAFE_INTEGER;requireValue(typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max);return value;}
function validate(fields:readonly Readonly<Field>[],limit:number,cap:number,tag:boolean,value:unknown):Readonly<ValidatedRows>{
 requireValue(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype);
 const count:unknown=Object.getOwnPropertyDescriptor(value,'length')?.value;requireValue(typeof count==='number'&&Number.isSafeInteger(count)&&count<=limit);
 const keys=Reflect.ownKeys(value);requireValue(keys.length===count+1&&keys.every(k=>k==='length'||typeof k==='string'&&/^\d+$/.test(k)&&Number(k)<count&&String(Number(k))===k));
 const rows:Record<string,Primitive>[]=[],parts:string[]=[];let bytes=2;const charge=(n:number)=>{bytes+=n;requireValue(bytes<=cap);};
 for(let i=0;i<count;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));requireValue(d&&Object.hasOwn(d,'value')&&d.enumerable);const raw=closed(d.value,[...(tag?['__valid']:[]),...fields.map(f=>f.name)]);if(tag)requireValue(raw.__valid===1);const row:Record<string,Primitive>={};for(const f of fields)row[f.name]=scalar(raw[f.name],f.type);charge((i?1:0)+2);const entries:string[]=[];for(const [j,k]of Object.keys(row).sort().entries()){const name=JSON.stringify(k),v=JSON.stringify(row[k]);charge((j?1:0)+utf8(name)+1+utf8(v));entries.push(name+':'+v);}rows.push(row);parts.push('{'+entries.join(',')+'}');}
 return frozen({rows,canonical:'['+parts.join(',')+']',byteSize:bytes});
}
export function validatePreflightRows(name:unknown,rows:unknown):Readonly<ValidatedRows>{const d=getPreflightDescriptor(name);return validate(d.fields,d.acceptedRows,d.canonicalBytes,true,rows);}
export function validateProductRows(id:unknown,rows:unknown):Readonly<ValidatedRows>{const d=getProductQueryDescriptor(id);return validate(d.fields,d.bound.rows,d.bound.jsonArrayBytes,false,rows);}
