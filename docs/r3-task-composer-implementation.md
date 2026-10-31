# R3 task composer: integration evidence boundary

Status: source review passed; browser acceptance and publication pending; no released artifact, merge, deployment or full issue-56 acceptance claim.

## Source identity

The integration starts from local commit `30f4d46b3562f182ddebdea7e9d50ced41c231f0`, tree `32f48518dad14109facf8e02cab215038f8e7408`. That full tree matches published issue-53 source `ebddfbb149a7f7c4c14da331664805c82292ab27` in PR 133. Commit IDs differ; tree equivalence, not assumed commit equivalence, is the baseline. Reviewed module checkpoints `4aa444a39c0302e810c806131d6c2d5c7b1b022d` and `253d81a7314ed3f8abe93576c44965de1467bdf5` were applied to this baseline before app integration.

## Acceptance map

| Issue-56 requirement | Source evidence / acceptance case | Boundary |
| --- | --- | --- |
| One Backlog task; server authority fields only | Canonical native create validation; production-app keyboard/double-activation specs inspect task/event/outcome count deltas | Browser execution pending |
| Unknown fields, missing title, stale/archived references denied | Model negatives; native Worker task tests; production-app direct native negatives with real session/CSRF | Source checks distinct from browser acceptance |
| Full 65,536-byte UTF-8 JSON envelope; inert text | Canonical client validation, model multibyte regression, text-only DOM; browser envelope/detail cases | No HTML insertion of supplied text |
| Double-click/reload/loss preserves one immutable intent | Shared SubmitController/DraftStore tests; production-app two-tab committed-response-loss receipt and SQL snapshot comparison | No resend/new-key shortcut |
| Restored reference review and scope privacy | Current typed profile/getAgent reads; binding fences; shared storage erasure tests; browser logout/principal/late-read cases | Optional picker denial does not become create policy |
| Keyboard errors/focus; current state versus admission | Stable labeled controls, exact body/revision field-error attribution; fresh getTask before current-state/detail claim | Real browser still pending |

## Measured local checks

- Focused model/controller/store/host-lifetime/response-loss-probe and actual-app callback checks: 104 passed; independent review ran 126 tests across eight affected suites.
- Full exact-source Node suite: 2,314 passed across 103 files.
- Full typecheck, UI build and generated-contract checks passed for the reviewed source.
- Real isolated HTTPS/OIDC/Worker-SQL fixture self-check passed, including task/event/outcome snapshot cardinality and teardown. This is not a browser run.
- Workers validation remains running; no passing result is inferred. Recovery CLI completed with 29 passed and 18 failed: protected input rejected the local temporary-root checkout boundary. That guard was not weakened, its checkout marker was not removed, and no alternate path was used to bypass it. Prior issue-53 CLI results are not candidate evidence.
- Fourteen production-app browser specifications are authored and listed, not executed. No browser launch was repeated in this environment because the pinned Chromium/runtime prerequisites remain unavailable. Prior PR-133 browser evidence does not cover this new task-form integration.
- Node 24.22.1 is installed. Installed npm is 11.9.0, while the manifest requests 11.19.1; no dependency/toolchain upgrade was attempted.

## Reproduction

Use the exact candidate source with its existing locked dependencies and the repository toolchain instructions:

```sh
npm test
npm run typecheck
npm run build:ui
npm run test:workers
npm run test:recovery-cli
node scripts/start-ui-test-server.mjs --self-check-r2
npm run test:ui -- test/ui/compose-task.spec.ts
```

A fresh command-scoped `XDG_CONFIG_HOME` was used for the local Wrangler test harness; no credentials or global security configuration were changed. Browser acceptance must execute on an authorized pinned environment after exact-candidate review. Publication and external validation transfer remain owner-controlled operations.
