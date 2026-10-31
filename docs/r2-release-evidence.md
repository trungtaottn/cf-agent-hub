# R2 release evidence controller

Status: additive source implementation in review · Schema 16 · Formal acceptance pending after R4.

Issue #47 adds an R2-specific structural verifier. It does not deploy the application, authenticate arbitrary JSON, approve a release, satisfy R1 acceptance, or clear the pending #40 security review. The owner-authorized MVP development continuation is not an acceptance waiver. Historical uncheckpointed issue47 work was lost during an environment reset; this implementation is a fresh reconstruction from the verified issue46 source, not a recovery of the old evidence roster.

## Invocation and interpretation

```sh
npm run verify:release -- --round R2 --evidence validation/releases/<release-id>/root.json
```

Run in the intended committed Git checkout. The R2 root must contain `format_version: 2` and `round: "R2"`; mixed or unknown versions fail closed. R1 uses its existing version, receipt shapes, fixtures and verdicts unchanged. The root schema is [runtime evidence](../validation/runtime-evidence.schema.json); the closed R2 contract is [R2 runtime evidence](../validation/r2-runtime-evidence.schema.json).

Exit zero and `passed: true` mean **only that the supplied bytes satisfy the structural contract**. R2 results always include `scope: "structural-only"` and `acceptance: "pending-external-inspection"`. A hash or `real-run` marker cannot prove that a run happened, establish entitlement, authenticate an observer, or turn synthetic records into live evidence. An independent controller must inspect the original protected execution, observation, review and deployment records. Missing original records leave acceptance pending even if someone manufactures a structurally consistent JSON graph.

The verifier neither executes receipt commands nor accepts raw shell commands. Each command uses one policy-owned kind and fixed sanitized invocation identifier. Command projection and root metadata bind candidate, composition, environment, timestamps, original execution record and exit outcome. Embedded typed results must be owned by the exact command and connected to the root graph. Harness exit zero is distinct from an expected observed native process exit 3 or 5 in a negative scenario.

## Candidate and six-component composition

The exact source inventory includes paths, byte lengths, SHA-256 and executable modes. The CLI verifies Git HEAD, file inventory, modes and cleanliness outside the selected evidence directory. Dependencies and evidence cannot masquerade as source. The pinned toolchain is Node 24.22.1, npm 11.19.1 and the candidate lock digest.

| Component | Required identity |
| --- | --- |
| Application Worker | Emitted main module and all 16 exact SQL text modules; application configuration, deployment/version and Workspace DO namespace |
| Operator Worker | Emitted main module, operator configuration and exact `WORKSPACE` Durable Object binding |
| Recovery anchor provider | Emitted main module, provider configuration and separately owned namespace |
| Native CLI | Exact distributed executable bytes; no invented Worker deployment identity |
| Source operator CLI | Exact 19-file runtime source closure, charged once as inventoried source |
| UI assets | Exact index, JavaScript and CSS bytes; application asset deployment, not a fictional separate UI Worker |

Review and deployment records bind the complete canonical composition, not one selected binary. The operator has no separate workspace namespace. Application and anchor namespaces differ; recovery source/target provider mappings are independently authenticated and may use distinct objects in a shared provider namespace.

## Required typed evidence

Fresh source-derived policy contains **380 cases**: 322 isolation phases, 11 additional gates, 37 built-native scenarios and 10 browser scenarios. This is not the lost historical roster. [Case policy](../scripts/lib/r2-policy-data/cases.json) owns exact predicates; supplied evidence cannot choose its own expected result. A separate preparation receipt binds each actor, grant, proof, resource, epoch and fixture commitment. Commands carry bounded case-subject digest partitions, at most 128 cases each.

