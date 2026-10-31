/** Exact-input preflight only: neither schema validation nor approval authority.
 * Hash original snapshotted bytes separately, never JSON.stringify(this result).
 * The proposal contract deliberately narrows JSON numbers to safe integers and
 * strings to paired Unicode scalars; these restrictions are not RFC mandates.
 */
export type ExactJsonLimits={maxBytes:number;maxDepth:number;maxNodes:number};
export type ExactJsonErrorCode='INVALID_LIMITS'|'TOO_LARGE'|'INVALID_UTF8'|'BOM'|'INVALID_JSON'|'DUPLICATE_KEY'|'DEPTH_LIMIT'|'NODE_LIMIT';
export class ExactJsonError extends Error {
 constructor(readonly code:ExactJsonErrorCode){super(code);this.name='ExactJsonError';}
}
const ceilings:Readonly<ExactJsonLimits>={maxBytes:10485760,maxDepth:64,maxNodes:100000};
type Frame={kind:'object';state:'keyOrEnd'|'key'|'colon'|'value'|'commaOrEnd';keys:Set<string>}|
 {kind:'array';state:'valueOrEnd'|'value'|'commaOrEnd'};
const fail=(code:ExactJsonErrorCode):never=>{throw new ExactJsonError(code);};

// Check mathematical integrality before IEEE-754 conversion can round or
// underflow a fraction into an apparently safe integer. Never expand huge powers.
function safeIntegerToken(token:string):boolean{
 const unsigned=token[0]==='-'?token.slice(1):token;
 const [mantissa,exponentText]=unsigned.toLowerCase().split('e');
 const dot=mantissa.indexOf('.');
 const fractionDigits=dot<0?0:mantissa.length-dot-1;
 let digits=mantissa.replace('.','').replace(/^0+/,'');
 if(!digits)return true; // Any exponent of exact zero is still exact zero.
 const exponent=Number(exponentText??'0');
 if(!Number.isSafeInteger(exponent))return false;
 const shift=exponent-fractionDigits;
 if(shift<0){
  const remove=-shift;
  if(remove>=digits.length)return false;
  for(let i=digits.length-remove;i<digits.length;i++)if(digits[i]!=='0')return false;
  digits=digits.slice(0,digits.length-remove);
 }else{
  if(digits.length+shift>16)return false;
  digits+='0'.repeat(shift);
 }
 return digits.length<=16&&Number.isSafeInteger(Number(digits));
}

export function parseExactJson(bytes:Uint8Array,limits:ExactJsonLimits):unknown{
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
   if(!match||!safeIntegerToken(match[0]))fail('INVALID_JSON');
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
