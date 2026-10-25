import {it,expect} from 'vitest';
import {verifyRelease,sha256} from '../../scripts/verify-release.mjs';
import {evidenceFixture} from './release-fixture';
it('accepts_complete_synthetic_verifier_unit_input_without_claiming_a_runtime_run',()=>{const {input,files}=evidenceFixture();expect(verifyRelease(input,files)).toEqual({passed:true,findings:[]});});
it('rejects_docs_only_runtime_claim',()=>{const {input,files}=evidenceFixture();input.commands[0].kinds=['docs'];input.commands[0].command='python scripts/validate_docs.py';expect(verifyRelease(input,files).passed).toBe(false);});
it('rejects_missing_feature_gate',()=>{const {input,files}=evidenceFixture();input.assertions=input.assertions.filter((x:any)=>x.id!=='deployed_identity_provider_journey');expect(verifyRelease(input,files).passed).toBe(false);});
it('rejects_failed_command_and_pending_scenario',()=>{for(const mutate of [(x:any)=>{x.commands[0].exit_code=1;},(x:any)=>{x.assertions[0].status='pending';}]){const {input,files}=evidenceFixture();mutate(input);expect(verifyRelease(input,files).passed).toBe(false);}});
it('rejects_missing_environment_or_independent_review',()=>{for(const field of ['environment','review']){const {input,files}=evidenceFixture();delete input[field];expect(verifyRelease(input,files).passed).toBe(false);}});
it('rejects_local_fixture_as_real_deployment_evidence',()=>{const {input,files}=evidenceFixture();input.assertions.find((x:any)=>x.id==='deployed_identity_provider_journey').environment='workers';expect(verifyRelease(input,files).passed).toBe(false);});
it('rejects_missing_route_and_lane_scenario',()=>{const {input,files}=evidenceFixture();input.route_matrix.pop();expect(verifyRelease(input,files).passed).toBe(false);});
it('rejects_unresolved_toolchain_advisories',()=>{const {input,files}=evidenceFixture();input.toolchain.audit_status='blocked';expect(verifyRelease(input,files).passed).toBe(false);});
it('rejects_secret_values_in_evidence',()=>{const {input,files}=evidenceFixture();input.known_exceptions=['Bearer '+ 'A'.repeat(43)];expect(verifyRelease(input,files).passed).toBe(false);});
it('rejects_unknown_closed_fields',()=>{const {input,files}=evidenceFixture();input.claimed_success=true;expect(verifyRelease(input,files).passed).toBe(false);});

function changeReceipt(fixture:ReturnType<typeof evidenceFixture>,name:'review'|'deployment'|'recovery'|'audit',mutate:(value:any)=>void){
 const ref=name==='audit'?fixture.input.toolchain.audit_artifact:fixture.input[name].artifact;
 const value=JSON.parse(fixture.files.get(ref.path)!);mutate(value);
 const body=JSON.stringify(value);fixture.files.set(ref.path,body);ref.sha256=sha256(body);
}
it('rejects_caller_selected_failure_as_the_expected_gate_outcome',()=>{const f=evidenceFixture();for(const row of f.input.assertions){row.expected=false;row.observed=false;}expect(verifyRelease(f.input,f.files).passed).toBe(false);});
it('rejects_deployment_receipt_for_unreviewed_build_bytes',()=>{const f=evidenceFixture();changeReceipt(f,'deployment',x=>{x.artifact_sha256='f'.repeat(64);});expect(verifyRelease(f.input,f.files).passed).toBe(false);});
it('rejects_deployment_receipt_for_another_deployment',()=>{const f=evidenceFixture();f.input.environment.deployment_id='another_deployment';expect(verifyRelease(f.input,f.files).passed).toBe(false);});
it('rejects_recovery_for_unrelated_workspace_capture_or_invalid_epoch',()=>{for(const mutate of [(x:any)=>{x.workspace_id='another_workspace';},(x:any)=>{x.capture_id='another_capture';},(x:any)=>{x.source_epoch=-1;}]){const f=evidenceFixture();changeReceipt(f,'recovery',mutate);expect(verifyRelease(f.input,f.files).passed).toBe(false);}});
it('rejects_dependency_audit_for_a_different_lock_or_toolchain',()=>{for(const mutate of [(x:any)=>{x.lock_sha256='f'.repeat(64);},(x:any)=>{x.node='24.11.0';},(x:any)=>{x.npm='11.9.0';}]){const f=evidenceFixture();changeReceipt(f,'audit',mutate);expect(verifyRelease(f.input,f.files).passed).toBe(false);}});
it('rejects_unknown_or_malformed_review_severity',()=>{for(const finding of [{severity:'high',id:'blocking'},{}]){const f=evidenceFixture();changeReceipt(f,'review',x=>{x.open_findings=[finding];});expect(verifyRelease(f.input,f.files).passed).toBe(false);}});
it('rejects_recovery_steps_reusing_an_unbound_receipt',()=>{const f=evidenceFixture();changeReceipt(f,'recovery',x=>{for(const step of x.steps)step.receipt_id='same_receipt';});expect(verifyRelease(f.input,f.files).passed).toBe(false);});
it('rejects_missing_route_and_denied_state_changes_despite_a_pass_label',()=>{for(const mutate of [(x:any)=>{x.http_status=404;},(x:any)=>{x.mutations.events_inserted=1;},(x:any)=>{x.sql_after_sha256='f'.repeat(64);},(x:any)=>{x.response_contract_valid=false;}]){const f=evidenceFixture();mutate(f.input.route_matrix[0].observed);expect(verifyRelease(f.input,f.files).passed).toBe(false);}});
it('rejects_success_status_without_the_required_operation_effect',()=>{const f=evidenceFixture();const row=f.input.route_matrix.find((x:any)=>x.operation==='createMessage'&&x.lane==='valid_native');row.observed.mutations.messages_inserted=0;expect(verifyRelease(f.input,f.files).passed).toBe(false);});
