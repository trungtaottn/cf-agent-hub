import {it,expect} from 'vitest';
import {verifyRelease} from '../../scripts/verify-release.mjs';
import {evidenceFixture} from './release-fixture';
it('rejects_unknown_feature_id',()=>{const {input,files}=evidenceFixture();input.features.push({id:'F99',status:'verified'});expect(verifyRelease(input,files).passed).toBe(false);});
it('unavailable_round_cannot_be_promoted_in_r1_evidence',()=>{const {input,files}=evidenceFixture();input.features.push({id:'F11',status:'verified'});expect(verifyRelease(input,files).passed).toBe(false);});
it('disabled_capability_has_no_mutation_surface_requires_runtime_assertion',()=>{const {input,files}=evidenceFixture();input.assertions=input.assertions.filter((x:any)=>x.id!=='disabled_capabilities');expect(verifyRelease(input,files).passed).toBe(false);});
it('rejects_omitted_disabled_capability_and_unsupported_release_claim',()=>{for(const mutate of [(x:any)=>x.disabled_features.pop(),(x:any)=>{x.features[0].status='released';}]){const {input,files}=evidenceFixture();mutate(input);expect(verifyRelease(input,files).passed).toBe(false);}});
