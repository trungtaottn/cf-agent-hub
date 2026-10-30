# R2 message reference authorization research

Status: Local design comparison for issue34; live acceptance pending, no released capability. Not a deployment benchmark.

## Primary code inspected before implementation

- [Zulip attachment authorization](https://github.com/zulip/zulip/blob/8bde935c5d04bec916892c39b64e17d4bbdd2eb9/zerver/lib/attachments.py): attachment-to-message links and current channel/subscription checks are useful precedents. Its owner/public/any-accessible-message routes deliberately differ from this workspace's requirement that one current coherent grant satisfy **all** existing artifact associations. Those broader bypasses were not adopted.
- [Mattermost file metadata](https://github.com/mattermost/mattermost/blob/8b2fb3709a1672973a3a1067ee044dadc96e7048/server/channels/store/sqlstore/file_info_store.go): existing post/channel linkage is not overwritten during ordinary metadata upsert. This supports retaining server-reviewed association identity, rather than accepting client object keys. It is a comparison, not proof of this implementation's authorization.

## Alternatives and selected approach

| Approach | Outcome |
| --- | --- |
| Recursive message → artifact → message checks | Rejected: natural reverse associations create cycles and repeated paths; recursion is neither a resource budget nor permission proof |
| Admission-time cached or denormalized ACL | Rejected: misses current grant/issuer/task/association revocation and would create another authority model |
| Owner/any-visible-associated-message access | Rejected: incompatible with the existing conjunction of current associations and fixed participant contract |
| Iterative current-grant graph using existing domain predicates | Selected: each distinct typed node is locally authorized, then every outgoing edge is checked; the visited set only deduplicates work |

The relationship grant contains workspace/scopes/projects and participant kind/ID, not credentials, sessions, runtime proof or an authenticated ActorContext. Actual callers are still refreshed from their own verified authority. Background participant eligibility uses the canonical current credential reader, including dynamic issuer ceilings. No scopes/projects are unioned across credentials.

## Bounded-work experiment and findings

Real Workers tests construct a SQL-shaped retained graph of256 distinct nodes (254 messages, one artifact, one task), with cyclic reverse attachment edges. The production traversal must finish with fewer than8000 observed SQLite rows read; adding a new attached message crosses the node budget and must atomically roll back while the prior graph remains readable. The fixture is a query/authorization experiment, not254 real remote deliveries.

A second production-query test uses1000 currently eligible credential candidates with the only coherent resource grant last. It asserts fewer than6000 observed rows read and an EXPLAIN plan using `credentials_live_read` with no temporary ordering B-tree. A1001st candidate does not prevent a proven early success; if the first1000 fail, the sentinel yields503. A rejected initial raw-history cap reproducibly starved a valid grant behind4000 retired/revoked rows. Independent storage review justified minimal forward migration14: a partial workspace/agent/epoch/expiry/credential index excludes disabled/revoked/retired rows and seeks past old epochs/expired rows. Production Workers query tests with4000 retained disabled rows and8000 enabled expired/other-epoch rows each assert fewer than100 physical rows read; expiry boundaries, credential rotation, restart and canonical agent revocation are checked. Neither index nor SQL eligibility replaces canonical issuer/agent/current-grant authorization. A per-pass16384 work-unit budget also covers candidates, participants, graph nodes and edges. These are bounded-work assertions, not remote latency, global memory, throughput or optimality claims.

Independent plan review caught two necessary additions: bound eligibility work beyond graph nodes, and authorize the resulting graph **after** inserting new reverse associations within the same transaction. Code review caught an aggregate-size oracle: summing hidden artifact sizes before authorizing their graph returned a distinguishable limit error. A failing test reproduced it; complete graph authorization now precedes metadata-derived aggregate checks. Further review found two retained-read seams: Task.result/history must apply the same current graph, and a successful message response must not await scheduler repair after its final projection. Both have failing actual-Workers regressions followed by fixes; submission/review remains issue35. The canonical refs-only8192-byte boundary remains unchanged; attachment IDs have their own8192-byte check, so empty attachments do not shrink valid R1 requests.
