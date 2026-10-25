// Conventional Commit title gate for squash merges into dev and stable hotfixes.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TITLE = /^(feat|fix|perf|revert|docs|chore|ci|test|build|refactor|release)(\([a-z0-9][a-z0-9._/-]*\))?(!)?: [^\s].{2,160}$/;

export function checkConventionalPr({ base, head, title }) {
  if (typeof title !== "string" || !TITLE.test(title.trim())) {
    return { ok: false, reason: "PR title must follow Conventional Commits, e.g. feat(api): add routes or fix!: drop legacy API." };
  }
  if (base === "main" && head === "dev") {
    return { ok: true, reason: "Dev-to-main PR uses merge commit to preserve constituent Conventional Commits." };
  }
  if (base === "main" && !head?.startsWith("hotfix/")) {
    return { ok: false, reason: "Stable hotfixes must use hotfix/*; normal promotions must originate from dev." };
  }
  if (base !== "main" && base !== "dev") return { ok: false, reason: "Unsupported PR base." };
  return { ok: true, reason: "Conventional PR title accepted." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkConventionalPr({
    base: process.env.PR_BASE, head: process.env.PR_HEAD, title: process.env.PR_TITLE
  });
  (result.ok ? console.log : console.error)((result.ok ? "PASS " : "FAIL ") + result.reason);
  if (!result.ok) process.exitCode = 1;
}
