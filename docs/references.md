# References and documentation provenance

Status: Design baseline · Contract revision 0.1 · Implementation pending.

The documents in this package are original product contracts. External sources below support platform facts, protocol targets and documentation structure. They do not establish that CF Agent Hub has implemented or passed those requirements. Web resources can change; implementation releases must retain their selected toolchain and compatibility versions.

## Structural reference

The organization was informed by [Cloud Harness documentation at revision 46f9636329e8b8735e5d7d26af0f0c359f84ef8f](https://github.com/bestagentkits/cloud-harness-mcp/tree/46f9636329e8b8735e5d7d26af0f0c359f84ef8f/docs), reviewed on 2026-10-23. Useful patterns include dedicated configuration/security/API references, explicit authority boundaries, symptom-based troubleshooting, operational recovery and architecture decisions.

Particularly relevant examples are its [configuration reference](https://github.com/bestagentkits/cloud-harness-mcp/blob/46f9636329e8b8735e5d7d26af0f0c359f84ef8f/docs/configuration.md), [system architecture](https://github.com/bestagentkits/cloud-harness-mcp/blob/46f9636329e8b8735e5d7d26af0f0c359f84ef8f/docs/system-architecture.md), [operations](https://github.com/bestagentkits/cloud-harness-mcp/blob/46f9636329e8b8735e5d7d26af0f0c359f84ef8f/docs/operations.md) and [security model](https://github.com/bestagentkits/cloud-harness-mcp/blob/46f9636329e8b8735e5d7d26af0f0c359f84ef8f/docs/security-model.md). Its runtime architecture and deployment configuration are not adopted as CF Agent Hub requirements.

## Platform sources

| Primary source | What it supports here |
| --- | --- |
| [Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) | Entity coordination boundary and separation of stateless entry from stateful ownership |
| [Cloudflare: SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | Workspace-local storage/transaction semantics and platform recovery considerations |
| [Cloudflare: Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) | At-least-once alarm delivery and scheduler design constraints |
| [Cloudflare: Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) | Version-specific class lifecycle/provisioning configuration, distinct from application SQL migrations |
| [Cloudflare: Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) | Code rollback constraints; no assumption that deployment rollback restores data |

Operational pages include additional primary links next to the specific claim. The application chooses its own state machine, scopes, retry budget and profile precedence; those are proposed design decisions rather than guarantees from Cloudflare.

## Protocols, accessibility and licensing

The [MCP reference](mcp-api.md) and [A2A reference](a2a-api.md) name their exact proposed compatibility targets and link to the versioned primary specifications. A chosen target may differ from the latest protocol release. The release must document the implemented subset, transport and authorization evidence before claiming compatibility.

[WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the primary accessibility reference for the [design guidelines](design-guidelines.md). Accessibility goals require implementation testing; a documented keyboard interaction alone is not conformance evidence.

[The Open Source Initiative's MIT license page](https://opensource.org/license/mit) identifies the license used in [LICENSE](../LICENSE). Dependency notices and asset permissions still require review in an implementation release.

## Maintaining references

Prefer primary official documentation for technical facts. Pin protocol versions and Git revisions when they materially affect behavior. A broken or changed external page must not silently change the application contract; update the relevant ADR/reference and assess compatibility. Internal links point only to files delivered in this package. No uncreated repository URL or unavailable runtime command is presented as a working installation path.
