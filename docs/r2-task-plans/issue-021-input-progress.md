# Issue 21 — bounded import-input checkpoint

Status: Local input-contract checkpoint implemented and independently reviewed; publication and later issue 21 work pending. No import endpoint, completed issue or live acceptance is claimed.

## Source and scope

This work uses a synthetic local commit over parent `a385aff7af0c93527cbddf6fb8d9ef264db543e0`. Its starting tree exactly matches the coordinator's frozen issue 20 tree `94709bedd55c3be2ed7e7a56a020fbad7d9438ac`; all 45 overlay payloads matched the frozen SHA-256 manifest. This is not a final remote issue 20 commit. Publication must await the coordinator's actual predecessor head and CI, reconcile ancestry without rewriting the existing issue-linked branches, and remain a draft stack. No remote publication, merge, deployment or Cloud Harness action belongs to this checkpoint.

The original [R2 import amendment](../superpowers/plans/2026-10-23-r2-durable-work.md) remains authority. This batch owns only the input schema, static input verifier, input contract tests and this receipt. Preview/apply/report/OpenAPI/search/generator integration and runtime behavior remain pending.

## Plan validation and red-team disposition

Read the actual installed AgentKit ak-vibe, ak-plan validation/red-team, ak-research, ak-cook and ak-code-review workflows. Independent read-only security/assumptions review found no blocker after the following explicit clarifications:

- Strict ImportBatch describes a completely valid batch. ImportEnvelope checks only the closed top-level structure and 100-row bound; each raw row is then checked against ImportRow. A strict batch failure must not automatically reject the entire future preview request. Unknown authority fields reject their row, never silently disappear.
- UTC accepts Z/z and +00:00; -00:00 denotes an unknown offset and is rejected along with nonzero offsets. Calendar validity is independently checked by date-time format validation.
- No unrequested minimum row count, duplicate-ID schema rejection, source-reference URI syntax, coercion or defaults. Duplicate external IDs and current references require later semantic checks. Character limits count Unicode code points, not UTF-16 units or bytes.
- The static Node verifier checks actual supplied UTF-8 bytes before decoding/parsing, including whitespace and envelope overhead. It is contract tooling, not a new production parser or endpoint. Existing transport tests separately exercise the unchanged bounded streaming parser.
- Every rejected row emits only index, null external_id and INVALID_ROW. No raw invalid identifier, schema error values, authority fields or source text are echoed. A valid row's code:null establishes shape only, not visibility, creation disposition or execution authority.

Whole-plan sweep: old live-acceptance start restrictions are superseded only by the owner's development authorization. Original reviewed plan bytes stay unchanged. No generated roots, routes, cursor plumbing, Task DTO changes or domain state are introduced. Run focused meaningful red/green tests, unchanged transport regression, generated/type checks and independent exact-diff review before handing off this small batch.

## Evidence

Initial focused run collected 64 tests and failed all 64 because the new schema/static verifier did not exist. Subsequent results are recorded only after execution. This is not evidence of working imports, authorization, database reconciliation or search.

## Local verification receipt

On Node 24.22.1/npm 11.19.1 with unchanged lock SHA-256 `8fa7894880bd0b77bfdf6fffe7e13fd8eb1a8b695b1316682dc33f7783873634`, the initial 64 collected tests failed for missing schema/verifier, then passed with the implementation. Added coverage exercises wrong types, empty identifiers, allowed duplicate IDs and lowercase UTC z. Final new suite contains 73 tests. The unchanged four-test transport bounds suite is separate existing streaming evidence, not import integration.

Generated verification and all TypeScript targets passed. Final full Node suite passed 583 tests. The first full Node run failed one provisioning test because Wrangler attempted to create `/home/agent/.config/.wrangler`; rerunning with task-local supported XDG config/cache/data paths and metrics disabled passed without any source, assertion or guard modification. The default Python lacked markdown-it; the existing task-local documentation environment passed validation (86 Markdown documents, 152 JSON files, 1,156 local links, 92 mapped fixtures). Historical plan validation passed 636 checks.

Independent exact-diff review reported no material findings in the four-file input-only change; the optional lowercase-z case was added. No Workers/operator/recovery CLI aggregate check or live test was run for this standalone input-only slice. Parent issue 20 results and remote CI are not substituted for this checkpoint's evidence. Remaining #21 preview/report/search contracts, OpenAPI integration and eventual domain implementation remain outstanding.
