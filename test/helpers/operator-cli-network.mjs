// Test-process-only exact-host TLS routing. Never imported by deployed or CLI production modules.
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original=https.request;
https.request=(url,options,callback)=>{
 if(!(url instanceof URL)||url.href!=='https://operator.example.invalid/operator/recovery')throw Error('FIXTURE_EGRESS_DENIED');
 const port=Number(process.env.CFHUB_TEST_OPERATOR_PORT);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('FIXTURE_PORT');
 return original({hostname:'127.0.0.1',port,servername:'operator.example.invalid',ca:readFileSync(process.env.CFHUB_TEST_OPERATOR_CERT),rejectUnauthorized:true,
  path:'/operator/recovery',...options,agent:false,headers:{...options.headers,host:'operator.example.invalid'}},callback);
};
syncBuiltinESMExports();
