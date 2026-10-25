# Branching, beta and stable promotion

**Status (2026-10-25):** This document defines repository governance, not a claim that a beta/stable application has been released. GitHub Rulesets must be activated by a repository administrator. The workflow file alone cannot enforce PR-only writes or prevent admins from pushing directly.

## Canonical branches

| Branch | Purpose | Permitted inbound path | Release channel |
| --- | --- | --- | --- |
| `dev` | Integration after completed, reviewed changes | PRs from work branches (including hotfix backports) | Beta candidates only |
| `main` | Stable branch | PR from same-repo `dev` or `hotfix/*` only | Stable candidates only |
| `feature/*`, `fix/*`, `chore/*`, `docs/*` | Bounded work | PR to `dev` | Never publish |
| `hotfix/*` | Emergency stable correction, branch off current `main` | PR to `main`, followed by a separate sync PR to `dev` | Hotfix stable only after acceptance |

Keep `main` as the GitHub default branch. `dev` starts at the same baseline SHA as `main`; unmerged R1 code remains in its work branch until its required tests and reviews pass. Do **not** fast-forward unfinished R1 or other rounds directly into `dev` and do not treat a Draft PR as releasable.

## Required review and CI

1. No direct push, force push, deletion or bypass to `dev` or `main`. Use GitHub branch Rulesets with the PR requirement and no bypass actors.
2. Require the status contexts `branch-policy`, `source` and `dependencies` on both branches **once the R1 workflow is available to each candidate**. `branch-policy` checks that a PR targeting `main` originates **inside this repository** from `dev` or `hotfix/*`. It also checks all PRs targeting `dev`.
3. Keep full security auditing: the R1 `dependencies` job runs `npm audit --audit-level=low`; do not downgrade, suppress the job or hide findings to obtain a green check. The `source` job includes Worker, CLI, document, and browser gates; GitHub checks must be read at the exact PR head SHA.
4. Require conversation resolution and up-to-date checks; no `allow force push`, no emergency admin bypass. The provided Ruleset definitions use **zero mandatory approvals** because a sole maintainer cannot approve their own PR; a second reviewer permits tightening this to one or more approvals.
5. Changes to workflow, policy code or Ruleset definitions deserve owner review. The `pull_request` workflow executes untrusted PR code with a read-only GitHub token and without secrets. It does not by itself prevent a PR author from altering the gate; repository Rulesets, required checks and review are the actual protection boundaries.
6. The branch-policy check alone does not validate the application or release evidence. R1's current audit block remains tracked in [R1-TOOLCHAIN #11](https://github.com/trungtaottn/cf-agent-hub/issues/11).

## Promotion process

1. Work on an isolated `feature/*`, `fix/*`, `chore/*` or `hotfix/*` branch; link the owning issue/plan. Open PR to `dev`, resolve review and all required status checks, merge through GitHub PR. The existing R1 PR targets `dev` and remains Draft while dependencies fail.
2. For a **beta**, build and verify an exact commit already merged into `dev`; record the release evidence, review, toolchain, security inventory, runtime readiness and rollback path. Only then create an annotated prerelease tag `vX.Y.Z-beta.N` pointing to that accepted `dev` commit and publish an explicitly marked *prerelease* GitHub Release if desired. No beta is currently authorized.
3. For **stable**, open `dev → main` PR after full acceptance with exact evidence; all required status checks must pass. Merge through PR only, then tag the accepted `main` commit `vX.Y.Z` and publish stable release. A branch merge is **not** itself a production deployment.
4. For a **hotfix**, branch `hotfix/<issue>` from current `main`, fix and validate the minimum change, open PR to `main`, pass all required checks, merge and create an appropriate patch stable tag. Then open a separate PR into `dev` to carry the fix forward; never silently overwrite or force-update either branch.
5. If an incident, failed CI, missing source authorization or incomplete release evidence exists, keep the candidate as PR/Draft and block release. Deployment credentials, environments, approval steps and promotion verification are separate from this repository policy.

## Administrator setup (not automatic)

The proposals live in `docs/github-rulesets/main-stable.json` and `docs/github-rulesets/dev-beta.json`. These files are **examples, not active protection**. A GitHub repository admin with **Administration: write** permissions must create corresponding active rulesets in **Settings → Rules → Rulesets** or use the GitHub REST API after checking for existing rulesets. No bypass actor should be added. Scope them exactly to `refs/heads/main` and `refs/heads/dev` respectively. Require a PR, block deletions and force pushes, resolve conversations, and require `branch-policy`, `source`, `dependencies` as shown.

**Ordering:** Merge this governance-only PR into `dev` first, then enable its protections. The design-only `dev` baseline has no R1 `source`/`dependencies` workflow, so applying those required contexts before governance is merged can block that governance PR. R1 head includes those CI jobs but currently fails the dependency gate; a required check should deliberately keep that PR unmergeable until fixed. When the first `dev → main` PR carries the checked workflow, apply equivalent stable protection before merging it. Do not disable a rule simply to get past a failing security audit.

With an authorized GitHub administrative token, inspect the current rulesets first:

```bash
gh api repos/trungtaottn/cf-agent-hub/rulesets
```

After verifying the list is empty or reconciling existing rules, create the rulesets from the reviewed JSON files using GitHub's API. Do not install a token into a repo or print it in command output. To verify, read back each ruleset and confirm `enforcement=active` and that the required check list is correct; then try a harmless non-mergeable PR from an unauthorized branch to `main` and confirm `branch-policy` fails. Also confirm direct push is rejected from a normal developer credential.

**Current access limitation:** In this environment the GitHub credential returns HTTP 403 on repository branch-protection and ruleset creation endpoints; it does not currently have Administration: write. Code push permission is not equivalent. Until an authorized admin applies the rules, these protections remain proposals.
