import { test } from "node:test";
import assert from "node:assert/strict";
import release from "../../release-tooling/release.config.mjs";
import { assertReleaseRef, validateRuleSet, requireSuccessfulCI } from "../../scripts/check-release-authorization.mjs";
import { checkConventionalPr } from "../../scripts/check-conventional-pr.mjs";
import { readFileSync } from "node:fs";

const policy = (branch) => JSON.parse(readFileSync(new URL("../../docs/github-rulesets/" + (branch === "main" ? "main-stable.json" : "dev-beta.json"), import.meta.url)));
const SHA = "a".repeat(40);
const run = { id: 1, head_sha: SHA, head_branch: "dev", event: "push", path: ".github/workflows/ci.yml",
  conclusion: "success", status: "completed", created_at: "2026-10-25T00:00:00Z" };
const jobs = ["source","dependencies"].map((name) => ({name,status:"completed",conclusion:"success"}));

test("semantic-release channels and GitHub-only plugins", () => {
  assert.deepEqual(release.branches, [
    { name: "main" }, { name: "dev", channel: "beta", prerelease: "beta" }
  ]);
  assert.equal(release.tagFormat, "v${version}");
  const plugins = release.plugins.map((entry) => Array.isArray(entry) ? entry[0] : entry);
  assert.deepEqual(plugins, ["@semantic-release/commit-analyzer", "@semantic-release/release-notes-generator", "@semantic-release/github"]);
  assert.equal(release.plugins[0][1].preset, "conventionalcommits");
  assert.equal(release.plugins[1][1].preset, "conventionalcommits");
});

test("only dev and main are allowed release refs", () => {
  assert.equal(assertReleaseRef("refs/heads/dev"), "dev");
  assert.equal(assertReleaseRef("refs/heads/main"), "main");
  for (const ref of ["refs/heads/feature/x", "refs/tags/v1.2.3", "", "refs/heads/hotfix/a"]) {
    assert.throws(() => assertReleaseRef(ref), /RELEASE_REF_NOT_ALLOWED/);
  }
});

test("both protected rulesets enforce required checks and no bypass", () => {
  assert.equal(validateRuleSet(policy("dev"), "dev"), true);
  assert.equal(validateRuleSet(policy("main"), "main"), true);
  assert.equal(validateRuleSet({ ...policy("dev"), bypass_actors: [{ actor_id: 1 }] }, "dev"), false);
  assert.equal(validateRuleSet({ ...policy("dev"), enforcement: "disabled" }, "dev"), false);
  assert.equal(validateRuleSet({ ...policy("dev"), conditions: {ref_name:{include:["refs/heads/dev"],exclude:["refs/heads/dev"]}} }, "dev"), false);
  assert.equal(validateRuleSet(policy("dev"), "main"), false);
});

test("stable promotion preserves merge commits to keep Conventional Commit history", () => {
  assert.deepEqual(policy("main").rules.find((r) => r.type === "pull_request").parameters.allowed_merge_methods, ["merge"]);
});

test("exact SHA source and dependency jobs are both mandatory", () => {
  assert.equal(requireSuccessfulCI([run], jobs, { branch: "dev", sha: SHA }).id, 1);
  assert.throws(() => requireSuccessfulCI([run], jobs, { branch: "main", sha: SHA }), /R1_CI_NOT_GREEN/);
  assert.throws(() => requireSuccessfulCI([run], [{ name: "source", conclusion: "success", status: "completed" }], {branch:"dev",sha:SHA}), /R1_CI_REQUIRED_JOBS/);
  assert.throws(() => requireSuccessfulCI([{...run,conclusion:"failure"}], jobs, {branch:"dev",sha:SHA}), /R1_CI_NOT_GREEN/);
  assert.throws(() => requireSuccessfulCI([{...run,head_sha:"b".repeat(40)}], jobs, {branch:"dev",sha:SHA}), /R1_CI_NOT_GREEN/);
});

test("Conventional PR titles gate feature, fix, breaking, chore", () => {
  for (const title of ["feat(ui): add dashboard", "fix: resolve mismatch", "feat!: remove old API", "docs: clarify migration", "ci: add security gate", "release: promote validated dev"]) {
    assert.equal(checkConventionalPr({base:"dev",head:"feature/test",title}).ok,true,title);
  }
  for (const title of ["update things", "Feature: hello", "feat: x", "Merge pull request #3"]) {
    assert.equal(checkConventionalPr({base:"dev",head:"feature/test",title}).ok,false,title);
  }
  assert.equal(checkConventionalPr({base:"main",head:"dev",title:"ci: promote verified dev"}).ok,true);
  assert.equal(checkConventionalPr({base:"main",head:"feature/x",title:"fix: a breaking issue"}).ok,false);
});
