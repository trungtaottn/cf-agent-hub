import {describe,it,expect} from 'vitest';
import {parseExactJson,ExactJsonError} from '../../src/approvals/exact-json';
const limits={maxBytes:10485760,maxDepth:64,maxNodes:100000};
const bytes=(s:string)=>new TextEncoder().encode(s);
function parse(s:string,l=limits){return parseExactJson(bytes(s),l);}
function rejects(input:string|Uint8Array,code:string,l=limits){
 try{parseExactJson(typeof input==='string'?bytes(input):input,l);expect.fail('input accepted');}
 catch(e){expect(e).toBeInstanceOf(ExactJsonError);expect((e as ExactJsonError).code).toBe(code);}
}
describe('exact proposal JSON bytes',()=>{
 it('preserves ordinary JSON, paired unicode, literal punctuation and prototype-named data',()=>{
  const text='{"a":[true,false,null,0,-2,"x\\\"{}:[]"],"\\uD83D\\uDE00":"é","__proto__":{"safe":1}}';
  const result=parse(text);expect(result).toEqual(JSON.parse(text));
  expect(Object.prototype.hasOwnProperty.call(result,'__proto__')).toBe(true);
  expect(({} as Record<string,unknown>).safe).toBeUndefined();
 });
 it.each(['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":[{"a":1,"a":2}]}','{"😀":1,"\\ud83d\\ude00":2}','{"__proto__":1,"__proto__":2}'])('rejects decoded duplicate keys: %s',(s)=>rejects(s,'DUPLICATE_KEY'));
 it('permits same keys in distinct objects and does not normalize unicode',()=>expect(parse('[{"a":1},{"a":2},{"é":1,"é":2}]')).toEqual([{a:1},{a:2},{é:1,'é':2}]));
 it.each(['','[1,]','{"a":1,}','{"a" 1}','[1 2]','true false','01','+1','NaN','//comment\n1','{"a":undefined}','"\\x41"','"unterminated','"\u0000"','[','{'])('rejects malformed grammar %j',(s)=>rejects(s,'INVALID_JSON'));
 it.each(['1.5','1e999','9007199254740992','-9007199254740992','0.0001','1e-999','1.0000000000000001','9007199254740990.9'])('rejects numeric values outside safe integers %s',(s)=>rejects(s,'INVALID_JSON'));
 it('allows safe integer values including exponent spelling and -0',()=>{expect(parse('1e3')).toBe(1000);expect(parse('1000e-3')).toBe(1);expect(parse('1.0')).toBe(1);expect(parse('0e9999')).toBe(0);expect(parse('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);expect(Object.is(parse('-0'),-0)).toBe(true);});
 it.each(['"\\ud800"','"\\udc00"','"\\ud800x"','{"\\udfff":0}'])('rejects unpaired decoded surrogates %s',(s)=>rejects(s,'INVALID_JSON'));
 it('rejects invalid UTF8 instead of replacing bytes',()=>{for(const x of [[0xc0,0xaf],[0xed,0xa0,0x80],[0xe2,0x82],[0xff]])rejects(new Uint8Array(x),'INVALID_UTF8');});
 it('rejects BOM, permits embedded U+FEFF string data',()=>{rejects(new Uint8Array([0xef,0xbb,0xbf,0x31]),'BOM');expect(parse('"\ufeff"')).toBe('\ufeff');});
 it('counts bytes rather than decoded code units and includes whitespace',()=>{expect(parse('"é"',{...limits,maxBytes:4})).toBe('é');rejects('"é"','TOO_LARGE',{...limits,maxBytes:3});rejects(' 0','TOO_LARGE',{...limits,maxBytes:1});});
 it('enforces depth exactly with root container depth one',()=>{expect(parse('[[]]',{...limits,maxDepth:2})).toEqual([[]]);rejects('[[]]','DEPTH_LIMIT',{...limits,maxDepth:1});rejects('['.repeat(65)+']'.repeat(65),'DEPTH_LIMIT');});
 it('counts values including containers but not object keys',()=>{expect(parse('{"a":[1]}',{...limits,maxNodes:3})).toEqual({a:[1]});rejects('{"a":[1]}','NODE_LIMIT',{...limits,maxNodes:2});expect(parse('0',{...limits,maxNodes:1})).toBe(0);});
 it('rejects invalid or ceiling-widening limits before parsing',()=>{for(const [key,max] of Object.entries(limits))for(const n of [0,-1,1.5,NaN,Infinity,max+1])rejects('0','INVALID_LIMITS',{...limits,[key]:n});});
 it('returns detached parsed values without modifying input bytes',()=>{const b=bytes('{"a":1}');const original=b.slice();const value=parseExactJson(b,limits);expect(b).toEqual(original);b.fill(0);expect(value).toEqual({a:1});});
 it('honors hard ceilings at actual byte, node and depth boundaries',()=>{
  const padded='0'+' '.repeat(limits.maxBytes-1);expect(parse(padded)).toBe(0);rejects(padded+' ','TOO_LARGE');
  expect(parse('['.repeat(64)+'0'+']'.repeat(64))).toBeDefined();
  const wide='['+Array(99999).fill('0').join(',')+']';expect((parse(wide) as unknown[]).length).toBe(99999);
  rejects('['+Array(100000).fill('0').join(',')+']','NODE_LIMIT');
 });
 it('matches native parsing on a deterministic accepted corpus without normalization',()=>{
  for(let n=0;n<100;n++){
   const value={['k'+n]:[n,-n,null,true,'é😀\n"\\'+n],nested:{a:{b:n}}};
   const text=JSON.stringify(value);expect(parse(text)).toEqual(JSON.parse(text));
  }
 });

});
