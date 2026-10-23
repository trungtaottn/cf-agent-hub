# ADR 0005: Native domain contract before adapters

Status: Accepted design direction · Contract revision 0.1 · Implementation pending.

## Context

Different agent clients use different protocols. Implementing independent task rules in each adapter would create divergent permissions, errors and completion semantics. Protocol availability can also be confused with the existence of a running background agent.

## Decision

Use native HTTP commands and a shared client contract as the foundation for the CLI and adapters. Implement the initial MCP adapter over that contract using STDIO. Treat remote MCP authorization and A2A as separately gated extensions with exact compatibility targets, supported subsets and negative tests.

Adapters translate requests and results, propagate request context and preserve workspace scope. They do not create additional authority, infer human approval or hold a private task database. Connection/session presence remains distinct from runtime enrollment and execution scheduling.

## Alternatives considered

Using a protocol as the sole domain model can ease one client's integration but couples product state to that protocol's lifecycle. Exposing every internal route directly as a tool can widen permissions and create misleading human-only operations. Shipping multiple full protocol stacks at once increases contract and operational risk before native behavior is proven.

## Consequences and evidence

The first native API may be more explicit than a generic tool gateway, but clients share one observable behavior. Protocol-specific features can be deferred honestly. Conformance claims require actual tests against the pinned target and a declared feature subset; documentation alone is insufficient.

See [HTTP API](../http-api.md), [CLI](../cli.md), [MCP API](../mcp-api.md) and [A2A API](../a2a-api.md). Release review must compare authorization, replay and task mapping across each exposed surface.