- Isolation covers exact authorized effects and denied/read/other-workspace preservation. Generic denial does not prove an intended fence or independent-review cause. Foreign-task scenarios retain the actual cross-workspace/resource mismatch claim, not an invented isolated same-workspace wrong-run proof.
- Result evidence joins task, run, result, acceptance, authoritative event, history and retained outcome. The acceptance run equals the submission run; reviewer principal and agent are distinct from the submitter. Replay compares full authoritative domain outcome, not per-attempt HTTP envelope IDs.
- Actual built CLI success is distinct from an in-process facade. Upload, download and commit may issue metadata plus operation requests. A lost-response restart cannot establish process-local clock continuity and must fail without another send. A settled journal entry also rejects another dispatch. Source coordinator replay or server readback is not built-CLI replay or journal settlement.
- Browser observations bind current rendered assets, authenticated action semantics and task/result graph. Source assertions are not a browser run.
- Recovery records cover all 36 current tables, source-preserved versus independently expected transformed state, bounded chunks, complete unfinished-artifact partitions, nonempty fixture coverage plus valid empty peers, independent source and target artifact digests/sizes, complete holds, fresh anchor observations and exact cutover joins. Original protocol receipt, execution record and replay-domain outcome digests remain distinct.
- Platform qualification has separate resolution, reviewed boundary plan and workload observations. The resolution precedes the plan and the plan precedes execution. Accepted workloads observe full capture/restore/remote verification with inclusive provider-to-DO invocation accounting. The over-limit manifest case may be local and proves no-effect input rejection, not gateway rejection or live platform entitlement. The 32-invocation eligibility question remains externally unresolved until independently authorized applicability evidence exists.

Public API readback does not replace per-operation SQL/workspace commitments from an authorized fixture observer. Do not substitute an unrelated local Worker snapshot for deployed state. The native executable cannot revoke credentials; revoked-proof scenarios require a separately authorized control fixture. No producer is authorized by this document to provision such a fixture or access private observations.

## Bounded loading

| Category | Per artifact | Combined |
| --- | ---: | ---: |
| Root JSON | 4 MiB | Separate root limit |
| Source | 16 MiB | 32 MiB; 2,048 unique files |
| Component bytes | 16 MiB | 32 MiB |
| Evidence | 4 MiB | 16 MiB; 256 unique non-source references |
| Command projection | 64 KiB | Included in evidence total |

Typed receipts also have narrower bounds: case family/preparations 4 MiB, recovery 2 MiB, result graph 16 KiB, restore input 8 KiB, expected transform 64 KiB, platform root 16 KiB, resolution/workload 8 KiB and reviewed plan 32 KiB. Canonical recovery controls are separately bounded at 6 KiB.

**Per-kind maxima are not simultaneously admissible promises.** The combined cap can reject an otherwise individually valid set. The loader atomically reserves each complete known batch before reading any payload in that batch. Root references are admitted together. Nested references become knowable only after bounded parent parsing; their entire typed batch is then admitted before child reads. A late nested-budget rejection does not undo prior bounded parent reads, but it never returns a partial pass or reads the offending batch. Reused identical references count once; conflicting type/category/size/digest aliases fail.

Disk reads reject traversal, symlinks, non-files, changed descriptors, oversized bodies, malformed UTF-8 and BOM-prefixed JSON. Source namespace and evidence namespace remain separate. Map-based tests use the same byte/type/budget checks before verifier-owned copies; allocations already made by the caller are outside those limits. Unknown references and arbitrary JSON fields are never recursively fetched.

## Verification and handoff

Source tests use explicitly synthetic fixtures, negative mutations, source-contract parity, exact-bound/one-over loading and old R1 compatibility checks. Passing these tests verifies the controller implementation only. Refer to the immutable issue47 execution handoff for exact source hash, commands, terminal exits, independent reviews and blocked checks. Current deployed browser/native/recovery records, toolchain audit, platform applicability and security signoff are not fabricated or silently retried by this task.

Code and documents may be shared through a draft PR under owner authorization. **Do not merge.** Formal integrated acceptance remains a separate owner-controlled step after R4.
