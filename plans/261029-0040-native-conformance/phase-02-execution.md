# Phase 2 — Execution and evidence

Status: source implementation in progress; live acceptance pending.

- [ ] Fixed built-CLI shell-free invoker; never arbitrary config command. Minimal environment excludes inherited tokens/proxies/Node loader settings. Pass only protected store/origin/workspace/input references, never bearer/proof bytes.
- [ ] Persist prepared invocation before spawn; immediately persist child ownership identity after spawn. The crash gap is explicitly unknown/no-auto-retry, not a guarantee that metadata precedes effects. Invoke the unmodified built executable without a new persistent mode. Cap output and deadline, retain terminal/unknown state. Do not assert kill/cleanup without observed close.
- [ ] Source-controlled scenario DAG maps native operations and four reachable negatives; external observer/control required for grants, foreign resource, revoke, lost response and no-send assertions.
- [ ] Explicit observation projection only; missing records remain pending, never fill with synthetic state. Candidate/composition/actor/runtime/command bindings follow issue47.
- [ ] Update package command, CLI/testing/release docs. Independent source review, focused tests, checkpoint and private backup. Live acceptance remains blocked.
