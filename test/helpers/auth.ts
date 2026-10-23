import { env } from 'cloudflare:workers';
import { fixture, operator } from './environment';
import { prepareBootstrap, canonicalJson, sha256 } from '../../src/config/bootstrap';
export const origin='https://hub.example.invalid',path='/v2/workspaces/ws_example/auth/';
export const control=async(endpoint:string,body?:unknown)=>fetch('https://fixture-control.example.invalid/'+endpoint,{method:body===undefined?'GET':'POST',body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
export async function installed(name:string,scopes?:string[]) {
 const input=await fixture(name);if(scopes)input.config.human_grants[0].scopes=scopes as typeof input.config.human_grants[0]['scopes'];
 input.bundle.config_digest=await sha256(canonicalJson(input.config));
 const config=await prepareBootstrap(input.config,input.bundle,'ws_example');
 const stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),config);return {stub,config};
}
export function request(route:string,method='GET',body?:unknown,cookie?:string,headers:Record<string,string>={}) {
 return new Request(origin+path+route,{method,redirect:'manual',headers:{...(method==='POST'?{origin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
}
export function cookie(response:Response,name='cfhub_login') {return response.headers.getSetCookie().find(x=>x.startsWith(name+'='))?.split(';')[0]??'';}
export async function start(stub:DurableObjectStub<import('../../src/index').WorkspaceDO>) {
 const response=await stub.fetch(request('start','POST',{return_path:'/overview'}));
 if(response.status!==200)throw Error('START_STATUS_'+response.status);
 const data=await response.json() as {data:{authorization_url:string}};return {...data.data,cookie:cookie(response),response};
}
export async function callback(stub:DurableObjectStub<import('../../src/index').WorkspaceDO>,attempt:Awaited<ReturnType<typeof start>>,mode='normal') {
 const issued=await (await control('issue',{authorization_url:attempt.authorization_url,mode,now:Date.now()})).json() as {code:string};
 const url=new URL(attempt.authorization_url);const route='callback?'+new URLSearchParams({state:url.searchParams.get('state')!,code:issued.code});
 return {response:await stub.fetch(request(route,'GET',undefined,attempt.cookie)),route};
}
export async function login(stub:DurableObjectStub<import('../../src/index').WorkspaceDO>,mode='normal') {
 const attempt=await start(stub),result=await callback(stub,attempt,mode);return {...result,attempt,cookie:cookie(result.response,'cfhub_session')};
}
