/** Prerequisite manifest policy only. This is NOT an activated R3 receipt profile. */
export const R3_PREREQUISITE_FAMILIES=Object.freeze(['composition','decision-domain','human-browser','native-parity','mcp-stdio','mcp-clients','recovery','independent-review','prior-round']);
/** Exact pinned mapping from docs/mcp-api.md; a count alone cannot establish parity. */
export const R3_TOOL_OPERATIONS=Object.freeze(Object.fromEntries([
 ['hub_workspace_get','getWorkspace'],['hub_agents_list','listAgents'],['hub_tasks_list','listTasks'],['hub_task_get','getTask'],['hub_task_create','createTask'],['hub_task_claim','claimTask'],['hub_run_get','getRun'],['hub_run_heartbeat','heartbeatRun'],['hub_task_request_decision','requestTaskDecision'],['hub_task_submit_result','submitTaskResult'],['hub_task_fail','failTask'],['hub_inbox_get','getInbox'],['hub_thread_get','getThread'],['hub_message_send','createMessage'],['hub_messages_ack','ackMessages'],['hub_artifact_get','getArtifact'],['hub_search','searchWorkspace'],
]));
export const R3_INCOMPLETE_POLICY=Object.freeze(['typed-r3-producers','action-effect-predicates','recovery-graph','runtime-origin-inspection','prior-round-acceptance','independent-round-review']);
