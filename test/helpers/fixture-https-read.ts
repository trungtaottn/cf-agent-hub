import {request} from 'node:https';
import {createHash,X509Certificate} from 'node:crypto';
export interface FixtureReadTrust {port:number;certificate:string;pin:string;}
/** Only for the two task/results JSON GET interceptors. No redirects, cookie updates or content decoding. */
export async function readFixtureResponse(input:string,headers:Record<string,string>,trust:FixtureReadTrust):Promise<{status:number;headers:Record<string,string>;body:Buffer}> {
 const url=new URL(input),host='hub.fixture.example.invalid';
 if(url.origin!=='https://'+host||url.username||url.password||url.hash)throw Error('FIXTURE_ORIGIN_DENIED');
 const cert=new X509Certificate(trust.certificate);
 if(!Number.isInteger(trust.port)||trust.port<1||trust.port>65535||cert.ca||cert.checkHost(host)!==host||createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64')!==trust.pin)throw Error('FIXTURE_TRUST_INVALID');
 return new Promise((resolve,reject)=>{
  // Only headers relevant to these authenticated JSON GETs cross this fixture boundary.
  const forwarded:Record<string,string>={host,accept:'application/json','accept-encoding':'identity'};
  for(const [key,value]of Object.entries(headers))if(['cookie','accept','if-none-match'].includes(key.toLowerCase()))forwarded[key.toLowerCase()]=value;
  const outbound=request({hostname:'127.0.0.1',port:trust.port,servername:host,ca:trust.certificate,rejectUnauthorized:true,method:'GET',path:url.pathname+url.search,headers:forwarded,agent:false,timeout:10000},response=>{
   const status=response.statusCode??0,chunks:Buffer[]=[];let bytes=0;
   response.on('error',reject);
   if(status>=300&&status<400){response.destroy(Error('FIXTURE_REDIRECT_DENIED'));return;}
   if(response.headers['set-cookie']||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'||Object.values(response.headers).some(Array.isArray)){response.destroy(Error('FIXTURE_RESPONSE_UNSUPPORTED'));return;}
   response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024){response.destroy(Error('FIXTURE_RESPONSE_LIMIT'));return;}chunks.push(chunk);});
   response.on('end',()=>{
    const result:Record<string,string>={};
    for(const [key,value]of Object.entries(response.headers))if(typeof value==='string'&&!['transfer-encoding','connection','content-length'].includes(key))result[key]=value;
    resolve({status,headers:result,body:Buffer.concat(chunks)});
   });
  });
  outbound.on('error',reject);outbound.on('timeout',()=>outbound.destroy(Error('FIXTURE_READ_TIMEOUT')));outbound.end();
 });
}
