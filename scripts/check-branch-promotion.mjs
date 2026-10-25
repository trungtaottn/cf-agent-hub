// Branch promotion metadata gate. GitHub Rulesets must require the branch-policy check.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const HOTFIX = /^hotfix\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function checkBranchPromotion({ base, head, baseRepo, headRepo }) {
  if (![base, head, baseRepo, headRepo].every((value) => typeof value === "string" && value.trim() !== "")) {
    return { ok: false, reason: "Missing PR base/head repository or branch metadata." };
  }

  if (base === "main") {
    if (baseRepo !== headRepo) {
      return { ok: false, reason: "Stable promotion must originate within the same repository." };
    }
    if (head === "dev" || HOTFIX.test(head)) {
      return { ok: true, reason: "Stable promotion source is allowed." };
    }
    return { ok: false, reason: "main accepts PRs only from dev or hotfix/*." };
  }

  if (base === "dev") {
    if (head === "dev" && baseRepo === headRepo) {
      return { ok: false, reason: "dev cannot be promoted into itself." };
    }
    return { ok: true, reason: "The beta integration branch accepts reviewed PRs." };
  }

  return { ok: false, reason: "Unrecognized target branch; only main and dev are protected by this gate." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkBranchPromotion({
    base: process.env.PR_BASE,
    head: process.env.PR_HEAD,
    baseRepo: process.env.PR_BASE_REPO,
    headRepo: process.env.PR_HEAD_REPO
  });
  const prefix = result.ok ? "PASS" : "FAIL";
  const line = prefix + " branch-policy: " + result.reason;
  if (result.ok) console.log(line);
  else {
    console.error(line);
    process.exitCode = 1;
  }
}
