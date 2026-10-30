# R2 recovery ordering — approved additive amendment

Status: Plan correction approved; implementation and acceptance pending and blocked; no released capability is claimed.

This amendment supersedes only the final sentence of the historical R2 plan Task12 restore step in `docs/superpowers/plans/2026-10-23-r2-durable-work.md` that says delivery remains paused throughout task/review verification. The historical plan and its review/digest files remain byte-for-byte unchanged. All other requirements remain in force.

Approved ordering: keep the existing shared maintenance gate closed during capture/restore verification and historical-effect reconciliation without redrive. Current ledger, source retirement, fresh probe, exclusive cutover and resolved historical effects are prerequisites for explicit resume. Then explicitly resume the same shared gate; only after the accepted resume receipt perform fresh runtime/task/Review/independent-Done checks. Normal post-resume admission and delivery scheduling are not paused. No dispatch-only pause gate, auto-resume, automatic historical redrive, hold clearing or new recovery authority is approved.

This reconciles the current source: `src/workspace/commands.ts` denies domain commands while maintenance is closed; `src/recovery/controls.ts` opens admission and repairs scheduling on explicit resume; `src/outbox/dispatcher.ts` uses that same admission gate. It does not authorize execution, deploy, release, credentials or live effects. Hard #17 and unresolved D1/D2/D3/D-HISTORY/D-JOURNAL remain.

Propagate this same bounded wording to issue49's body only with the reviewed exact-text publication patch; preserve all other issue content. The standalone task49 plan, aggregate phase05 and evergreen backup/restore note carry the same ordering. Fresh post-correction review remains required.
