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

// Behavior of ownership state under a structural fake only, not native browser focus QA.
it('an earlier completion cannot close a newly opened command and failed refresh uses fallback',()=>{
 const active:{activeElement:any}={activeElement:null},all:any[]=[];
 class Node {
  children:any[]=[];attrs=new Map<string,string>();textContent='';hidden=false;disabled=false;open=false;value='';parent:any=null;
  constructor(readonly tagName:string){all.push(this);}
  setAttribute(name:string,value:string){this.attrs.set(name,value);if(name==='hidden')this.hidden=true;}
  getAttribute(name:string){return this.attrs.get(name)??null;}
  append(...nodes:any[]){for(const node of nodes){node.parent=this;this.children.push(node);}}
  addEventListener(){} contains(node:any):boolean{return node===this||this.children.some(child=>child.contains(node));}
  querySelectorAll(){return all.filter(node=>node!==this&&this.contains(node));}
  closest(){return this.hidden?this:this.parent?.closest()??null;}
  matches(){return this.disabled;}focus(){if(!this.disabled)active.activeElement=this;}
  showModal(){this.open=true;}close(){this.open=false;}
 }
 vi.stubGlobal('document',{...active,get activeElement(){return active.activeElement;},createElement:(tag:string)=>new Node(tag.toUpperCase()),addEventListener(){},querySelectorAll:()=>all.filter(node=>node.attrs.has('data-focus-key'))});
 const state:any={status:'ready',taskId:'task_one',operation:'cancelTask',task:null,reason:'Reason',disabledReason:null,intent:null,result:null,revision:1};
 const actions={state,prepare:(id:string)=>{state.taskId=id;state.status='ready';},submit(){},replay(){},setReason(){}};
 const fallback=new Node('MAIN'),card=new Node('A');card.setAttribute('data-focus-key','task:task_one');
 const panel=new TaskActionPanel(actions as any,{workspaceId:'ws',viewKey:()=>'/tasks',fallback:()=>fallback as any});
 panel.open('task_one','cancelTask',card as any);const first=panel.focusToken;
 panel.open('task_two','cancelTask',card as any);panel.restoreFocus(first,card as any);
 expect(panel.dialog.open).toBe(true);expect(active.activeElement).not.toBe(card);
 const second=panel.focusToken;panel.restoreFocus(second,null);expect(panel.dialog.open).toBe(false);expect(active.activeElement).toBe(fallback);
});
