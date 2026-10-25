export const R1_FEATURES = ['F01','F02','F03','F04','F05','F06','F07','F08','F09','F10','F27','F28','F30','F41'];
export const ALL_FEATURES = Array.from({length:42},(_,i)=>'F'+String(i+1).padStart(2,'0'));
export const R1_OPERATIONS = ['getWorkspace','createMessage','getInbox','getThread','ackMessages','listEvents','startAuth','getAuthSession','logoutAuth','callbackAuth','getConfiguration','getProfile','putProfile','previewProfile','exportProfile','getPreferences','putPreferences','getOperations','getReadiness','getLiveness'];
export const AUTH_LANES = ['ungranted_human','valid_human','expired_session','valid_native','revoked_native','wrong_workspace','conflicting_lanes'];
export const REQUIRED_KINDS = ['generated','types','contract','node-tests','workers-tests','operator-tests','browser-tests','docs','dependency-audit','deployed-ingress','deployed-recovery','build'];
export const REQUIRED_GATES = {
 identity_oidc_negative_matrix:{features:['F01'],environment:'workers'},
 deployed_identity_provider_journey:{features:['F01'],environment:'isolated-deployment'},
 browser_cookie_csrf:{features:['F01'],environment:'browser'},
 workspace_catalog_isolation:{features:['F02'],environment:'workers'},
 static_grants_revocation:{features:['F03'],environment:'workers'},
 message_atomicity_replay:{features:['F04'],environment:'workers'},
 authorized_pagination:{features:['F05'],environment:'workers'},
 recipient_ack:{features:['F06'],environment:'workers'},
 outbox_restart_retry_budget:{features:['F07'],environment:'workers'},
 bounds_and_cursor_binding:{features:['F08'],environment:'workers'},
 truthful_ui_states:{features:['F09'],environment:'browser'},
 diagnostics_redaction:{features:['F10'],environment:'workers'},
 neutral_seed:{features:['F27'],environment:'browser'},
 profile_revision_policy:{features:['F28'],environment:'workers'},
 preferences_accessibility:{features:['F30'],environment:'browser'},
 readiness_probe:{features:['F41'],environment:'workers'},
 route_authorization_matrix:{features:['F01','F02','F03'],environment:'workers'},
 operator_auth_transport:{features:['F03','F41'],environment:'workers'},
 isolated_recovery_roundtrip:{features:['F04','F07','F41'],environment:'isolated-deployment'},
 deployment_artifact_identity:{features:['F02','F41'],environment:'isolated-deployment'},
 rollback_compatibility:{features:['F03','F41'],environment:'isolated-deployment'},
 disabled_capabilities:{features:['F02'],environment:'workers'}
};
export const REQUIRED_RECOVERY_STEPS = ['capture','verify','restore','probe','resolve_delivery','retire','resume','restart','interrupted_chunk_replay','first_install_failure','compatible_rollback'];
// These are aggregate gate outcomes. Negative protocol cases inside a gate must
// satisfy their own denial assertions before its aggregate may report "pass".
export const ACCEPTED_GATE_OUTCOME = 'pass';
export const REQUIRED_RECOVERY_CHECKS = {
 capture:['registry_complete','checkpoint_frozen','all_chunks_authenticated'],
 verify:['manifest_authenticated','ledger_current','chunk_digests_match','foreign_keys_valid'],
 restore:['empty_isolated_target','rows_preserved','sessions_revoked','current_grants_overlay','notifications_paused'],
 probe:['write_read_succeeded','rollback_confirmed','scheduler_restored'],
 resolve_delivery:['evidence_bound','no_redrive','no_ack_mutation','unresolved_empty'],
 retire:['source_permanently_fenced','receipt_authenticated'],
 resume:['source_retirement_verified','cutover_verified','probe_fresh','target_admission_enabled'],
 restart:['state_persisted','alarm_repaired','no_duplicate_delivery'],
 interrupted_chunk_replay:['same_digest_no_duplicate','changed_digest_rejected'],
 first_install_failure:['admission_closed','no_partial_authority'],
 compatible_rollback:['compatibility_checked','authority_epoch_preserved','receipts_retained']
};

// Lane order is AUTH_LANES. Each cell has a single, policy-owned expected
// status; generic missing-route, challenge and infrastructure failures fail.
export const ROUTE_STATUS = {
 getWorkspace:[401,200,401,200,401,401,400],
 createMessage:[401,201,401,201,401,401,400],
 getInbox:[401,403,401,200,401,401,400],
 getThread:[401,200,401,200,401,401,400],
 ackMessages:[401,403,401,200,401,401,400],
 listEvents:[401,200,401,200,401,401,400],
 startAuth:[200,200,200,200,200,403,400],
 getAuthSession:[401,200,401,401,401,401,400],
 logoutAuth:[401,200,401,401,401,401,400],
 callbackAuth:[403,302,302,401,401,401,400],
 getConfiguration:[401,200,401,200,401,401,400],
 getProfile:[401,200,401,200,401,401,400],
 putProfile:[401,200,401,403,401,401,400],
 previewProfile:[401,200,401,403,401,401,400],
 exportProfile:[401,200,401,403,401,401,400],
 getPreferences:[401,200,401,403,401,401,400],
 putPreferences:[401,200,401,403,401,401,400],
 getOperations:[401,200,401,403,403,401,400],
 getReadiness:[401,200,401,403,403,401,400],
 getLiveness:[200,200,200,200,200,200,200]
};
export const MUTATION_COUNTS = ['login_attempts_inserted','login_attempts_consumed','sessions_inserted','sessions_revoked','profile_revisions','preference_revisions','messages_inserted','threads_inserted','participants_inserted','inbox_inserted','inbox_acknowledged','events_inserted','outcomes_inserted','outbox_inserted','delivery_attempts_started','unexpected_changes'];
/** Matrix fixture: fresh key, existing thread, one addressed recipient, no
 * notification destination or unrelated due work. Callback positives rotate
 * their supplied prior session. Preview is always a read. */
export function routeExpectation(operation,lane){
 const index=AUTH_LANES.indexOf(lane),status=ROUTE_STATUS[operation]?.[index];
 if(status===undefined)return null;
 const mutations=Object.fromEntries(MUTATION_COUNTS.map(key=>[key,0]));
 if(status<400){
  if(operation==='startAuth')mutations.login_attempts_inserted=1;
  if(operation==='callbackAuth')Object.assign(mutations,{login_attempts_consumed:1,sessions_inserted:1,sessions_revoked:1});
  if(operation==='logoutAuth')mutations.sessions_revoked=1;
  if(operation==='putProfile')Object.assign(mutations,{profile_revisions:1,events_inserted:1,outcomes_inserted:1});
  if(operation==='putPreferences')Object.assign(mutations,{preference_revisions:1,events_inserted:1,outcomes_inserted:1});
  if(operation==='createMessage')Object.assign(mutations,{messages_inserted:1,inbox_inserted:1,events_inserted:1,outcomes_inserted:1});
  if(operation==='ackMessages')Object.assign(mutations,{inbox_acknowledged:1,events_inserted:1,outcomes_inserted:1});
 }
 return {status,error_code:status===400?'INVALID_REQUEST':status===401?'UNAUTHENTICATED':status===403?'FORBIDDEN':null,mutations};
}
