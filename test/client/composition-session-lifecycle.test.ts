import {afterEach,expect,it,vi} from 'vitest';
import {DraftStore} from '../../src/ui/compose/draft-store';
import {MemoryComposeDatabase} from '../helpers/compose-memory';

/** Structural DOM only: real app boot/session/logout orchestration, not browser/layout evidence. */
class Element {
 children=Object.assign([] as Element[],{item:(index:number):Element|null=>this.children[index]??null});
 attributes=new Map<string,string>();listeners=new Map<string,Array<()=>unknown>>();dataset:Record<string,string>={};
 textContent='';hidden=false;disabled=false;parent:Element|null=null;
 classList={add(..._values:string[]){}};
 constructor(readonly tagName:string){}
 setAttribute(name:string,value:string){this.attributes.set(name,value);}
 getAttribute(name:string){return this.attributes.get(name)??null;}
 removeAttribute(name:string){this.attributes.delete(name);}
 append(...nodes:Element[]){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
 replaceChildren(...nodes:Element[]){for(const child of this.children)child.parent=null;this.children.splice(0);this.append(...nodes);}
 insertBefore(node:Element,before:Element|null){node.remove();node.parent=this;const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,node);}
 remove(){if(this.parent){const i=this.parent.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1);this.parent=null;}}
 addEventListener(name:string,listener:()=>unknown){this.listeners.set(name,[...(this.listeners.get(name)??[]),listener]);}
 async click(){for(const listener of this.listeners.get('click')??[])await listener();}
 focus(){}
}
const scope={workspaceId:'ws_example',principalId:'human_operator'};
const other={workspaceId:'ws_example',principalId:'other_human'};
const draft={body:'Private persisted text',recipient_agent_ids:['agent_one'],refs:[],artifact_ids:[]};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});
async function bootUnopened(failErase=false){
 vi.resetModules();const database=new MemoryComposeDatabase(),store=new DraftStore(database);
 const binding=await store.bind(scope),otherBinding=await store.bind(other);
 await store.save(binding,'message-compose','createMessage',draft);
 await store.save(otherBinding,'message-compose','createMessage',{...draft,body:'Other principal text'});
 const posted:unknown[]=[],nodes=new Map<string,Element>();
 for(const id of ['view','session','navigation','notice','main','workspace-name','workspace-identity','page-status','read-actions'])nodes.set(id,new Element('DIV'));
 const heading=new Element('H1'),body=new Element('BODY');body.dataset.workspace=scope.workspaceId;
 const descendants=(node:Element):Element[]=>[node,...node.children.flatMap(descendants)];
 vi.stubGlobal('document',{body,documentElement:new Element('HTML'),activeElement:null,createElement:(tag:string)=>new Element(tag.toUpperCase()),getElementById:(id:string)=>nodes.get(id)??[...nodes.values()].flatMap(descendants).find(n=>n.getAttribute('id')===id)??null,querySelector:()=>heading});
 vi.stubGlobal('location',{pathname:'/overview',origin:'https://hub.example.invalid',href:'https://hub.example.invalid/overview?workspace=ws_example'});
 vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('addEventListener',vi.fn());vi.stubGlobal('setInterval',vi.fn());
 vi.stubGlobal('BroadcastChannel',class {postMessage(value:unknown){posted.push(value);}addEventListener(){}});
 vi.doMock('../../src/ui/compose/draft-store',async()=>{const actual=await vi.importActual<typeof import('../../src/ui/compose/draft-store')>('../../src/ui/compose/draft-store');return {...actual,IndexedComposeDatabase:class {transact=database.transact.bind(database);async close(){}}};});
 const request=vi.fn(async(operation:string)=>{
  const data=operation==='getAuthSession'?{actor:{kind:'human',principal_id:scope.principalId,agent_id:null},csrf_token:'synthetic_csrf',expires_at:'2030-01-01T00:00:00Z'}:operation==='getConfiguration'?{profile_revision:1,config_epoch:1,enabled_features:[]}:operation==='getWorkspace'?{id:scope.workspaceId,actor:{kind:'human',principal_id:scope.principalId,agent_id:null},effective_scopes:['workspace:read','messages:send','messages:read','agents:read']}:operation==='logoutAuth'?{}:null;
  if(data===null)throw Error('Unexpected fixture operation '+operation);return {ok:true,status:200,data,requestId:'fixture_request'};
 });
 vi.doMock('../../packages/client/src/client',()=>({HubClient:class {request=request;setCsrfToken(){}}}));
 // Unrelated views are not under test; retain actual ReadModel, TaskReads and TaskActions.
 vi.doMock('../../src/ui/settings',()=>({SettingsPanel:class {element=new Element('SECTION');invalidate(){}}}));
 vi.doMock('../../src/ui/task-action-view',()=>({TaskActionPanel:class {element=new Element('SECTION');navigation(){}update(){}}}));
 // App is typechecked in tsconfig.ui.json, not the worker-ambient root profile.
 const entry='../../src/ui/app';await import(entry);
 await vi.waitFor(()=>expect(request.mock.calls.some(([operation])=>operation==='getWorkspace')).toBe(true));
 const signout=nodes.get('session')!.children.find(n=>n.tagName==='BUTTON'&&n.textContent==='Sign out');expect(signout).toBeDefined();
 // Do not activate New message: this is a fresh document after persisted drafts were saved.
 if(failErase)database.failNext=true;
 await signout!.click();
 return {database,store,binding,otherBinding,posted,nodes};
}
it('logout after authenticated boot without opening a composer erases only the verified principal scope',async()=>{
 const f=await bootUnopened();
 await vi.waitFor(()=>expect((f.database.inspect(scope) as {entries:unknown}).entries).toEqual({}));
 expect((await f.store.load(f.otherBinding,'message-compose'))?.draft?.bodyJson).toContain('Other principal text');
 await expect(f.store.save(f.binding,'message-compose','createMessage',draft)).rejects.toThrow('SCOPE_CHANGED');
});
it('logout from a never-opened tab broadcasts the verified scope to invalidate sibling composers',async()=>{
 const f=await bootUnopened();
 expect(f.posted).toContainEqual({type:'erase',...scope});
});

it('unopened-composer erase failure is visible and never reports successful local cleanup',async()=>{
 const f=await bootUnopened(true);
 await vi.waitFor(()=>expect(f.nodes.get('notice')!.textContent).toContain('local draft erasure failed'));
 expect(f.nodes.get('notice')!.textContent).not.toContain('drafts cleared');
 expect((f.database.inspect(scope) as {entries:unknown}).entries).not.toEqual({});
});
