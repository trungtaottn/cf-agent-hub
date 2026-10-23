# Security reporting

Status: Design baseline 0.1 · No released runtime or supported deployment claimed.

This package documents a proposed security model. It has no runtime security certification, supported-version schedule or service-response commitment. Read [the security model](docs/security-model.md) for required implementation boundaries and [the release checklist](docs/release-checklist.md) for evidence required before publication of a runtime release.

## Reporting a concern

For a documentation inconsistency without exploit details or sensitive information, use the eventual repository's normal contribution channel. For a vulnerability affecting an implementation, use the private security reporting channel advertised by that repository. Such a channel must be configured and verified before the first runtime release. This package does not invent an email address or an unconfigured reporting URL.

A useful private report includes the affected release or contract revision, expected and observed behavior, the relevant trust boundary, reproduction steps using synthetic data, the impact and any known mitigation. Include request IDs and redacted logs if relevant. Do not post working credentials, private workspace data, live invitation links or another person's artifacts in a public issue.

## Operator response

If an incident affects a live deployment, its operator should contain the affected credential or ingress route, preserve minimal audit evidence, assess workspace scope and follow the incident procedures in [operations](docs/operations.md). Revoke and rotate exposed tokens; deleting a log line does not invalidate a credential. Avoid automatic replay of unknown external effects during recovery.

## Release requirement

Before claiming a supported runtime, maintainers must publish the supported versions, private report channel, ownership of triage and disclosure process. They must demonstrate workspace-isolation denials, token revocation, human approval binding, independent result review, webhook egress enforcement and safe restoration. These are requirements awaiting evidence, not claims of controls already deployed.
