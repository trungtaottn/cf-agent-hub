import test from 'node:test';import assert from 'node:assert/strict';
import {createInstalledFixtureClient} from '../../scripts/lib/native-fixture-installed-client.mjs';
import {policy} from './fixture-test-values.mjs';
test('fixed installed composition has no default credential lookup',()=>{assert.throws(()=>createInstalledFixtureClient({policy:policy()}));});
test('construction reserves both sessions without looking up a credential or sending',async()=>{let reads=0;const c=createInstalledFixtureClient({policy:policy(),readAuthentication:async()=>{reads++;throw Error();}});assert.equal(reads,0);assert.equal(c.snapshot().client.attempts,0);assert.equal(c.snapshot().transport.attempts,0);assert.equal(c.snapshot().transport.transportReservation.version,1);await c.close();assert.equal(reads,0);});
test('unknown transport override and getter-based installation reject without evaluation',()=>{let touched=0;assert.throws(()=>createInstalledFixtureClient({policy:policy(),readAuthentication:async()=>{},rejectUnauthorized:false}));assert.throws(()=>createInstalledFixtureClient({get policy(){touched++;return policy();},readAuthentication:async()=>{}}));assert.equal(touched,0);});
