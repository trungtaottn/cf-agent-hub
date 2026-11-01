import type {FrozenBinding} from '../../packages/observation-adapter/src/contract';
export const binding:FrozenBinding={origin:'https://hub.example.invalid',workspaceId:'ws_example',principal:{origin:'https://hub.example.invalid',workspaceId:'ws_example',principalId:'agent_example',slotId:'slot_example',slotGeneration:1,provenanceId:'provenance_example'},runtimeId:'runtime_example',taskId:'task_example',runId:'run_example',fence:1,repositoryId:'repo_example',checkoutSlotId:'checkout_example',launchGeneration:'launch_example',adapterId:'claude-paths',adapterVersion:'1',expectedConfigIdentity:'config_example'};
export const sid='obs_'+'a'.repeat(48);
export const record={observed_at:'2026-11-01T00:00:00.000Z',relative_path:'src/example.ts',activity:'read-observed' as const,source_oid:null};
export const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
