import http from 'node:http';
import fs from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const [directory,mode='drop']=process.argv.slice(2),path=join(directory,'server.json');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
let s=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):{session:'obs_'+'a'.repeat(48),epoch:1,high:0,batch:null,replacement:null,batches:0,replacements:0,requests:0,dropAppend:true,dropReplace:true,revoked:false,firstHeld:false};
function persist(){const tmp=join(directory,'server.tmp'),fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(s));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,path);const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
const timestamp='2026-11-01T00:00:00.000Z';
const server=http.createServer(async(req,res)=>{
 try{let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)throw Error('SIZE');chunks.push(chunk);}const body=bytes?JSON.parse(Buffer.concat(chunks).toString('utf8')):null;
 s.requests++;s.lastPath=req.url;persist();if(s.revoked){res.writeHead(401).end();return;}
 const status=()=>({kind:'current_owner_status',session_id:s.session,session_epoch:s.epoch,high_water:s.high,latest_batch_receipt:s.batch,latest_replacement_receipt:s.replacement});
 const reply=data=>{res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));};
 if(req.url.endsWith('/observations:establish')){reply({kind:'current_binding',session_id:s.session,session_epoch:s.epoch,run_id:body.run_id,fence:body.fence,established_at:timestamp,coverage:{configured_events:['read-observed','write-observed'],completeness:'unknown',reported_loss:s.replacements>0}});return;}
 if(req.url.endsWith('/owner-status')){if(!req.url.includes(s.session)){res.writeHead(403).end();return;}reply(status());return;}
 const append=req.url.endsWith('/records'),sessionId=append?req.url.split('/').at(-2):null;
 const fingerprint=createHash('sha256').update(canonical({method:'POST',path:req.url,sessionId,body})).digest('hex');
 if(append){
  if(mode==='hold'&&!s.firstHeld){s.firstHeld=true;persist();await new Promise(r=>setTimeout(r,700));}
  if(sessionId!==s.session){res.writeHead(403).end();return;}
  if(s.batch?.request_fingerprint===fingerprint){reply(s.batch);return;}
  if(body.first_sequence!==s.high+1){res.writeHead(409).end();return;}
  s.high+=body.records.length;s.batches++;s.batch={kind:'batch_receipt',session_id:s.session,first_sequence:body.first_sequence,last_sequence:s.high,record_count:body.records.length,accepted_at:timestamp,request_fingerprint:fingerprint};const drop=mode==='drop'&&s.dropAppend;s.dropAppend=false;persist();process.send?.({kind:'committed',operation:'append'});if(drop)res.destroy();else reply(s.batch);return;
 }
 if(req.url.endsWith('/observation-sessions:replace')){
  if(s.replacement?.request_fingerprint===fingerprint){reply(s.replacement);return;}
  if(body.expected_session_id!==s.session||body.expected_high_water!==s.high){res.writeHead(409).end();return;}
  const old=s.session;s.epoch++;s.session='obs_'+String(s.epoch).repeat(48);s.high=0;s.batch=null;s.replacements++;s.replacement={kind:'replacement_receipt',old_session_id:old,new_session_id:s.session,new_epoch:s.epoch,replacement_request_id:body.replacement_request_id,accepted_at:timestamp,request_fingerprint:fingerprint};const drop=s.dropReplace;s.dropReplace=false;persist();process.send?.({kind:'committed',operation:'replace'});if(drop)res.destroy();else reply(s.replacement);return;
 }
 res.writeHead(404).end();
 }catch{res.destroy();}
});
server.listen(0,'127.0.0.1',()=>process.send?.({kind:'ready',port:server.address().port}));
process.on('message',message=>{if(message?.kind==='revoke')s.revoked=true;else if(message?.kind==='append-later'){s.high++;s.batch={kind:'batch_receipt',session_id:s.session,first_sequence:s.high,last_sequence:s.high,record_count:1,accepted_at:timestamp,request_fingerprint:'f'.repeat(64)};}else if(message?.kind==='replace-again'||message?.kind==='config-reset'){s.epoch++;s.session='obs_'+String(s.epoch).repeat(48);s.high=0;s.batch=null;s.replacement=null;}else return;persist();process.send?.({kind:'controlled'});});
