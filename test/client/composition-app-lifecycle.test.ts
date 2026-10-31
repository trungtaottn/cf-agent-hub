import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
/** Execute actual app function bodies with synthetic adapters; not browser/DOM evidence. */
function fixture(){
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../../src/ui/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const names=['verifyCompositionAuthority','taskComposeRequest','compositionRequest','request','openComposition','hideComposition'];
 const functions=source.statements.filter(s=>ts.isFunctionDeclaration(s)&&s.name&&names.includes(s.name.text)).map(s=>s.getText(source));
 const reads=source.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)&&d.name.text==='readCommandPreparation').map(d=>'const '+d.getText(source)+';'));
 const code=ts.transpileModule([...functions,...reads].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.None}}).outputText;
 const scopes=['tasks:create','tasks:read','messages:send','messages:read','agents:read'];
 const client={request:vi.fn(async(op:string)=>({ok:true,status:200,requestId:'r',data:op==='getAuthSession'?{actor:{kind:'human',principal_id:'human_one'},csrf_token:'synthetic'}:{id:'ws',actor:{principal_id:'human_one'},effective_scopes:scopes}})),read:vi.fn(),prepareCreation:vi.fn(),compose:vi.fn(),reconcileCreation:vi.fn(),setCsrfToken:vi.fn()};
 const invalidations:number[]=[],captured:{options?:any}={};
 const construct=new Function('client','invalidations','captured','scopes',`
 let authority=1,connectionGeneration=1,composeViewGeneration=1,session={actor:{kind:'human',principal_id:'human_one'}},workspace='ws';
 let messageComposition=null,messageForm=null,taskComposition=null,taskForm=null,lastTaskAdmission=null,composeScope=null;
 const compositionStorage={store:{}},models={workspace:{state:{status:'ready',data:{effective_scopes:scopes}}}};
 const compositionBinding=()=>({workspaceId:workspace,principalId:session.actor.principal_id,generation:connectionGeneration});
 const invalidateAll=(status)=>{invalidations.push(status);authority++;connectionGeneration++;};
 const byId=()=>({append(){}}),navigate=()=>{};
 class MessageComposition{constructor(options){captured.options=options;this.state={status:'ready'};}invalidate(){}async open(){}}
 class MessageForm{constructor(){this.element={hidden:true};this.body={focus(){}};}update(){}}
 ${code}
 return {verify:verifyCompositionAuthority,open:openComposition,switchForm(){composeViewGeneration++;connectionGeneration++;}};`);
 return {app:construct(client,invalidations,captured,scopes),client,invalidations,captured};
}
it('current task workspace403 invalidates authority, unlike optional picker denial',async()=>{const f=fixture();const original=f.client.request.getMockImplementation()!;f.client.request.mockImplementation(async op=>op==='getWorkspace'?{ok:false,status:403,error:{code:'FORBIDDEN',message:'denied',retryable:false},requestId:'denied'} as never:original(op));expect(await f.app.verify('task')).toBe(false);expect(f.invalidations).toEqual([403]);});
it('old message authority401 cannot invalidate a newer form after switching',async()=>{const f=fixture();let release!:(v:unknown)=>void;f.client.request.mockImplementation(()=>new Promise(r=>{release=r;}) as never);const pending=f.app.verify('message');f.app.switchForm();release({ok:false,status:401,error:{code:'UNAUTHENTICATED'},requestId:'old'});expect(await pending).toBe(false);expect(f.invalidations).toEqual([]);});
it.each(['prepare','send','reconcile','read'] as const)('old message %s denial cannot erase newer task-form authority',async operation=>{const f=fixture();await f.app.open();let release!:(v:unknown)=>void;const method={prepare:'prepareCreation',send:'compose',reconcile:'reconcileCreation',read:'read'}[operation] as 'prepareCreation';f.client[method].mockImplementation(()=>new Promise(r=>{release=r;}));const pending=f.captured.options[operation]('createMessage',{},{});f.app.switchForm();release({ok:false,status:401,error:{code:'UNAUTHENTICATED'},requestId:'old'});await pending;expect(f.invalidations).toEqual([]);});
