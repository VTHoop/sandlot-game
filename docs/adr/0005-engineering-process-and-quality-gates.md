# 5. Engineering process & quality gates

- Status: Accepted
- Date: 2026-06-06

## Context
The codebase is written largely by AI agents and is public. We want automation trustworthy enough to put our name on, and we want the discipline itself to be a visible portfolio signal — while staying proportionate to a small project (no enterprise tooling theater).

## Decision
The full contract lives in `AGENTS.md`. Key points:
- **TDD mandatory** — red → green → refactor, one cycle per commit, failing regression test first for bugs. **The human owns the assertions**; agents may not weaken or delete tests to pass; commit the failing test as a checkpoint.
- **Light PR flow** — a PR per task (even solo), with the `/code-review` agent plus Codacy and CodeScene checks visible in PR history; squash-merge to `main`.
- **Quality gates:** ratcheting **CodeScene** code-health + **Codacy Guardrails** security (free OSS tiers, since the repo is public), and **Vitest** new-code coverage. Never bypass (`--no-verify`) or lower a gate.
- **Linear** for issues/roadmap; completion comment per issue. **Public repo.**
- **Proportionality:** we deliberately **defer** Codecov and SonarQube until team size / scale warrant them — documented here rather than adopted prematurely.

## Consequences
- **+** Trustworthy agent output, a browsable review trail, and a strong "deliberate judgment" signal.
- **−** Per-change overhead (justified); CodeScene/Codacy need one-time OSS-account setup (free for public repos).
