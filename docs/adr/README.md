# Architecture decision records

Status: Design baseline · Contract revision 0.1 · Implementation pending.

These records explain the chosen design direction and alternatives. Acceptance here means the direction is part of the baseline; it does not certify an implementation or finalize every later adapter field. A material change needs a new superseding record or an explicit revision with consequences and compatibility notes.

| Record | Decision |
| --- | --- |
| [0001](0001-workspace-authority.md) | Workspace Durable Object owns coordination; execution remains external |
| [0002](0002-delivery-and-work.md) | Separate delivery, acknowledgment, execution and acceptance |
| [0003](0003-leases-and-decisions.md) | Fence leased attempts and bind human decisions to versions |
| [0004](0004-profile-and-policy.md) | Keep personalization separate from authorization and deployment |
| [0005](0005-native-contract-and-adapters.md) | Build native HTTP/CLI semantics before protocol adapters |
| [0006](0006-evidence-and-release-gates.md) | Make public capability claims depend on release evidence |

Record dates are 2026-10-23. The canonical operational contracts remain in their linked reference pages; these records explain why those contracts exist.
