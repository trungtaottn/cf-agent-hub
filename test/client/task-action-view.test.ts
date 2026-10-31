import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {taskActionDisclosure,TaskActionPanel} from '../../src/ui/task-action-view';
import {asFixture,descendants,domFixture} from '../helpers/dom-fixture';
import type {Task} from '../../src/http/dto';
beforeEach(()=>vi.stubGlobal('document',domFixture));afterEach(()=>vi.unstubAllGlobals());
const task={id:'task_one',title:'<img onerror=1>',state:'backlog'} as Task;
it('uses native disclosure and named ordinary buttons with visible disabled explanations',()=>{
 const root=asFixture(taskActionDisclosure(task,true,{disabledReason:(_task,operation)=>operation==='readyTask'?null:'Current authority required',open:vi.fn()}));
 const buttons=descendants(root,n=>n.tagName==='BUTTON');expect(buttons).toHaveLength(5);
 expect(buttons[0].getAttribute('aria-expanded')).toBe('false');expect(buttons[0].textContent).toContain('task_one');
 expect(descendants(root,n=>n.getAttribute('role')==='menu'||n.getAttribute('role')==='menuitem')).toHaveLength(0);
 expect(buttons[2].getAttribute('disabled')).toBe('');expect(buttons[2].getAttribute('aria-describedby')).toBeTruthy();
 expect(root.textContent).toContain('Current authority required');expect(descendants(root,n=>n.tagName==='IMG')).toHaveLength(0);
});
it('pointer activation enters the same authoritative preparation callback with exact task and operation',()=>{
 const open=vi.fn(),root=asFixture(taskActionDisclosure(task,true,{disabledReason:()=>null,open}));
 const ready=descendants(root,n=>n.tagName==='BUTTON'&&n.textContent==='Ready')[0]!;ready.click();expect(open).toHaveBeenCalledWith('task_one','readyTask',ready);
});

it('persistent panel updates retain the same reason node and do not rewrite an equal draft (structural only)',()=>{
 vi.stubGlobal('document',{...domFixture,addEventListener(){}});
 const state={status:'ready',taskId:'task_one',operation:'cancelTask',task:null,reason:'Original reason',disabledReason:null,intent:null,result:null,revision:1};
 const actions={state,setReason:vi.fn(),prepare:vi.fn(),submit:vi.fn(),replay:vi.fn()};
 const panel=new TaskActionPanel(actions as any,{workspaceId:'ws_example',viewKey:()=>'/tasks',fallback:()=>({} as HTMLElement)});
 panel.update();const root=asFixture(panel.element),reason=descendants(root,n=>n.tagName==='TEXTAREA')[0]! as any;
 let assignments=0,value=reason.value;Object.defineProperty(reason,'value',{get:()=>value,set:(next:string)=>{assignments++;value=next;}});
 panel.update();panel.update();expect(assignments).toBe(0);expect(descendants(root,n=>n.tagName==='TEXTAREA')[0]).toBe(reason);
 state.status='uncertain';panel.update();expect(reason.disabled).toBe(true);expect(root.textContent).toContain('Outcome unknown');
 state.reason='Revised reason';state.status='ready';panel.update();expect(assignments).toBe(1);expect(reason.value).toBe('Revised reason');
 expect(root.textContent).toContain('cannot undo external effects');
 state.status='rejected';(state as any).result={ok:false,status:409,requestId:'request_rejected',error:{code:'INVALID_STATE',message:'untrusted error body',retryable:false}};panel.update();
 expect(root.textContent).toContain('INVALID_STATE');expect(root.textContent).toContain('request_rejected');expect(root.textContent).not.toContain('untrusted error body');
});

