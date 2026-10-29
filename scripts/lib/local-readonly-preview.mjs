/** Development-only loopback viewer. No credential import, arbitrary proxy or product policy changes. */
import {createServer} from 'node:http';
const BASE='/v2/workspaces/ws_example',ID='[A-Za-z0-9_-]{1,128}',MAX=2097152;
const pages=new Set(['/','/overview','/activity','/inbox','/settings','/tasks']);
function allowed(raw){
 if(typeof raw!=='string'||raw.length>4096||!raw.startsWith('/')||raw.startsWith('//')||/[\\\x00-\x20\x7f]/.test(raw))return false;
 const [path]=raw.split('?');if(path.includes('%')||path.includes('..'))return false;
 const url=new URL(raw,'http://127.0.0.1');let keys;
 if(pages.has(path))keys=path==='/tasks'?['workspace','task']:['workspace'];
 else if(['/ui/app.js','/ui/styles.css'].includes(path))keys=[];
 else if(path===BASE||new RegExp('^'+BASE+'/(auth/session|configuration|profile|preferences|operations)$').test(path))keys=[];
 else if(path===BASE+'/tasks')keys=['cursor','limit','state','project_id'];
 else if(path===BASE+'/artifacts')keys=['cursor','limit','task_id'];
 else if(path===BASE+'/events')keys=['cursor','limit','after_sequence'];
 else if(path===BASE+'/inbox')keys=['cursor','limit','acknowledged'];
 else if(path===BASE+'/agents'||new RegExp('^'+BASE+'/threads/'+ID+'$').test(path)||new RegExp('^'+BASE+'/tasks/'+ID+'/results$').test(path))keys=['cursor','limit'];
 else if(new RegExp('^'+BASE+'/(tasks|runs|agents|artifacts)/'+ID+'$').test(path))keys=[];
 else return false;
 const seen=new Set();for(const [k,v]of url.searchParams){if(!keys.includes(k)||seen.has(k)||v.length>2048||/[\x00-\x1f\x7f]/.test(v))return false;seen.add(k);if(k==='task'&&!new RegExp('^'+ID+'$').test(v)||k==='workspace'&&v!=='ws_example'||k==='limit'&&(!/^\d{1,2}$/.test(v)||+v<1||+v>20))return false;}
 return true;
}
const banner='<aside role="status" aria-label="Local sandbox boundary"><strong>SYNTHETIC LOCAL PREVIEW — READ ONLY.</strong> Real local Worker data; no production login or acceptance claim. Changes are disabled.</aside>';
export async function startReadOnlyPreview({read}){
 if(typeof read!=='function')throw Error('PREVIEW_REJECTED');let origin='',active=0,closed=false;const sockets=new Set(),controllers=new Set();
 const reply=(r,status,text)=>{r.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});r.end(text);};
 const server=createServer(async(req,res)=>{
  if(closed||req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return reply(res,403,'Local preview origin rejected.');
  if(!['GET','HEAD'].includes(req.method)||!allowed(req.url)||req.headers['transfer-encoding']!==undefined||req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')return reply(res,405,'Read-only preview route unavailable.');
  if(active>=8)return reply(res,503,'Preview busy.');active++;const controller=new AbortController();controllers.add(controller);let timer,reader;
  const cancel=()=>{if(reader)void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  try{
   const operation=async()=>{const response=await read(req.url,{signal:controller.signal});if(controller.signal.aborted){await response?.body?.cancel();throw Error();}if(!(response instanceof Response))throw Error();if(response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>{});throw Error();}
    const chunks=[];let total=0;reader=response.body?.getReader();if(reader)for(;;){controller.signal.throwIfAborted();const {done,value}=await reader.read();controller.signal.throwIfAborted();if(done)break;if(!value.byteLength)throw Error();total+=value.byteLength;if(total>MAX){await reader.cancel();throw Error();}chunks.push(Buffer.from(value));}
    let bytes=Buffer.concat(chunks),type=response.headers.get('content-type')??'application/octet-stream';
    if(pages.has(req.url.split('?')[0])){if(!type.startsWith('text/html'))throw Error();const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!/<body(?:\s[^>]*)?>/.test(html))throw Error();bytes=Buffer.from(html.replace(/<body(?:\s[^>]*)?>/,x=>x+banner));if(bytes.length>MAX)throw Error();}
    return {status:response.status,bytes,type};};
   const work=operation().finally(()=>{cancel();controllers.delete(controller);active--;});
   const result=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},5000);})]);
   if(res.destroyed)return;res.writeHead(result.status,{'content-type':result.type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'referrer-policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:result.bytes);
  }catch{controller.abort();if(!res.destroyed&&!res.headersSent)reply(res,502,'Local preview read unavailable.');}
  finally{clearTimeout(timer);}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=32;server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return Object.freeze({origin,async close(){if(closed)return;closed=true;for(const c of controllers)c.abort();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}});
}
