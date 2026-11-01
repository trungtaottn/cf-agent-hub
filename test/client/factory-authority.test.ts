import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {HubClient} from '../../packages/client/src/client';
function fixture(client:any){
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../../src/ui/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const functions=source.statements.filter(s=>ts.isFunctionDeclaration(s)&&s.name&&['request','readTaskCommandAccess'].includes(s.name.text)).map(s=>s.getText(source));
 const declaration=source.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).find(d=>ts.isIdentifier(d.name)&&d.name.text==='readTaskProjection');
 expect(declaration).toBeDefined();expect(functions).toHaveLength(2);
 const code=ts.transpileModule([...functions,'const '+declaration!.getText(source)+';'].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
 const invalidations:number[]=[];
 const app=new Function('client','invalidations',`let authority=1,connectionGeneration=1,session={actor:{kind:'human',principal_id:'human_one',agent_id:null}},workspace='ws';const models={workspace:{refresh:async()=>{}}};const render=()=>{};const invalidateAll=(status)=>{invalidations.push(status);authority++;};${code};return {read:readTaskProjection,request,access:readTaskCommandAccess,advance(){authority++;},disconnect(){connectionGeneration++;}};`)(client,invalidations);
 return {app,invalidations};
}
const denial=(status:number)=>({ok:false,status,requestId:'denied',error:{code:status===401?'UNAUTHENTICATED':'FORBIDDEN',message:'Denied',retryable:false}});
it.each(['getArtifact','listEvents','getRun','listTaskResults'])('optional %s403 remains section local',async op=>{const f=fixture({read:vi.fn(async()=>denial(403))});expect(await f.app.read(op,{})).toMatchObject({status:403});expect(f.invalidations).toEqual([]);});
it('profile and global event403 are local while current workspace403 still invalidates',async()=>{const f=fixture({request:vi.fn(async()=>denial(403))});await f.app.request('getProfile',{});expect(f.invalidations).toEqual([]);await f.app.request('listEvents',{});expect(f.invalidations).toEqual([]);await f.app.request('getWorkspace',{});expect(f.invalidations).toEqual([403]);});
it.each(['read','request'])('current401 from %s remains global',async method=>{const f=fixture({[method]:vi.fn(async()=>denial(401))});await f.app[method](method==='read'?'getArtifact':'getProfile',{});expect(f.invalidations).toEqual([401]);});
it.each(['read','request'])('old %s denial cannot clear newer scope/connection',async method=>{for(const advance of ['advance','disconnect']){let release!:(v:any)=>void;const f=fixture({[method]:vi.fn(()=>new Promise(r=>{release=r;}))});const pending=f.app[method](method==='read'?'getArtifact':'getProfile',{});f.app[advance]();release(denial(401));expect(await pending).toMatchObject({ok:false});expect(f.invalidations).toEqual([]);}});
it('real client token clearing is repaired only by fresh auth plus workspace before existing command',async()=>{
 const sent:Headers[]=[];const client=new HubClient('ws',{fetch:async(_url,init)=>{sent.push(new Headers(init?.headers));return Response.json({error:{code:'FORBIDDEN',message:'Denied',retryable:false,request_id:'denied'}},{status:403});}});client.setCsrfToken('old');
 const f=fixture(client);await f.app.read('getArtifact',{path:{artifact_id:'artifact_one'}});expect(f.invalidations).toEqual([]);
 expect(await client.command('readyTask',{path:{task_id:'task_one'},body:{expected_version:1}},{idempotencyKey:'same-key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});
 const calls:string[]=[];vi.spyOn(client,'request').mockImplementation(async(op:any)=>{calls.push(op);return {ok:true,status:200,requestId:'fresh',data:op==='getAuthSession'?{actor:{kind:'human',principal_id:'human_one',agent_id:null},csrf_token:'fresh-server-token'}:{id:'ws',actor:{kind:'human',principal_id:'human_one',agent_id:null},effective_scopes:['tasks:schedule']}} as any;});
 expect(await f.app.access()).toMatchObject({ok:true});expect(calls).toEqual(['getAuthSession','getWorkspace']);await client.command('readyTask',{path:{task_id:'task_one'},body:{expected_version:1}},{idempotencyKey:'same-key'});expect(sent.at(-1)?.get('x-csrf-token')).toBe('fresh-server-token');
});
it.each(['listTasks','getTask'])('required %s403 remains fail closed globally',async op=>{const f=fixture({read:vi.fn(async()=>denial(403))});await f.app.read(op,{});expect(f.invalidations).toEqual([403]);});
it('fresh session identity mismatch cannot restore any command token',async()=>{const client={request:vi.fn(async()=>({ok:true,status:200,requestId:'different',data:{actor:{kind:'human',principal_id:'other',agent_id:null},csrf_token:'other-token'}})),setCsrfToken:vi.fn()};const f=fixture(client);expect(await f.app.access()).toMatchObject({ok:false});expect(f.invalidations).toEqual([401]);expect(client.setCsrfToken).not.toHaveBeenCalled();});
it('fresh workspace denial cannot restore a prior auth response token',async()=>{const client={request:vi.fn(async(op:string)=>op==='getAuthSession'?{ok:true,status:200,requestId:'fresh',data:{actor:{kind:'human',principal_id:'human_one',agent_id:null},csrf_token:'fresh-token'}}:denial(403)),setCsrfToken:vi.fn()};const f=fixture(client);expect(await f.app.access()).toMatchObject({ok:false});expect(f.invalidations).toEqual([403]);expect(client.setCsrfToken).not.toHaveBeenCalled();});
it('profile loss clears previously displayed global label and accent',()=>{
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../../src/ui/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);const fn=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='applyPresentation')!;const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
 const label={textContent:'Private department'},document={documentElement:{dataset:{accent:'teal'}}};new Function('models','document','byId','accents',code+';applyPresentation();')({profile:{state:{data:null}},preferences:{state:{data:null}}},document,()=>label,[]);expect(label.textContent).toBe('');expect(document.documentElement.dataset).not.toHaveProperty('accent');
});
