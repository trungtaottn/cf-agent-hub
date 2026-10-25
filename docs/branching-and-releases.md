# Branching, SemVer and beta/stable promotion

**Status (2026-10-25):** The repository has `main` and `dev` at the same design-baseline commit. [PR #89](https://github.com/trungtaottn/cf-agent-hub/pull/89) proposes this governance; GitHub Rulesets are **not yet active** because the current integration lacks `Administration: write`. [R1 PR #1](https://github.com/trungtaottn/cf-agent-hub/pull/1) targets `dev`, is Draft and fails its full dependency security gate. **No Beta or Stable release has been authorized.**

## Canonical branches and PR routing

| Ref | Purpose | Permitted inbound PR source | GitHub Release |
| --- | --- | --- | --- |
| `dev` | Reviewed integration of completed work | `feature/*`, `fix/*`, `chore/*`, `docs/*`, `hotfix/*` and other reviewed work branches | Beta prerelease only |
| `main` | Stable release baseline | Same-repo `dev` or `hotfix/*` **only** | Stable release only |
| `hotfix/*` | Critical production correction branched from `main` | PR into `main`, then a separate return PR to `dev` | Never release from hotfix directly |
| Other work branches | Isolated implementation | PR into `dev` | Never release |

The GitHub default branch remains `main`. Branches must be protected by GitHub Rulesets; a workflow-only check does not stop direct pushes or guarantee its own enforcement. No direct push, force push, deletion, administrator bypass or unreviewed merge into `dev` or `main`. Every code change after branch creation goes through a PR.

**Bootstrap:** The existing `dev` branch starts at the same SHA as `main`. Do not copy unfinished R1 work directly to `dev`: its PR remains open and blocked while its audit is failing. Governance-only changes enter `dev` through [PR #89](https://github.com/trungtaottn/cf-agent-hub/pull/89) after review.

## Semantic Versioning and Conventional Commits

The release mechanism is [semantic-release](https://semantic-release.gitbook.io/semantic-release/) with a separately pinned and audited lockfile in `release-tooling/`. No user manually edits the published version or creates a version tag. Merge work PRs into `dev` using **Conventional Commit PR titles**, particularly when using squash merges:

| Example title/commit | Version effect |
| --- | --- |
| `fix(api): handle timeout` | PATCH (`X.Y.Z+1`) |
| `perf(queue): improve polling` | PATCH |
| `feat(ui): add task view` | MINOR (`X.Y+1.0`) |
| `feat!: replace public auth API` or `BREAKING CHANGE:` footer | MAJOR (`X+1.0.0`) |
| `docs:`, `test:`, `ci:`, `chore:`, `build:` | No release by default |

Scope is optional. Breaking change release priority overrides ordinary types. The title validator rejects non-Conventional titles. Use the PR title as the squash commit message, **not** a generic `Merge PR #123` message.

Config: `release-tooling/release.config.mjs` declares `main` as stable and `dev` as `beta` prerelease channel. Examples: `v1.2.0-beta.1`, `v1.2.0-beta.2`, then `v1.2.0` when the corresponding changes reach `main`. These are illustrations, not existing releases or a promise of the initial version. Without an initial version tag, semantic-release chooses its normal initial version policy.

**Important:** `dev → main` promotion must use the GitHub **merge commit** method so all constituent `feat/fix/BREAKING CHANGE` history reaches `main`. Squashing the entire promotion PR hides those individual release-driving commits. The proposed main Ruleset therefore allows `merge` only; `dev` may use squash/rebase/merge for normal work PRs. Hotfixes also enter `main` by merge-commit PR and get back-merged to `dev` via another PR.

**Additional upstream security blocker (2026-10-25):** the pinned semantic-release 25.0.9 toolchain currently includes `@semantic-release/npm` as a transitive dependency even though this project does not use npm publishing. Its bundled `npm@11.21.1` carries affected `undici@6.29.0` and `ip-address@10.7.2` (one High, one Moderate in a fresh audit). A non-forced `npm audit fix` cannot replace those bundled copies; a compatibility experiment with `npm@12.2.1` also did not clear them. The proposed `release-toolchain` status deliberately fails until upstream publishes compatible, verified artifacts or a separately reviewed remediation is available. **Do not merge/enable the semantic-release add-on while this required gate fails.** This is separate from the R1 application toolchain advisories in #11.

The tool publishes **Git tags and GitHub Releases** (with generated release notes). It **does not publish npm packages**, commit changelog changes to protected branches or deploy Cloudflare Workers. The existing `CHANGELOG.md` is not auto-modified; GitHub Release notes are the generated changelog.

## Security, verification and release authorization

1. Require protected PRs with resolved review conversations, an up-to-date branch and these GitHub status contexts: `branch-policy`, `release-toolchain`, `source`, `dependencies` (once the R1 CI workflow exists on the integration candidates). A sole maintainer cannot self-approve; provided Ruleset examples use zero approvals without disabling PR or status checks. Increase to at least one approval when an independent reviewer is available.
2. Never weaken or suppress `npm audit --audit-level=low` to force green. The R1 published candidate currently has 5 findings in the development toolchain. See [#11](https://github.com/trungtaottn/cf-agent-hub/issues/11). A production-only audit showing zero findings does not satisfy the required full embedded/toolchain inventory.
3. Semantic Release is **disabled by default**. A repository administrator may set Actions variable `SEMANTIC_RELEASE_ENABLED=true` **only after** the rulesets and release evidence contract are reviewed. The release preflight independently reads active GitHub Rulesets and rejects an absent/disabled/bypassable rule.
4. When a release is genuinely ready, run **Actions → Semantic release (Beta / Stable) → Run workflow**, select branch `dev` or `main`, and provide `evidence_path` pointing to the actual checked-in, exact-revision R1 evidence JSON. This is a manual *authorization trigger*; semantic-release then computes the version, changelog, tag and GitHub Release automatically. A push or PR alone never publishes.
5. The release workflow checks the dispatch branch head SHA has not moved, and verifies the **same SHA** has a successful `R1 checks` **push** workflow with the `source` and `dependencies` jobs both successful. It then executes the R1 release evidence verifier, which also requires independently reviewed build, installed/embedded audit, deployment and isolated recovery evidence for those exact committed bytes. Missing evidence fails closed.
6. The release toolchain runs `npm ci --prefix release-tooling --ignore-scripts` and `npm audit --prefix release-tooling --audit-level=low`. Release jobs are separately scoped: read-only verification first, then `contents: write` only to publish tags/releases after verification; the publication token is not exposed to PR builds.
7. Release environments `beta-release` and `stable-release` are named separately. Owner can add required deployment reviewers to these environments. There is no production deployment here; a Stable GitHub Release is **not** proof that a service is running in production.

The current `scripts/verify-release.mjs` validates **R1** evidence only. Before releasing later rounds, the verifier and this workflow must be extended to cover the corresponding accepted capabilities; passing R1 alone is not acceptance of R2–R4. A version tag must never be used to imply missing acceptance.

**Initial availability:** GitHub's `workflow_dispatch` UI requires the workflow file to exist on the default branch. Promote reviewed governance through `dev → main` as a governance-only PR before attempting a dispatch, while leaving the release flag off and all incomplete R1 code in its Draft PR. This does not itself authorize a stable release.

## Ruleset activation by repository administrator

Prepared definitions (not yet installed) are `docs/github-rulesets/main-stable.json` and `docs/github-rulesets/dev-beta.json`. An owner/admin credential with GitHub **Administration: write** must install/reconcile them in **Settings → Rules → Rulesets** or via the GitHub REST API. Scope exactly to the intended `refs/heads/main` or `refs/heads/dev`, require PRs, no deletion/force push, no bypass actors, the four required status checks and conversation resolution.

**Sequencing:** merge governance PR into `dev` first, then set up its protections; the design-only baseline does not yet ship `R1 checks`. When ready for governance-only promotion `dev → main`, ensure the required contexts exist and apply main protection before accepting any stable application change. Do not relax required checks merely to merge unfinished application code.

To inspect existing rulesets with an admin-authorized connection:

```bash
gh api repos/trungtaottn/cf-agent-hub/rulesets
```

After creation, read back each ruleset and check `enforcement=active`, matching branch conditions, zero bypass actors, required checks and merge method; verify that an unauthorized source PR to `main` fails `branch-policy` and that direct developer pushes are rejected. A JSON file in the repo is **not** active enforcement. The current Cloud Harness GitHub credential returns **HTTP 403** for writes requiring repository Administration permission.
