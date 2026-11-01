/** Adapter-local strict preflight derived from the shared exact-json scanner.
 * Unlike approval/observation wire input, discarded hook metadata accepts finite
 * fractional JSON numbers. Shared parser and native build inputs stay unchanged.
 * Depth counts open containers; nodes count values (including root), not keys.
 * This parser supplies no identity or authentication evidence.
 */
export type HookJsonLimits={maxBytes:number;maxDepth:number;maxNodes:number};
export type HookJsonErrorCode='INVALID_LIMITS'|'TOO_LARGE'|'INVALID_UTF8'|'BOM'|'INVALID_JSON'|'DUPLICATE_KEY'|'DEPTH_LIMIT'|'NODE_LIMIT';
export class HookJsonError extends Error {
 constructor(readonly code:HookJsonErrorCode){super(code);this.name='HookJsonError';}
}
const ceilings:Readonly<HookJsonLimits>={maxBytes:10485760,maxDepth:64,maxNodes:100000};
type Frame={kind:'object';state:'keyOrEnd'|'key'|'colon'|'value'|'commaOrEnd';keys:Set<string>}|
 {kind:'array';state:'valueOrEnd'|'value'|'commaOrEnd'};
const fail=(code:HookJsonErrorCode):never=>{throw new HookJsonError(code);};

export function parseHookJson(bytes:Uint8Array):unknown{
 const limits:HookJsonLimits={maxBytes:1048576,maxDepth:16,maxNodes:8192};
 for(const k of ['maxBytes','maxDepth','maxNodes'] as const)
  if(!limits||!Number.isSafeInteger(limits[k])||limits[k]<1||limits[k]>ceilings[k])fail('INVALID_LIMITS');
 if(!(bytes instanceof Uint8Array))fail('INVALID_JSON');
 if(bytes.byteLength>limits.maxBytes)fail('TOO_LARGE');
 // Bounded detached snapshot. Callers binding a digest must snapshot before any
 // async work and hash that same snapshot; this function establishes no provenance.
 const snapshot=new Uint8Array(bytes);
 if(snapshot[0]===0xef&&snapshot[1]===0xbb&&snapshot[2]===0xbf)fail('BOM');
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(snapshot);}catch{return fail('INVALID_UTF8');}
 let pos=0,nodes=0;
 const stack:Frame[]=[];
 const whitespace=()=>{while(pos<text.length&&(text[pos]===' '||text[pos]==='\t'||text[pos]==='\r'||text[pos]==='\n'))pos++;};
 const stringToken=():string=>{
  const start=pos++;
  while(pos<text.length){
   const c=text[pos++];
   if(c==='\\'){pos++;continue;}
   if(c==='"'){
    let decoded:string;
    try{decoded=JSON.parse(text.slice(start,pos)) as string;}catch{return fail('INVALID_JSON');}
    for(let j=0;j<decoded.length;j++){
     const n=decoded.charCodeAt(j);
     if(n>=0xd800&&n<=0xdbff){const next=decoded.charCodeAt(++j);if(!(next>=0xdc00&&next<=0xdfff))fail('INVALID_JSON');}
     else if(n>=0xdc00&&n<=0xdfff)fail('INVALID_JSON');
    }
    return decoded;
   }
  }
  return fail('INVALID_JSON');
 };
 const number=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
 const value=()=>{
  whitespace();
  if(++nodes>limits.maxNodes)fail('NODE_LIMIT');
  const c=text[pos];
  if(c==='{'||c==='['){
   if(stack.length+1>limits.maxDepth)fail('DEPTH_LIMIT');
   pos++;
   stack.push(c==='{'?{kind:'object',state:'keyOrEnd',keys:new Set<string>()}:{kind:'array',state:'valueOrEnd'});
  }else if(c==='"'){stringToken();}
  else if(text.startsWith('true',pos)){pos+=4;}
  else if(text.startsWith('false',pos)){pos+=5;}
  else if(text.startsWith('null',pos)){pos+=4;}
  else{
   number.lastIndex=pos;const match=number.exec(text);
   if(!match||!Number.isFinite(Number(match[0])))fail('INVALID_JSON');
   pos=number.lastIndex;
  }
 };
 value();
 // Iterative traversal avoids relying on the JavaScript recursive call stack.
 while(stack.length){
  whitespace();const frame=stack[stack.length-1];const c=text[pos];
  if(frame.kind==='object'){
   if(frame.state==='keyOrEnd'&&c==='}'){pos++;stack.pop();}
   else if(frame.state==='keyOrEnd'||frame.state==='key'){
    if(c!=='"')fail('INVALID_JSON');
    const key=stringToken();if(frame.keys.has(key))fail('DUPLICATE_KEY');
    frame.keys.add(key);frame.state='colon';
   }else if(frame.state==='colon'){
    if(c!==':')fail('INVALID_JSON');pos++;frame.state='value';
   }else if(frame.state==='value'){frame.state='commaOrEnd';value();}
   else if(c==='}'){pos++;stack.pop();}
   else if(c===','){pos++;frame.state='key';}
   else fail('INVALID_JSON');
  }else{
   if(frame.state==='valueOrEnd'&&c===']'){pos++;stack.pop();}
   else if(frame.state==='valueOrEnd'||frame.state==='value'){frame.state='commaOrEnd';value();}
   else if(c===']'){pos++;stack.pop();}
   else if(c===','){pos++;frame.state='value';}
   else fail('INVALID_JSON');
  }
 }
 whitespace();if(pos!==text.length)fail('INVALID_JSON');
 // Native parsing remains the grammar authority after duplicates and resource
 // limits were checked, and preserves own __proto__ data properties safely.
 try{return JSON.parse(text) as unknown;}catch{return fail('INVALID_JSON');}
}
