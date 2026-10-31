/** Minimal structural DOM for render unit tests; not browser/layout evidence. */
export class DomFixtureElement {
  readonly children:DomFixtureElement[]=[];
  readonly attributes=new Map<string,string>();
  readonly listeners=new Map<string,((event:{preventDefault():void})=>void)[]>();
  #text='';
  constructor(readonly tagName:string){}
  set textContent(value:string|null){this.#text=value??'';this.children.splice(0);}
  get textContent():string{return this.#text+this.children.map(child=>child.textContent).join('');}
  setAttribute(name:string,value:string):void{this.attributes.set(name,value);}
  getAttribute(name:string):string|null{return this.attributes.get(name)??null;}
  append(...nodes:DomFixtureElement[]):void{this.children.push(...nodes);}
  addEventListener(type:string,listener:(event:{preventDefault():void})=>void):void{this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  click():void{if(this.attributes.has('disabled'))return;for(const listener of this.listeners.get('click')??[])listener({preventDefault(){}});}
}
export const domFixture={createElement:(tag:string)=>new DomFixtureElement(tag.toUpperCase())};
export const asFixture=(node:HTMLElement):DomFixtureElement=>node as unknown as DomFixtureElement;
export function descendants(root:DomFixtureElement,predicate:(node:DomFixtureElement)=>boolean):DomFixtureElement[]{
  return [...(predicate(root)?[root]:[]),...root.children.flatMap(child=>descendants(child,predicate))];
}
export function section(root:DomFixtureElement,id:string):DomFixtureElement{
  const found=descendants(root,node=>node.getAttribute('data-testid')===id)[0];if(!found)throw new Error('Missing section '+id);return found;
}
