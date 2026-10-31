# Phase3 — integrate, review, document and checkpoint

Status: source implemented and independently reviewed; final regression infrastructure-blocked and live acceptance pending.


Status: source integration, focused tests, typechecks and independent review complete; final frozen serial regression/checkpoint recorded externally.

Controller owns scripts/verify-release.mjs and declarations, root runtime schema, runtime test discovery, full fixture/integration tests and docs. Helpers have strictly disjoint files; their interfaces are frozen first. No concurrent shared schema writes. Preserve R1 fixture bytes and expected verdicts; no broadened arbitrary-root loader recursion.

Integrate --roundR2 into existing command and preserve --roundR1 behavior. CLI requires clean committed checkout, exact HEAD and complete Git inventory/modes, bounded root/ref loading. Source-only fixtures cannot certify live/native/browser/recovery gates. Use exact-source semantic and negative tests, typechecks, fullNode/Workers, operator/provider suites, buildCLI/UI, runtime and docs/plans, serially coordinated. No denied audit/browser/protectedCLI bypass; no substitute issue40 review.

Independent review of current diff, no selfgrading. Fix Critical/Important findings with regression tests, rerun affected gates; conditional simplifier per actual AK thresholds. Review exact final source hash and retain failing/interrupted receipts. Update owning docs/release-checklist/testing/featurematrix without statuspromotion; explain command usage, producers, bounds and reconstruction loss.

Freeze source before final suite. Capture command/time/sourcehash/terminalexit; live process sessions polled only via original tool session, not ps inference. Final checkpoint includes source/patch/hashmanifest/handoff and privatebackup, no licensedkit or runtime/credentialfiles. Parent receives artifacts, pending gates and exact first pickup; no GitHubwrites or merge by this worker.
