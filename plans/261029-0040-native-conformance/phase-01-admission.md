# Phase 1 — Admission

Status: source implementation in progress; live acceptance pending.

- [ ] Freeze config v1: exact candidate/executable SHA, HTTPS origin, two different workspace IDs, actor/store references, fixture/output directories, positive integer finite budgets and external authority reference.
- [ ] Closed keys reject embedded tokens, URLs with userinfo/query/path/fragment, production self-classification, duplicate subjects, relative/noncanonical paths and oversized input.
- [ ] Read config through existing protected IO plus strict ancestry. Read no credential contents. Pin executable bytes before subprocess.
- [ ] Admission requires separately installed trusted integration object; config cannot name arbitrary module/command. Default entry has no live integration and fails before execution.
- [ ] Tests first for every boundary, no real network. Document source-only limitation.
