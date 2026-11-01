import {it,expect} from 'vitest';
import * as api from '../../scripts/lib/r3-source-context-reporter';
const normalize=(api as any).normalizeJ1ContextTest;
function test(meta:unknown){return {id:'test_1',name:'name',options:{mode:'run'},result:()=>({state:'pending'}),diagnostic:()=>undefined,meta:()=>meta};}
it('normalizes actual null-prototype metadata without normalizing result state',()=>{const fact=normalize(test(Object.create(null)));expect(fact.packet).toBeNull();expect(fact.context_packet).toBeNull();expect(fact.state).toBe('pending');});
it('captures exact two fixed metadata strings',()=>expect(normalize(test({r3SourceObservation:'obs',r3SourceContext:'ctx'}))).toMatchObject({packet:'obs',context_packet:'ctx'}));
for(const meta of [null,[],new(class{})(),{extra:'x'},{r3SourceContext:1},{r3SourceContext:null},{r3SourceContext:undefined},{r3SourceObservation:null},{r3SourceContext:'x'.repeat(16385)}])it('rejects malformed metadata',()=>expect(()=>normalize(test(meta))).toThrow());
it('never invokes metadata accessors',()=>{let calls=0;expect(()=>normalize(test({get r3SourceContext(){calls++;return 'x';}}))).toThrow();expect(calls).toBe(0);});
it('rejects combined escaped metadata expansion',()=>expect(()=>normalize(test({r3SourceObservation:'"'.repeat(180000),r3SourceContext:'"'.repeat(12000)}))).toThrow());
