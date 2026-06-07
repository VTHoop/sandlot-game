# 4. Data model: append-only log + authoritative state (not full event sourcing)

- Status: Accepted
- Date: 2026-06-06

## Context
We want game replays and rich derived statistics, which points toward an event log. But full event sourcing / CQRS (events as the source of truth, current state rebuilt by replaying events, projections, eventual consistency, event-schema versioning) is a notoriously hard pattern to get right — and its subtle failure modes are exactly where AI agents produce plausible-but-wrong code.

## Decision
Use the pragmatic middle, not full event sourcing:
- Keep **authoritative current-state rows** (game, lineup, bases, score) updated transactionally.
- **Append every at-bat to an immutable log** for replay and audit.
- Derive stats via **maintained rollups** updated as at-bats resolve (counters/aggregate docs), kept in sync with the log and covered by tests.
- Do **not** rebuild state by replaying events. Do **not** aggregate raw events on the client.

## Consequences
- **+** Replays, audit trail, and stats without CQRS complexity; simple invariants that agents handle reliably and that are easy to test.
- **−** Some denormalization — rollups must stay consistent with the log (enforced by tests). It is not a pure event-sourced system, which is fine: we don't need temporal state rebuilds.
