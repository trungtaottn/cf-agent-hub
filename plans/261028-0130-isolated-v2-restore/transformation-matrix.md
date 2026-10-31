# Complete36-table disposition matrix

Status: Local source implementation in progress; verification and integrated acceptance remain pending. No released capability is claimed.

Source authenticity/typedrows/relationships checked from immutablechunks. TemporaryFK staging is not finalstate orsourceevidence. Everyrow remains covered even if not activated in target. Allfinalstate closed until explicitcontrolgates.

| Table | Disposition |
|---|---|
| schema_migrations | Validate exactsource1–16; retain sourceevidence; targetinstalled16 rows neveroverwritten |
| workspace_metadata | Validate sourceidentity/checkpoint; targetcurrentledger mapping/epoch; preserve relevantretentionwatermarks |
| human_grants | Import evidence then authoritativecurrentledger restrictions overlay |
| static_agents | Canonicalidentity preserved; currentstaticoverlay; humanmanaged epochadvance withoutarchive/status resurrection |
| native_credentials | Currentstatic/retiredledger wins; humanmanaged disabled/revoked; no plaintextreconstruction |
| login_attempts | Consumed and nonce/verifier scrubbed; no oldauthcompletion |
| sessions | Revoked, original identity/history retained |
| profiles | Preserve |
| preferences | Preserve |
| threads | Preserve |
| thread_participants | Preserve with canonicalhuman/agentrelationships |
| messages | Preserve with validated message/task/artifactreferences |
| inbox | Preserve, no recovery-generatedACK |
| events | Preserve exactsource; eventsequencehighwater then deterministic new recoveryauditevents |
| idempotency_outcomes | Preserve domainoutcomes with currentauth replay; operatorhistory evidence separated from newtargetcontrolreceipts |
| outbox | Preserve immutableidentity/payload/attempts, pausepending/inflight until explicitno-redriveresolution |
| scheduler_state | Sourceevidence; targetclosed/reconciliation state, no importedactivealarm |
| maintenance_state | Sourcecheckpoint evidence; targetnewfence restoring/restored, never copyopenauthority |
| recovery_jobs | Sourceevidence/provenance, never executableimportedjobs; currentrestorejob independentlypersisted |
| recovery_chunks | Sourceevidence and referentialvalidation; targetnewreceipts for exactauthenticatedchunks |
| probe_receipts | Sourceevidence only; cannot count asfresh targetprobe |
| runtimes | Revoke/expire proofauthority, identity/history retained |
| tasks | Preserve nonactive state/results; active ->backlog/unknown, clearactivepointer, preservelatest/retries/holds, safedeterministic versionadvance |
| runs | Active ->expired/ended, safedeterministicversionadvance; preserve capturedfence/replayclassification and terminalhistory |
| task_results | Preserve exact bindings/evidence |
| task_acceptances | Preserve independentreview identity; no newacceptance granted |
| task_history | Preserve sourcehistory plus deterministicrecoverytransition ifcontractrequires |
| artifacts | Committed exactgeneration/version/digest/bytes; incomplete stages invalidated, never resumableoldauthority |
| artifact_generations | Preserve history; exactcommittedbytes; accept reserved never-dispatched evidence without fake drainage; reject in_flight/uncertain complete-capture contradictions; no old put/delete execution |
| result_artifacts | Preserve and bidirectionalvalidate committedassociations |
| artifact_associations | Preserve and validate canonicalreverseedges/ownership |
| message_artifacts | Preserve and bidirectionalvalidate committedassociations |
| catalog_plans | Preserve immutable evidence; transform previewed -> expired, retain applied/expired status; no inferred epoch check |
| import_plans | Preserve report/provenance; transform previewed -> expired, retain applied/expired status; old preview replay cannot apply |
| import_mappings | Preserve stable namespace/externalID/task linkage |
| artifact_inventory_state | Sourceevidence; targetcleanup cursor/revision mustnotimport sourceauthority ortriggerdelete |
