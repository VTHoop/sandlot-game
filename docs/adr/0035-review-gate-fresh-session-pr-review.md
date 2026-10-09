# 35. The review gate is a fresh-session `/pr-review`, not a per-turn challenger

- Status: Accepted
- Date: 2026-10-09
- Supersedes: [ADR-0008](./0008-automatic-code-review-protocol.md), and the review clause of [ADR-0005](./0005-engineering-process-and-quality-gates.md) ("`/code-review` agent pass"). The PR flow, squash-merge, and the Codacy and CodeScene checks stand.

## Context
ADR-0008 made the challenger the review: a read-only subagent the author spawns after every code-editing turn, which returns `LGTM` or one concern that the author then rules on. The same arrangement in the sibling Campout project (its ADR-0019) produced 9 LGTM, 6 dismissed and 3 acted on across 24 PRs, while the review that actually gated merges, `/pr-review` from a separate session, was written down nowhere.

The challenger's low yield follows from its shape:

- **The author arbitrates.** The agent that wrote the code decides whether the objection stands, so the cheap path is dismissal — the same failure ADR-0005 exists to close for tests.
- **One finding, mid-task.** It reviews half-finished work after every turn instead of the finished change against its issue.
- **It cannot grow into the real review.** Subagents cannot spawn subagents, so a review run from inside the author's turn can never be the multi-lens one.

The handoff around the real review was manual too: the owner pasted `/pr-review`'s output into the implementing session, and that session — the author again — validated the findings.

## Decision
- **The required review is `/pr-review`, run from a session that did not write the code**, once the PR is open with checks green. It reviews the whole diff against the Linear issue across six lenses, validates every Blocker and Major against the diff before reporting it, and posts its result to the PR.
- **The implementing session answers the review from the PR, not from pasted text** (`/address-review`). A finding that survived validation is presumed valid: fix it test-first, or dismiss it with evidence — a passing test, a query result, a cited line — in a PR reply. A dismissal without evidence is not a dismissal. Work outside the issue is deferred to the owner, not absorbed.
- **Fixes are re-reviewed.** `/pr-review` runs again after them. A PR merges when the latest review is Approved, or every remaining finding is either dismissed with evidence the owner accepts or deferred to a follow-up issue the owner has created. **The owner arbitrates contested dismissals and deferrals; neither agent does.**
- **The per-turn challenger is removed.** The `tdd-guard` `PostToolUse` hook remains the per-edit check: it is deterministic, which is the property a per-edit check needs.
- **The AC are the assertions.** ADR-0005 says the human owns the assertions. That is made concrete: every refined AC bullet maps to a test, the owner approves the map before the first red test (`/start-ticket`), and the PR body carries it for review.

## Alternatives considered
- **Keep the challenger, on a stronger model.** Fixes the model, not the arbitration: the author would still rule on its own reviewer.
- **Have the implementer run `/pr-review` on its own PR.** The six reviewers would be fresh, but validation and ranking would happen in the author's context — the step where a finding gets dropped.
- **A coordinator agent that drives every step.** Deferred, not rejected. It needs each step to read its inputs from durable state (Linear, the PR) first, which this ADR establishes.

## Consequences
- **+** No context grades its own work, and no dismissal leaves the PR without evidence the owner can check.
- **+** One review per PR round instead of one per turn, and no copy-paste between sessions.
- **−** Nothing reviews mid-task, so a wrong direction is caught at PR time rather than at the turn that took it. The approved AC → test map, the committed red tests and the hook narrow that window.
- **−** `/pr-review` and `/refine-ticket` are user-level skills (`~/.claude/skills/`), not in this repo; a second contributor installs them as an onboarding step.
