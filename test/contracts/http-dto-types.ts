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
