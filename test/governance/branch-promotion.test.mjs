import assert from "node:assert/strict";
import test from "node:test";
import { checkBranchPromotion } from "../../scripts/check-branch-promotion.mjs";

const baseRepo = "example/cf-agent-hub";
const check = (base, head, headRepo = baseRepo) =>
  checkBranchPromotion({ base, head, baseRepo, headRepo });

test("main accepts dev from the same repository", () => {
  assert.equal(check("main", "dev").ok, true);
});

test("main accepts hotfix/<ticket> from the same repository", () => {
  assert.equal(check("main", "hotfix/critical-auth").ok, true);
  assert.equal(check("main", "hotfix/security/patch-1").ok, true);
});

test("main rejects feature, fix, and ordinary development branches", () => {
  for (const head of ["feature/r1", "fix/login", "chore/toolchain", "main", "hotfix"]) {
    assert.equal(check("main", head).ok, false, head);
  }
});

test("main rejects lookalike dev or hotfix branches from forks", () => {
  assert.equal(check("main", "dev", "untrusted/cf-agent-hub").ok, false);
  assert.equal(check("main", "hotfix/critical-auth", "untrusted/cf-agent-hub").ok, false);
});

test("dev accepts feature PRs and external contributions", () => {
  assert.equal(check("dev", "feature/r1").ok, true);
  assert.equal(check("dev", "fix/security", "untrusted/cf-agent-hub").ok, true);
});

test("dev permits main to be synchronized back only through a PR", () => {
  assert.equal(check("dev", "main").ok, true);
});

test("dev rejects an impossible same-repository self-PR", () => {
  assert.equal(check("dev", "dev").ok, false);
});

test("missing input and unrelated targets fail closed", () => {
  assert.equal(check("main", "dev", "").ok, false);
  assert.equal(check("release", "dev").ok, false);
  assert.equal(checkBranchPromotion({ base: "main", head: "", baseRepo, headRepo: baseRepo }).ok, false);
});
