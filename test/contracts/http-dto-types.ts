import type {AuthLogoutRequest} from '../../src/http/dto';
const empty:AuthLogoutRequest={};
// @ts-expect-error closed empty JSON object rejects primitive
const number:AuthLogoutRequest=1;
// @ts-expect-error closed empty JSON object rejects string
const string:AuthLogoutRequest='token';
// @ts-expect-error closed empty JSON object rejects array
const array:AuthLogoutRequest=[];
// @ts-expect-error closed empty JSON object rejects nonempty object
const object:AuthLogoutRequest={unexpected:true};
void [empty,number,string,array,object];

import type {CommandDescriptor} from '../../src/workspace/commands';
type GuardContract=CommandDescriptor<{body:string},{id:string}>;
const synchronousAccess:GuardContract['checkAccess']=()=>{};
const synchronousReplay:GuardContract['checkReplay']=()=>{};
// @ts-expect-error authorization guard cannot be asynchronous
const asyncAccess:GuardContract['checkAccess']=async()=>{};
// @ts-expect-error replay visibility guard cannot be asynchronous
const asyncReplay:GuardContract['checkReplay']=async()=>{};
// @ts-expect-error explicit Promise result cannot satisfy a synchronous access guard
const promiseAccess:GuardContract['checkAccess']=()=>Promise.resolve();
// @ts-expect-error thenables cannot satisfy a synchronous replay guard
const thenableReplay:GuardContract['checkReplay']=()=>({then:()=>{}});
void [synchronousAccess,synchronousReplay,asyncAccess,asyncReplay,promiseAccess,thenableReplay];

import type {HttpDTOMap,Task,Run,Artifact,Agent,Credential,CredentialIssue,Runtime,RuntimeIssue,SearchHit,TaskCommandResult,ImportEnvelope} from '../../src/http/dto';
import type {NativeDTO} from '../../src/contracts/native';
import type {PageData} from '../../src/contracts/r2';
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Assert<T extends true>=T;
type NativeAliases=Assert<Equal<NativeDTO<'Task'|'Run'|'Artifact'|'Agent'|'Credential'|'CredentialIssue'|'Runtime'|'RuntimeIssue'|'SearchHit'|'TaskCommandResult'>,Task|Run|Artifact|Agent|Credential|CredentialIssue|Runtime|RuntimeIssue|SearchHit|TaskCommandResult>>;
type EveryNativeAlias=Assert<Equal<{[K in keyof HttpDTOMap]:NativeDTO<K>},HttpDTOMap>>;
type RawImportRows=Assert<Equal<ImportEnvelope['rows'],unknown[]>>;
// @ts-expect-error no generic unknown fallback for noncanonical DTO names
type MissingDTO=NativeDTO<'TaskMirror'>;
const page:PageData<Task>={items:[],next:null,hasMore:false};
// @ts-expect-error only HTTP produces encoded continuation
const encodedPage:PageData<Task>={items:[],next:'opaque',hasMore:true};
void [page,encodedPage];
