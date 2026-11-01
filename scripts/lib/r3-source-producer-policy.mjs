/** Exact source-only producer inventory; never a release/evidence authority. */
export const J1_CASES=Object.freeze(['request_pause_replay','human_approve_replay_revoked','human_reject_replay','pending_command_history_restore','rejected_command_history_restore','changed_chunk_continuation_denied']);
export const J1_GUARDS=Object.freeze(['detects same-count authority mutation without putting private values into diagnostics','rejects oversized raw SQL fields before full private row materialization']);
export const J1_TESTS=Object.freeze([...J1_CASES.map(x=>'produces actual command-source facts for '+x),...J1_GUARDS]);
export const J1_MODULE='test/acceptance/r3-request-journey.test.ts';
export const J1_LIMITS=Object.freeze({observation:262144,packet:360448,observationTotal:1572864,manifest:65536,execution:65536,outputTotal:2097152,sourceCount:256,sourceBytes:33554432,sourceFile:16777216});
