import { createServer as httpsServer, request as httpsRequest, type ServerOptions } from 'node:https';
import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, createLocalJWKSet } from 'jose';

export const APP_ORIGIN='https://hub.fixture.example.invalid';
export const ISSUER_ORIGIN='https://issuer.fixture.example.invalid';
const APP_HOST=new URL(APP_ORIGIN).hostname,ISSUER_HOST=new URL(ISSUER_ORIGIN).hostname;
const execute=promisify(execFile);
type Server=ReturnType<typeof httpServer>|ReturnType<typeof httpsServer>;
type Listener=(request:IncomingMessage,response:ServerResponse)=>void;
interface Certificate {key:Buffer;cert:Buffer;pin:string;}
export interface FixtureWorker {fetch(input:Request|string,init?:RequestInit):Promise<Response>;}
export interface HttpsFixture {
 proxyPort:number;negativeProxyPort:number;appPort:number;appCertificate:string;pins:[string,string];
 dispatch:typeof fetch; discovery:Record<string,unknown>;
 selfCheck(transport?:typeof fetch):Promise<void>;selfCheckApp(path?:string):Promise<void>;close():Promise<void>;
}
async function certificate(directory:string,label:string,hostname:string):Promise<Certificate> {
 const keyPath=join(directory,label+'.key'),certPath=join(directory,label+'.crt');
 await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+hostname,
  '-addext','subjectAltName=DNS:'+hostname,'-addext','basicConstraints=critical,CA:FALSE','-addext','keyUsage=critical,digitalSignature,keyEncipherment','-addext','extendedKeyUsage=serverAuth','-keyout',keyPath,'-out',certPath],{maxBuffer:65536});
 await chmod(keyPath,0o600);
 const key=await readFile(keyPath),cert=await readFile(certPath);
 const certificate=new X509Certificate(cert);if(certificate.ca)throw Error('FIXTURE_CERTIFICATE_IS_CA');
 const spki=certificate.publicKey.export({type:'spki',format:'der'});
 return {key,cert,pin:createHash('sha256').update(spki).digest('base64')};
}
async function body(request:IncomingMessage,limit=65536):Promise<Buffer> {
 const chunks:Buffer[]=[];let total=0;
 for await(const chunk of request){total+=chunk.length;if(total>limit)throw Error('BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
function json(response:ServerResponse,status:number,value:unknown) {
 response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));
}
function formEncode(value:string):string{return new URLSearchParams({x:value}).toString().slice(2);}
function constantEqual(a:string,b:string) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function startHttpsFixture(worker:FixtureWorker,options:{clientSecret?:string;subjects?:readonly string[]}={}):Promise<HttpsFixture> {
 const directory=await mkdtemp(join(tmpdir(),'cfhub-https-'));await chmod(directory,0o700);
 const servers:Server[]=[],sockets=new Set<Socket>();let closed=false;
 const close=async()=>{if(closed)return;closed=true;for(const socket of sockets)socket.destroy();await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));await rm(directory,{recursive:true,force:true});};
 try {
  const app=await certificate(directory,'app',APP_HOST),issuer=await certificate(directory,'issuer',ISSUER_HOST),negative=await certificate(directory,'negative',APP_HOST);
  const listen=async(server:Server)=>{servers.push(server);server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});server.requestTimeout=10000;server.headersTimeout=10000;await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});return (server.address() as {port:number}).port;};
  const {privateKey,publicKey}=await generateKeyPair('RS256',{modulusLength:2048,extractable:true});
  const jwk={...await exportJWK(publicKey),kid:'fixture-rsa',alg:'RS256',use:'sig'};
  const clientId='cfhub-client',clientSecret=options.clientSecret??randomBytes(32).toString('base64url');
  const redirectUri=APP_ORIGIN+'/v2/workspaces/ws_example/auth/callback';
  const discovery={
   issuer:ISSUER_ORIGIN,authorization_endpoint:ISSUER_ORIGIN+'/authorize',token_endpoint:ISSUER_ORIGIN+'/token',jwks_uri:ISSUER_ORIGIN+'/jwks',
   response_types_supported:['code'],response_modes_supported:['query'],grant_types_supported:['authorization_code'],
   subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],
   token_endpoint_auth_methods_supported:['client_secret_basic'],code_challenge_methods_supported:['S256']
  };
  const codes=new Map<string,{nonce:string;challenge:string;createdAt:number;subject:string}>();
  const basic='Basic '+Buffer.from(formEncode(clientId)+':'+formEncode(clientSecret)).toString('base64');
  const providerHandler:Listener=(request,response)=>{void(async()=>{
   if(request.headers.host!==ISSUER_HOST&&request.headers.host!==ISSUER_HOST+':443')return json(response,421,{error:'authority'});
   const url=new URL(request.url??'/',ISSUER_ORIGIN);
   if(request.method==='GET'&&url.pathname==='/.well-known/openid-configuration'&&!url.search)return json(response,200,discovery);
   if(request.method==='GET'&&url.pathname==='/jwks'&&!url.search)return json(response,200,{keys:[jwk]});
   if(request.method==='GET'&&url.pathname==='/authorize') {
    const p=url.searchParams;
    const keys=['client_id','redirect_uri','response_type','response_mode','scope','state','nonce','code_challenge','code_challenge_method'];
    if([...p.keys()].some(k=>!keys.includes(k))||keys.some(k=>p.getAll(k).length!==1)||p.get('client_id')!==clientId||p.get('redirect_uri')!==redirectUri||
     p.get('response_type')!=='code'||p.get('response_mode')!=='query'||p.get('scope')!=='openid'||p.get('code_challenge_method')!=='S256'||
     !/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge')??'')||!p.get('state')||!p.get('nonce'))return json(response,400,{error:'invalid_request'});
    if(codes.size>=1000)return json(response,429,{error:'fixture_capacity'});
    const chosen=/\bcfhub_fixture_subject=([^;]+)/.exec(request.headers.cookie??'')?.[1];
    const subject=chosen&&(options.subjects??[]).includes(chosen)?chosen:'synthetic-subject';
    const code=randomBytes(32).toString('base64url');codes.set(code,{nonce:p.get('nonce')!,challenge:p.get('code_challenge')!,createdAt:Date.now(),subject});
    const target=new URL(redirectUri);target.searchParams.set('code',code);target.searchParams.set('state',p.get('state')!);
    response.writeHead(302,{location:target.href,'cache-control':'no-store'});response.end();return;
   }
   if(request.method==='POST'&&url.pathname==='/token'&&!url.search) {
    if(!constantEqual(request.headers.authorization??'',basic))return json(response,401,{error:'invalid_client'});
    if(!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))return json(response,400,{error:'invalid_request'});
    const p=new URLSearchParams((await body(request)).toString('utf8')),code=p.get('code')??'',record=codes.get(code);
    const allowed=['grant_type','code','redirect_uri','code_verifier'];
    if([...p.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>p.getAll(k).length!==1)||p.get('grant_type')!=='authorization_code'||p.get('redirect_uri')!==redirectUri||
     !record||Date.now()-record.createdAt>=300000||createHash('sha256').update(p.get('code_verifier')??'').digest('base64url')!==record.challenge)return json(response,400,{error:'invalid_grant'});
    codes.delete(code);
    const now=Math.floor(Date.now()/1000);
    const token=await new SignJWT({nonce:record.nonce}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(ISSUER_ORIGIN).setSubject(record.subject).setAudience(clientId).setIssuedAt(now).setExpirationTime(now+300).sign(privateKey);
    return json(response,200,{access_token:randomBytes(32).toString('base64url'),token_type:'Bearer',expires_in:300,id_token:token});
   }
   return json(response,404,{error:'not_found'});
  })().catch(()=>{if(!response.headersSent)json(response,500,{error:'fixture_failure'});else response.destroy();});};
  const issuerPort=await listen(httpsServer({key:issuer.key,cert:issuer.cert},providerHandler));
  const appPort=await listen(httpsServer({key:app.key,cert:app.cert},(request,response)=>{void(async()=>{
   if(request.headers.host!==APP_HOST&&request.headers.host!==APP_HOST+':443')return json(response,421,{error:'authority'});
   const headers=new Headers();for(const [key,value]of Object.entries(request.headers))if(value!==undefined&&!['host','connection','transfer-encoding'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
   const bytes=['GET','HEAD'].includes(request.method??'GET')?undefined:await body(request);
   const upstream=await worker.fetch(APP_ORIGIN+(request.url??'/'),{method:request.method,redirect:'manual',headers,body:bytes?Uint8Array.from(bytes).buffer:undefined});
   response.statusCode=upstream.status;
   upstream.headers.forEach((value,key)=>{if(key!=='set-cookie')response.setHeader(key,value);});
   const cookies=upstream.headers.getSetCookie();if(cookies.length)response.setHeader('set-cookie',cookies);
   response.end(Buffer.from(await upstream.arrayBuffer()));
  })().catch(error=>{if(error instanceof Error&&error.message==='FIXTURE_DROP_COMMITTED_RESPONSE'){response.destroy();return;}if(!response.headersSent)json(response,502,{error:'fixture_worker_failure'});else response.destroy();});}));
  const negativePort=await listen(httpsServer({key:negative.key,cert:negative.cert},(_request,response)=>{response.end('invalid unpinned fixture certificate');}));
  const proxy=async(appTarget:number)=>{
   const server=httpServer((_request,response)=>{response.writeHead(403);response.end();});
   const targets=new Map([[APP_HOST+':443',appTarget],[ISSUER_HOST+':443',issuerPort]]);
   server.on('connect',(request,client,head)=>{
    const port=targets.get(request.url??'');
    if(!port){client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    const upstream=connect({host:'127.0.0.1',port});
    sockets.add(upstream);upstream.on('close',()=>sockets.delete(upstream));upstream.setTimeout(10000,()=>upstream.destroy());
    upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
    upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
   });
   return listen(server);
  };
  const proxyPort=await proxy(appPort),negativeProxyPort=await proxy(negativePort);
  const relay=async(request:Request):Promise<Response>=>{
   const payload=request.body?Buffer.from(await request.arrayBuffer()):undefined;
   if(payload&&payload.byteLength>65536)throw Error('FIXTURE_BODY_LIMIT');
   return new Promise((resolve,reject)=>{
    const headers=Object.fromEntries(request.headers);headers.host=ISSUER_HOST;
    const outbound=httpsRequest({hostname:'127.0.0.1',port:issuerPort,servername:ISSUER_HOST,ca:issuer.cert,rejectUnauthorized:true,
     path:new URL(request.url).pathname,method:request.method,headers,agent:false,timeout:10000},response=>{
      const chunks:Buffer[]=[];let count=0;
      response.on('data',chunk=>{count+=chunk.length;if(count>65536){response.destroy(Error('FIXTURE_RESPONSE_LIMIT'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>{const responseHeaders=new Headers();for(const [key,value]of Object.entries(response.headers))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])responseHeaders.append(key,item);resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:responseHeaders}));});
     });
    outbound.on('timeout',()=>outbound.destroy(Error('FIXTURE_TIMEOUT')));outbound.on('error',reject);
    if(payload)outbound.write(payload);outbound.end();
   });
  };
  const allowed=new Map([[ISSUER_ORIGIN+'/.well-known/openid-configuration','GET'],[ISSUER_ORIGIN+'/jwks','GET'],[ISSUER_ORIGIN+'/token','POST']]);
  const deniedUrls=new Set<string>();
  const dispatch:typeof fetch=async(input,init)=>{
   const request=new Request(input,init);
   if(allowed.get(request.url)!==request.method){deniedUrls.add(request.url);throw Error('FIXTURE_EGRESS_DENIED');}
   return relay(request);
  };
  return {proxyPort,negativeProxyPort,appPort,appCertificate:app.cert.toString('utf8'),pins:[app.pin,issuer.pin],dispatch,discovery,close,
   async selfCheckApp(path='/v2/workspaces/ws_example/auth/start'){
    const mutation=path.startsWith('/v2/');
    const result=await new Promise<{status:number;code:string|null}>((resolve,reject)=>{
     const request=httpsRequest({hostname:'127.0.0.1',port:appPort,servername:APP_HOST,ca:app.cert,rejectUnauthorized:true,
      path,method:mutation?'POST':'GET',headers:{host:APP_HOST,origin:APP_ORIGIN,'content-type':'application/json'},agent:false,timeout:10000},response=>{
      const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(Buffer.from(chunk)));response.on('error',reject);
      response.on('end',()=>{let code:string|null=null;try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));const value=parsed.error?.code??parsed.error;if(typeof value==='string'&&/^[a-zA-Z0-9_]{1,64}$/.test(value))code=value;}catch{}resolve({status:response.statusCode??0,code});});
     });
     request.on('timeout',()=>request.destroy(Error('FIXTURE_APP_TIMEOUT')));request.on('error',reject);
     request.end(mutation?JSON.stringify({return_path:'/overview'}):undefined);
    });
    if(result.status!==200)throw Error('FIXTURE_HTTPS_AUTH_FAILED_'+result.status+'_'+result.code);
   },
   async selfCheck(transport:typeof fetch=dispatch) {
    const actual=await (await transport(ISSUER_ORIGIN+'/.well-known/openid-configuration')).json();
    if(JSON.stringify(actual)!==JSON.stringify(discovery))throw Error('DISCOVERY_NOT_READY');
    const jwks=await (await transport(ISSUER_ORIGIN+'/jwks')).json() as {keys:typeof jwk[]};
    const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),nonce='fixture_nonce';
    const url=new URL(ISSUER_ORIGIN+'/authorize');
    for(const [key,value]of Object.entries({client_id:clientId,redirect_uri:redirectUri,response_type:'code',response_mode:'query',scope:'openid',state:'fixture_state',nonce,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(key,value);
    // relay normally forbids browser authorization. This private self-check retains exact TLS/SNI.
    const authorization=await new Promise<Response>((resolve,reject)=>{
     const req=httpsRequest({hostname:'127.0.0.1',port:issuerPort,servername:ISSUER_HOST,ca:issuer.cert,rejectUnauthorized:true,path:url.pathname+url.search,headers:{host:ISSUER_HOST},agent:false},response=>{response.resume();resolve(new Response(null,{status:response.statusCode,headers:{location:response.headers.location??''}}));});req.on('error',reject);req.end();
    });
    if(authorization.status!==302)throw Error('AUTHORIZATION_FIXTURE_FAILED');
    const code=new URL(authorization.headers.get('location')!).searchParams.get('code')!;
    const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:verifier});
    const denied=await transport(ISSUER_ORIGIN+'/token',{method:'POST',headers:{authorization:'Basic invalid','content-type':'application/x-www-form-urlencoded'},body:form});
    if(denied.status!==401)throw Error('BASIC_AUTH_NOT_ENFORCED');
    const request={method:'POST',headers:{authorization:basic,'content-type':'application/x-www-form-urlencoded'},body:form};
    const tokens=await (await transport(ISSUER_ORIGIN+'/token',request)).json() as {id_token:string};
    const verified=await jwtVerify(tokens.id_token,createLocalJWKSet(jwks),{issuer:ISSUER_ORIGIN,audience:clientId,algorithms:['RS256'],clockTolerance:0});
    if(verified.payload.nonce!==nonce||typeof verified.payload.iat!=='number'||typeof verified.payload.exp!=='number')throw Error('SIGNED_PROVIDER_NOT_READY');
    if((await transport(ISSUER_ORIGIN+'/token',request)).status!==400)throw Error('CODE_REPLAY_NOT_REJECTED');
    for(const url of [ISSUER_ORIGIN+'/other',ISSUER_ORIGIN+'/jwks?redirect=1','https://unknown.example.invalid/jwks']) {
     try{await transport(url);}catch{/* Direct dispatcher throws; harness converts outbound failures to 500. */}
     if(!deniedUrls.has(url))throw Error('EGRESS_NOT_CLOSED');
    }
   }
  };
 }catch(error){await close();throw error;}
}
