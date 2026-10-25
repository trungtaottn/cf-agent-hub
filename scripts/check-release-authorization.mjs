// Fail-closed preflight for an operator-requested GitHub semantic release.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_CONTEXTS = new Set(["branch-policy", "source", "dependencies", "release-toolchain"]);
const REQUIRED_RULES = new Set(["pull_request", "deletion", "non_fast_forward", "required_status_checks"]);

export function assertReleaseRef(ref) {
  if (ref === "refs/heads/dev") return "dev";
  if (ref === "refs/heads/main") return "main";
  throw Error("RELEASE_REF_NOT_ALLOWED: only dev or main can release");
}

export function validateRuleSet(rule, branch) {
  if (!rule || rule.target !== "branch" || rule.enforcement !== "active") return false;
  if (!Array.isArray(rule.bypass_actors) || rule.bypass_actors.length) return false;
  const names = rule.conditions?.ref_name?.include;
  if (!Array.isArray(names) || !names.includes("refs/heads/" + branch) ||
      !Array.isArray(rule.conditions?.ref_name?.exclude) || rule.conditions.ref_name.exclude.length) return false;
  const types = new Set((rule.rules ?? []).map((item) => item.type));
  if (![...REQUIRED_RULES].every((type) => types.has(type))) return false;
  const statusParameters = rule.rules.find((item) => item.type === "required_status_checks")?.parameters;
  if (statusParameters?.strict_required_status_checks_policy !== true) return false;
  const checks = statusParameters.required_status_checks;
  if (!Array.isArray(checks) || ![...REQUIRED_CONTEXTS].every((name) => checks.some((item) => item.context === name))) return false;
  const reqPr = rule.rules.find((item) => item.type === "pull_request")?.parameters;
  if (reqPr?.required_review_thread_resolution !== true) return false;
  if (branch === "main" && (reqPr.allowed_merge_methods?.length !== 1 || reqPr.allowed_merge_methods[0] !== "merge")) return false;
  return true;
}

export function requireSuccessfulCI(runs, jobs, { branch, sha }) {
  const candidates = runs
    .filter((run) => run.head_sha === sha && run.head_branch === branch && run.event === "push" &&
      run.path === ".github/workflows/ci.yml")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!candidates.length || candidates[0].conclusion !== "success" || candidates[0].status !== "completed") {
    throw Error("R1_CI_NOT_GREEN_FOR_EXACT_SHA");
  }
  if (!Array.isArray(jobs) || !["source", "dependencies"].every(
    (name) => jobs.some((job) => job.name === name && job.status === "completed" && job.conclusion === "success")
  )) throw Error("R1_CI_REQUIRED_JOBS_NOT_SUCCESSFUL");
  return candidates[0];
}

async function api(path, token, apiUrl) {
  const response = await fetch(apiUrl.replace(/\/$/, "") + path, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) throw Error("GITHUB_READ_FAILED_HTTP_" + response.status);
  return response.json();
}

export async function checkReleaseAuthorization(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") throw Error("RELEASE_REQUIRES_EXPLICIT_DISPATCH");
  const branch = assertReleaseRef(env.GITHUB_REF);
  const repo = env.GITHUB_REPOSITORY;
  const sha = env.GITHUB_SHA;
  const token = env.GITHUB_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "") ||
      !/^[0-9a-f]{40}$/.test(sha ?? "") || !token) throw Error("RELEASE_CONTEXT_INCOMPLETE");
  const apiUrl = env.GITHUB_API_URL || "https://api.github.com";
  const prefix = "/repos/" + repo;
  const [remote, summaries, runsResult] = await Promise.all([
    api(prefix + "/git/ref/heads/" + branch, token, apiUrl),
    api(prefix + "/rulesets", token, apiUrl),
    api(prefix + "/actions/workflows/ci.yml/runs?branch=" + branch +
      "&event=push&head_sha=" + sha + "&per_page=100", token, apiUrl)
  ]);
  if (remote.object?.sha !== sha) throw Error("RELEASE_BRANCH_MOVED_SINCE_DISPATCH");
  if (!Array.isArray(summaries)) throw Error("PROTECTION_READ_FAILED");
  const matching = [];
  for (const summary of summaries) {
    if (summary.target !== "branch" || summary.enforcement !== "active") continue;
    const detail = await api(prefix + "/rulesets/" + summary.id, token, apiUrl);
    if (validateRuleSet(detail, branch)) matching.push(detail.id);
  }
  if (!matching.length) throw Error("REQUIRED_GITHUB_RULESET_IS_NOT_ACTIVE");
  const runs = runsResult.workflow_runs ?? [];
  const run = runs
    .filter((item) => item.head_sha === sha && item.head_branch === branch &&
      item.event === "push" && item.path === ".github/workflows/ci.yml")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!run) throw Error("NO_EXACT_R1_CI_PUSH_RUN");
  const jobResult = await api(prefix + "/actions/runs/" + run.id + "/jobs?per_page=100", token, apiUrl);
  requireSuccessfulCI(runs, jobResult.jobs, { branch, sha });
  return { branch, sha, ciRunId: run.id, activeRuleSets: matching };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkReleaseAuthorization().then((result) => {
    console.log("RELEASE_AUTHORIZED_TO_VERIFY_EVIDENCE", JSON.stringify(result));
  }).catch((error) => {
    console.error("RELEASE_BLOCKED", error.message);
    process.exitCode = 1;
  });
}
