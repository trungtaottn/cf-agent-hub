# Phase3 — Authority invalidation, controls, documentation and verification

Status: pending phases1–2. Files bootstrap.ts with sharedidentityowner; recovery/{controls,probes,protocol,maintenance,jobs,restore-current}.ts; task domainowner helper if needed; docs/backup-restore.md, operations.md, ADR/featureevidence and issue43executionplan. No CLIoroperatortransport changes belonging46.

## Tests before / transformation

- [ ] Snapshotactive run with replay-safe evidence still expires into Backlog outcome_unknown. Retrycount/limit/latestpointer, capturedfence and existingunknown/exhaustedflags preserved. Ordinary expiry helper cannot be used with unknown=false because it mayauto-ready/incrementretry.
- [ ] Terminal runs/tasks/results/acceptances/importprovenance retained byte-equivalent except explicit documentedtransform. Review/done/cancelled never reset toBacklog. NoR3 approvalactivation.
- [ ] Oldsessions/login attempts/nativeproofs and postcheckpoint credentials cannot renew/submit/replay; revoked/archivedidentity neverresurrected; freshissuance/enrollment succeeds only undercurrentceiling after explicitresume.

## Implementation

- [ ] Extract shared canonical per-row authority validation and transformation primitives from the identity owner; do not duplicate semantics or call the existing whole-table restoreAuthorityOverlay/applyAuthorityRows in final publication. That helper currently materializes whole agent/credential tables and bulk-updates runtimes. Prepare dynamic credential revocation, runtime expiration, human-managed agent epoch updates and static grant restrictions in deterministic bounded pages while admission remains closed. Persist bounded progress/count/digest receipts under the exact admitted ledger and fence. A changed trusted ledger invalidates preparation and cannot publish; never silently switch ledger mid-job. The final fenced transaction verifies complete preparation and exact current ledger, then performs only bounded control-state publication. Normal bootstrap behavior must retain existing contract tests after any shared primitive extraction.
- [ ] Final invalidation foractive runs/tasks must be bounded. Precompute/page transformations underclosedrestorestate and store deterministic progress tied tosourcechunks; finaltransaction verifies complete transformation receipts/counts plus currentledger before publishing restoredclosed state. Avoid one unbounded millionrowSQL+JS loop. Versionoverflow rejects before anypublicadmission. Preserve coherent new recoveryaudit/history with deterministic IDs, sourceeventsequencehighwater and exactly-once transformation receipt.
- [ ] Sessions revoke, loginconsume+scrub nonce/verifier, runtimes invalidate; everyrestored idempotency outcome requires currentauthorization onreplay. Explicitly transform every restored catalog_plans/import_plans row with status='previewed' to status='expired'; these schemas store no authority epoch, so current authorization and unchanged resource versions alone do not invalidate historical preview intent. Preserve immutable JSON, hashes, original timestamps, applied reports/mappings and idempotency evidence; applied/expired rows retain status. Test restore and resume within the original 15-minute preview TTL, including old preview replay retrieval followed by apply: apply must deny, while a newly created current-authority preview can work. Newjoboperatorreceipts nevercollide withimportedoperatorhistory.
- [ ] Generalize controls/probes with version-discriminated currentjob/registry, keep V1 tests unchanged. Current16 sourcecapture mayretire, current16 targetrestore mayresolve/probe/resume. schema15 allcontrolmutations remainexplicitdenial, leaving existing capture/read/status compatibility untouched.
- [ ] Outboxpending/inflight stayspaused. Explicit trusted immutable deliveryresolution changes only disposition/evidence, not ACK/attempts/payload/dispatch. Missingreceipt remainsuncertain. Rejectresume while any unresolveddelivery/artifacteffect exists. Sourcecompletecapture receipt alone grants noauthority.
- [ ] Resume requires authenticatedcurrentledger/higher targetepoch, exactsource retirement, exclusivecutover targetmapping, fresh target16 probe bound tocurrentmaintenancegeneration/installationdigest; allchecks repeat afterawait. Mark schedulerdirty only afterauthorizedtransition. Checkpoint/capture/read controls do not autoopen.

## Tests after

- [ ] Versionoverflow/identitycollision/currentledgerrevocation midawait/finaloverlay failure leavesclosedstate and rollback; retrydoesnotdoublebump versions/events oreraseexistinghistory.
- [ ] Permanent staleownerdenial after restart and afterresume, including formerly replay-safe run; unchangedretrybudget/latest-run/fullhistory, endedrun status/endedat consistent.
- [ ] Resolution never HTTPsend/ACK; missing/forged/stale/wrongsource retirement, stale/futureprobe, wrongcutover, staleledger all denyresume. Fullyvalid synthetic current16 flow succeeds once, thenfreshauthorizedtask/newrun/independentreview only afterresume.
- [ ] Historical V1 behavior preserved; source15 capture andartifact-bearingcontinuation unchanged;15restore/retirement/resume rejectbeforeeffects, includingreplay andrestart.
- [ ] Independentreview finalexactdiff plus sourceprotectedhashes; targetedtests followed by fullserialNode/Workers/operator/deploy/generation/types/docs/plan checks. Browser/CLI/audit/security40 limitations truthfullycarried, nofreshdeniedoperation retry.

## Handoff / stop

Attach sourcefield -> preserved/transformed/disabled/evidence matrix, exact schemaoperation matrix, measuredlimits, commands/exits and everyremaininggate. Final cleanlocalcommit/checkpoint only after verification and review; immutable42base verified unchanged. GitHubpublication awaits actualstackpredecessors; user has authorized PRonly but toolgates remain. No merge/deploy/live acceptance, which remains afterR4.

## Fresh independent ledger contract

Implement only the conditional trusted binding contract in [trusted-anchor-contract.md](trusted-anchor-contract.md). Parent selected this explicit amendment; independent review must validate it before cook. Missing real provider remains a runtime availability gate, not permission to use request-snapshot freshness. Issue46 owns actual provider provisioning/CLI/deployment wiring. Parent assigned issue43 the narrow authenticated admission-replay adapter and exact composed envelope seams; see operator-envelope-contract.md.
