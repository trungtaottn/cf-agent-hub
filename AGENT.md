# Agent instruction entry point

Status: Compatibility pointer pending review and merge; repository release and policy enforcement remain pending.

The canonical repository-wide instructions for human-directed coding agents and automation agents are in [AGENTS.md](AGENTS.md). **Read that file in full before modifying code, issues, Git refs, CI, or release state.**

This singular `AGENT.md` file intentionally defines **no independent or competing rules**. Update only `AGENTS.md` when policies, architecture navigation, Git branches, issue handoffs, verification gates, or release procedures change.

The product-level contract describing external AI agents connected **to CF Agent Hub** is [docs/agents.md](docs/agents.md); those runtime actors are different from repository-contributor agents.
