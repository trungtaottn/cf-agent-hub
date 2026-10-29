import test from 'node:test';import assert from 'node:assert/strict';
import {readFixtureJson} from '../../scripts/lib/native-fixture-io.mjs';
test('bounded JSON refuses over-limit, invalid UTF8 and zero-progress chunks',async()=>{for(const value of [new Uint8Array(5),new Uint8Array(0)]){let cancelled=0;const body=new ReadableStream({start(c){c.enqueue(value);},cancel(){cancelled++;}});const pending=[];await assert.rejects(readFixtureJson(new Response(body),4,new AbortController().signal,p=>pending.push(p)));await Promise.all(pending);assert.equal(cancelled,1);}});
test('abort cancels a stalled body and owns cancellation settlement',async()=>{const abort=new AbortController();let cancelled=0;const pending=[];const reading=readFixtureJson(new Response(new ReadableStream({cancel(){cancelled++;}})),10,abort.signal,p=>pending.push(p));abort.abort();await assert.rejects(reading);await Promise.all(pending);assert.equal(cancelled,1);});

test('invalid UTF8 is rejected after bounded completion',async()=>{await assert.rejects(readFixtureJson(new Response(new Uint8Array([255])),4,new AbortController().signal,()=>{}));});
