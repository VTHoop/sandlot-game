# 1. Record architecture decisions in ADRs

- Status: Accepted
- Date: 2026-06-06

## Context
This is a greenfield project built largely by AI coding agents and intended as a public portfolio piece. The most valuable thing it can demonstrate is *judgment* — not just what was built, but why. Decisions need a durable, browsable record so reviewers (and future agents) can see the reasoning and so we don't relitigate settled questions.

## Decision
We record significant decisions as Architecture Decision Records (Michael Nygard format) in `docs/adr/`, numbered sequentially.
- Created in the **same commit** as the change they describe.
- **Immutable** — never edit an accepted ADR; supersede it with a new one that references it.
- Written for: a new dependency, storage/data strategy, platform target, core abstraction, cross-cutting pattern, or IP/licensing call. Not for bug fixes, styling, or routine refactors.

Format: `Status · Date · Context · Decision · Consequences`.

## Consequences
- Reviewers get the "why" for free; this is a deliberate portfolio signal.
- Small per-change overhead; mitigated by keeping ADRs short.
- The supersession chain documents how thinking evolved over time.
