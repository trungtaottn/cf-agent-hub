# R2 source integration and acceptance handoff

Status: Reviewed R2 source integrated on dev; live acceptance pending; no released artifact. Source integration is not Verified or live acceptance.

## Exact integrated source

The owner authorized the ordered Ready/merge sequence after source review and checks. All 30 PRs [#94](https://github.com/trungtaottn/cf-agent-hub/pull/94) through [#123](https://github.com/trungtaottn/cf-agent-hub/pull/123) are merged, with branches retained. Final dev commit [55dba1444d8633c9425ba537836f1f28e64db678](https://github.com/trungtaottn/cf-agent-hub/commit/55dba1444d8633c9425ba537836f1f28e64db678) has tree `0274c79e40333838f9bd520ddd5f3b1b9dcd33a5`, the same tree as the checked final PR123 source head `c94fa5b8136f712f3aacc500fde7e11505f1ef0e`. This supersedes historical draft-only directions for this completed stack; it is not blanket permission for unrelated future merges. Main, deployment, tags and releases were not changed.

## Source evidence, not acceptance

[CI run 41034535166](https://github.com/trungtaottn/cf-agent-hub/actions/runs/41034535166) succeeded at the exact final source head: source 2,013 Node / 1,766 Workers / 61 browser tests; native-source 2,815 passes and two environment skips; native-service 17 + 5 + 1 passes; native-build reproducible bounded bundle/import checks; dependencies and local-sandbox passed. The native managed-runtime positive remained ineligible (its rejection test passed); a Git-ancestry negative was skipped on the non-Git temporary CI root. Neither skip is a passed native acceptance case. Eligible guarded disk/publication cases ran in CI. Build/import did not execute the protected factory.

These are recorded remote results, not new local test claims. The final dev merge has the same source tree, but no separate dev push CI run is asserted: the workflow push trigger selects main and cf-agent-hub-r1, while pull_request checks covered the integrated source. Conditional release-evidence was skipped. A manual R1/R2 verifier selection validates supplied structural evidence; it does not create missing authentic evidence or grant release approval.

## Implementation reference map

| Capability rows | Integrated issue source | Boundaries still required for Verified |
| --- | --- | --- |
| F11–F13 | #25 identity/credentials; #26 runtime/presence | Genuine isolated credential/runtime lifecycle and revocation |
| F14 | #40 isolation/security matrix | Independent security evidence and deployed cross-workspace review |
| F15–F22 | #27–31 task/lease/fence/failure; #35 independent result acceptance; #42/45 board/commands | Real competing-agent, crash and current-authority journeys |
| F23 | #32/33 immutable artifacts and bounded cleanup | Actual configured product bucket and restore/stream evidence |
| F24 | #38 client; #41/44 durable CLI; #48 fixed required-profile runner | Actual protected installed CLI/store/Journal/artifact/HTTPS execution and final output closure |
| F25/F26/F29 | #36 search; #37 import; #28 catalog | Authorized deployed reads/import reconciliation |
| F34 | #45 command/conflict UI | Integrated human/native journey and accessibility acceptance |
| F40 | #39/43 recovery; #46 operator tooling | Coordinated genuine metadata/artifact restore and reconciliation |

Each issue's `docs/r2-task-plans/issue-NNN-execution.md` (where present), owning task plan and source tests retain the detailed historical evidence. #19–24 contract/storage integration and #47 evidence composition support these rows; they are not separate claims of live acceptance. No known unimplemented fixed required-profile adapter API remains in the reviewed source scope; real execution may still reveal integration defects.

## Open acceptance and operational gates

- **#40:** owner manual acceptance permits the source integration. It is distinct from the unavailable independent security-signoff result; no blocked scan was rerun or relabeled as passed, and no vulnerability is implied merely by that missing result.
- **#48:** the fixed required profile implements 62 steps. Only the three specifically deferred tuple cases remain unverified for R4; the full 68-step profile remains unavailable, not silently accepted. Actual protected factory execution against an eligible operator-owned runtime and authorized isolated service is still unproved, including actual CLI/store/Journal/artifact/HTTPS custody and final 491-original/493-file output closure. Synthetic process carriers and local service tests do not establish this.
- **Replay:** the shipped one-shot CLI has a process-random replay-clock epoch. An uncertain restart refuses redispatch with exit 5 and no outgoing mutation; a settled restart also does not redispatch. Historical issue text requiring automatic positive restart replay is superseded by this conservative no-send contract, not by a fabricated restart-success test.
- **#49 and #50:** integrated native/global-380 acceptance, coordinated recovery and release remain open. Formal acceptance is deferred until after R4 development, not waived. R1 #10/#11/#14–18 evidence also remains separately tracked; passing dependency CI alone does not resolve every embedded-toolchain obligation.
- **Repository protection:** active rules currently require only branch-policy, without strict up-to-date checks. See [branching and releases](branching-and-releases.md) for the reviewed administrative proposal; this document does not apply it.

Issue labels must describe current work, not historical stack construction. A merged source PR no longer merits draft-pr. An acceptance issue remains open when its authentic evidence is outstanding; removing an obsolete label is not completing that gate. R3/R4 source remains separately scoped and Specified in the [feature matrix](feature-matrix.md).