// Structural DOM model only: explicit focus loss simulates a browser hiding Confirm.
// Native modal/actionability behavior must still be verified by browser CI.
function panelFixture(){
 const active:{activeElement:any}={activeElement:null},all:any[]=[],listeners:((event:any)=>void)[]=[];
 class Node {
  children:any[]=[];attrs=new Map<string,string>();textContent='';hidden=false;disabled=false;open=false;value='';parent:any=null;isConnected=true;
  constructor(readonly tagName:string){all.push(this);}
  setAttribute(name:string,value:string){this.attrs.set(name,value);if(name==='hidden')this.hidden=true;}
  getAttribute(name:string){return this.attrs.get(name)??null;}
  append(...nodes:any[]){for(const node of nodes){node.parent=this;this.children.push(node);}}
  addEventListener(){} contains(node:any):boolean{return node===this||this.children.some(child=>child.contains(node));}
  querySelectorAll(){return all.filter(node=>node!==this&&this.contains(node));}
  closest(){return this.hidden?this:this.parent?.closest()??null;}
  matches(){return this.disabled;}focus(){if(!this.disabled){active.activeElement=this;for(const listener of listeners)listener({target:this});}}
  showModal(){this.open=true;}close(){this.open=false;}
 }
 const body=new Node('BODY');
 vi.stubGlobal('document',{body,get activeElement(){return active.activeElement;},createElement:(tag:string)=>new Node(tag.toUpperCase()),addEventListener(type:string,listener:(event:any)=>void){if(type==='focusin')listeners.push(listener);},querySelectorAll:()=>all.filter(node=>node.attrs.has('data-focus-key'))});
 const state:any={status:'ready',taskId:'task_one',operation:'cancelTask',task:null,reason:'Reason',disabledReason:null,intent:null,result:null,revision:1};
 const actions={state,prepare:(id:string,operation:string)=>{state.taskId=id;state.operation=operation;state.status='ready';},submit(){},replay(){},setReason(){}};
 const fallback=new Node('MAIN'),card=new Node('A'),outside=new Node('BUTTON');card.setAttribute('data-focus-key','task:task_one');
 let view='/tasks';const panel=new TaskActionPanel(actions as any,{workspaceId:'ws',viewKey:()=>view,fallback:()=>fallback as any});
 return {panel,state,active,body,card,outside,fallback,all,navigate(){view='/overview';panel.navigation();}};
}
it('an earlier completion cannot close a newly opened command and failed refresh uses fallback',()=>{
 const f=panelFixture();f.panel.open('task_one','cancelTask',f.card as any);const first=f.panel.focusToken;
 f.panel.open('task_two','cancelTask',f.card as any);f.panel.restoreFocus(first,f.card as any);
 expect(f.panel.dialog.open).toBe(true);expect(f.active.activeElement).not.toBe(f.card);
 f.state.status='succeeded';f.panel.update();
 f.panel.restoreFocus(f.panel.focusToken,null);expect(f.panel.dialog.open).toBe(false);expect(f.active.activeElement).toBe(f.fallback);
});
it('closes its completed modal when hiding focused Confirm leaves body focused (structural only)',()=>{
 const f=panelFixture();f.panel.open('task_one','readyTask',f.card as any);
 const confirm=f.all.find(node=>node.textContent==='Confirm command')!;confirm.focus();
 f.state.status='succeeded';f.panel.update();expect(confirm.hidden).toBe(true);
 f.body.focus();f.panel.restoreFocus(f.panel.focusToken,f.card as any);
 expect(f.panel.dialog.open).toBe(false);expect(f.active.activeElement).toBe(f.body);
});
it('closes its completed modal without stealing explicit outside focus (structural only)',()=>{
 const f=panelFixture();f.panel.open('task_one','cancelTask',f.card as any);
 f.state.status='succeeded';f.panel.update();f.outside.focus();f.panel.restoreFocus(f.panel.focusToken,f.card as any);
 expect(f.panel.dialog.open).toBe(false);expect(f.active.activeElement).toBe(f.outside);
});
it('navigation invalidates completion and does not restore focus (structural only)',()=>{
 const f=panelFixture();f.panel.open('task_one','cancelTask',f.card as any);const token=f.panel.focusToken;
 f.state.status='succeeded';f.panel.update();f.navigate();f.outside.focus();f.panel.restoreFocus(token,f.card as any);
 expect(f.panel.dialog.open).toBe(false);expect(f.active.activeElement).toBe(f.outside);
});
it('nonterminal state cannot close the current modal through completion restoration (structural only)',()=>{
 const f=panelFixture();f.panel.open('task_one','cancelTask',f.card as any);
 f.panel.restoreFocus(f.panel.focusToken,f.card as any);expect(f.panel.dialog.open).toBe(true);
});
it('manual close and reopen invalidate the old completion token (structural only)',()=>{
 const f=panelFixture();f.panel.open('task_one','cancelTask',f.card as any);const old=f.panel.focusToken;
 f.state.status='succeeded';f.panel.update();f.panel.hide();f.panel.reopen();
 f.panel.restoreFocus(old,f.card as any);expect(f.panel.dialog.open).toBe(true);
});
it('authority invalidation prevents late completion from taking modal or focus ownership (structural only)',()=>{
 const f=panelFixture();f.panel.open('task_one','cancelTask',f.card as any);const token=f.panel.focusToken;
 f.state.status='unresolved';f.panel.update();f.outside.focus();f.panel.restoreFocus(token,f.card as any);
 expect(f.panel.dialog.open).toBe(true);expect(f.active.activeElement).toBe(f.outside);
});
it('owned completion restores current connected target and duplicate completion does not steal focus (structural only)',()=>{
 const f=panelFixture();f.panel.open('task_one','cancelTask',f.card as any);
 f.state.status='succeeded';f.panel.update();const token=f.panel.focusToken;f.panel.restoreFocus(token,f.card as any);
 expect(f.panel.dialog.open).toBe(false);expect(f.active.activeElement).toBe(f.card);
 f.outside.focus();f.panel.restoreFocus(token,f.card as any);expect(f.active.activeElement).toBe(f.outside);
});
