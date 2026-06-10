# 8. Automatic Code Review Protocol

- Status: Accepted
- Date: 2026-06-09

## Context
AI coding agents can self-validate syntactically (lint, typecheck, tests pass) but cannot objectively assess whether their own implementation is the right one — the author grades their own work. Prior art from 0005 establishes that the human owns the assertions and agents may not weaken tests; this ADR extends that principle to the reasoning layer.

The project is written largely by AI agents in single-author sessions. Without a built-in adversarial step, agents tend toward confirmation bias: they explain why their implementation is correct rather than finding the strongest argument against it.

## Decision
After completing code edits in a turn, the agent MUST run a two-step review cycle before presenting results to the user:

1. **Challenger subagent** (`subagent_type: "challenger"`, defined at `.claude/agents/challenger.md`) — a read-only, Haiku-powered adversarial reviewer that finds the single strongest argument against the implementation and returns either `LGTM` or a single specific concern (file:line, concrete consequence).

2. **Arbitration** — the author agent evaluates the concern with its full context, rules Upheld or Dismissed with a one-sentence reason, and either implements the fix or explains why the original approach is correct.

The outcome is surfaced in a `Review Findings` block appended to the turn output so the human always sees it.

The cycle is skipped only when the turn contained no code edits (reads, searches, planning, conversation).

The challenger is scoped to artifact types: TypeScript/React code, Convex functions, engine modules, Vitest suites, Playwright specs, config files, shell scripts, and markdown workflow specs — each with tailored critique criteria.

## Consequences
- **+** Every code-editing turn has an adversarial check that the human can read; catches logic errors, edge cases, and spec contradictions before they enter review.
- **+** Haiku is fast and cheap; the overhead per turn is low.
- **+** The author is forced to articulate a ruling rather than silently ignoring a concern — the reasoning is visible in the transcript.
- **−** Adds a subagent spawn to every code-editing turn; acceptable at current scale and cadence.
- **−** Challenger has limited context (reads files, no conversation history) — it will occasionally raise concerns the author can easily dismiss. The arbitration step handles this explicitly.
