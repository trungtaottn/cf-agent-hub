import { test } from "node:test";
import assert from "node:assert/strict";
import release from "../../release-tooling/release.config.mjs";
import { analyzeCommits } from "../../release-tooling/node_modules/@semantic-release/commit-analyzer/index.js";

const config = release.plugins[0][1];
const logger = { log() {} };
async function kind(message) {
  return analyzeCommits(config, { cwd: "release-tooling", commits: [{ hash: "a".repeat(40), message }], logger });
}

test("Conventional Commits choose patch/minor/major and skip docs", async () => {
  assert.equal(await kind("fix(api): prevent duplicate writes"), "patch");
  assert.equal(await kind("perf(queue): reduce transaction latency"), "patch");
  assert.equal(await kind("feat(ui): add Kanban view"), "minor");
  assert.equal(await kind("feat!: remove deprecated auth API"), "major");
  assert.equal(await kind("fix(core): support tokens\n\nBREAKING CHANGE: old tokens rejected"), "major");
  assert.equal(await kind("docs: clarify workflows"), null);
  assert.equal(await kind("chore: change release docs"), null);
});
