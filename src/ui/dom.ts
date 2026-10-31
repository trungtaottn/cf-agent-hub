export function el<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,attributes:Record<string,string>={}):HTMLElementTagNameMap[K]{
 const node=document.createElement(tag);if(text!==undefined)node.textContent=text;
 for(const [name,value]of Object.entries(attributes))node.setAttribute(name,value);return node;
}
export function button(label:string,action:()=>void,attributes:Record<string,string>={}):HTMLButtonElement{
 const node=el('button',label,{type:'button',...attributes});node.addEventListener('click',action);return node;
}
export function clear(node:Element):void{node.replaceChildren();}
export function labeledControl<T extends HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>(label:string,input:T):HTMLElement{
 input.setAttribute('aria-label',label);
 const wrapper=el('label',label);wrapper.appendChild(input);return wrapper;
}

/** Preserve a focused read control across projection replacement; never steal external focus. */
export function replacePreservingFocus(container:HTMLElement,content:HTMLElement,fallback:HTMLElement):void{
 const active=document.activeElement;
 const owned=active instanceof HTMLElement&&container.contains(active);
 const key=owned?active.getAttribute('data-focus-key'):null;
 container.replaceChildren(content);
 if(!owned)return;
 const replacement=key?[...container.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node=>node.getAttribute('data-focus-key')===key):undefined;
 (replacement&&!replacement.matches(':disabled,[aria-disabled="true"],[hidden]')?replacement:fallback).focus();
}
