import {afterEach,expect,it,vi} from 'vitest';
import {replacePreservingFocus} from '../../src/ui/dom';
class Node{
 key:string|null=null;disabled=false;child:Node|null=null;
 constructor(key:string|null=null){this.key=key;}
 getAttribute(){return this.key;}
 contains(value:unknown){return this.child===value;}
 replaceChildren(content:Node){this.child=content;state.activeElement=body;}
 querySelectorAll(){return this.child?[this.child]:[];}
 matches(){return this.disabled;}
 focus(){if(!this.disabled)state.activeElement=this;}
}
const body=new Node(),state={activeElement:body};
afterEach(()=>vi.unstubAllGlobals());
function run(mode:'enabled'|'disabled'|'missing'|'outside'){
 vi.stubGlobal('HTMLElement',Node);vi.stubGlobal('document',state);
 const container=new Node(),old=new Node('same'),next=new Node(mode==='missing'?'other':'same'),fallback=new Node();container.child=old;next.disabled=mode==='disabled';state.activeElement=mode==='outside'?body:old;
 replacePreservingFocus(container as unknown as HTMLElement,next as unknown as HTMLElement,fallback as unknown as HTMLElement);
 return {next,fallback};
}
it('keeps the same enabled read-control focus',()=>{const {next}=run('enabled');expect(state.activeElement).toBe(next);});
it('uses stable main fallback when refreshed control is disabled',()=>{const {fallback}=run('disabled');expect(state.activeElement).toBe(fallback);});
it('uses stable fallback when a focused record disappears',()=>{const {fallback}=run('missing');expect(state.activeElement).toBe(fallback);});
it('never steals focus outside the rerendered region',()=>{run('outside');expect(state.activeElement).toBe(body);});
