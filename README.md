# Sandlot

A turn-based baseball strategy game: pitcher and batter each secretly commit a number, and the distance between them lands in an outcome band whose width is set by the two players' attributes. It is written largely by AI coding agents.

The game is the substrate. What this repo is actually about is the system around it — a set of guardrails that are *enforced by files in the repo*, not by good intentions, built on one principle: **no author grades its own work.** Everything claimed below is a file you can open.

## Guardrails

### Nothing merges on the author's own say-so

Five layers see a change before it lands on `main`, and the agent that wrote it is none of them.

| Layer | Mechanism | What it catches |
|---|---|---|
| **1. In-loop, pre-commit** | [`challenger`](.claude/agents/challenger.md) — a read-only adversarial subagent spawned after every code-editing turn | Logic errors, edge cases, and contradictions with the contract, *before* the code is committed |
| **2. Commit / push** | [Lefthook](lefthook.yml) — Biome + typecheck on staged files at commit; lint, typecheck, and coverage at push | Type errors, lint violations, and failing or under-covered tests, before anything reaches the remote |
| **3. CI** | [GitHub Actions](.github/workflows/ci.yml) on every PR — lint, typecheck, coverage, plus a separate Playwright smoke job | Anything that passed locally by accident: stale lockfile, env drift, a client that crashes on mount |
| **4. PR review** | Codacy, CodeScene, and CodeRabbit apps, all three on every PR | Security and static-analysis findings, code-health regressions, and a full reading of the diff by reviewers with no stake in it |
| **5. Merge** | A human. PRs are mandatory on `main` via branch protection; squash-merge | Everything the other four are structurally unable to judge — whether this was the right thing to build |

Layer 1 is the unusual one. The challenger has `Read`/`Grep`/`Glob`/`Bash` and no ability to edit; it returns either `LGTM` or exactly one finding, because a reviewer that produces a list of three has produced none. The author agent then has to rule on the record — Upheld or Dismissed, with a reason — in a `Review Findings` block printed to the human. The protocol is in [AGENTS.md](AGENTS.md#automatic-code-review-protocol); the reasoning is in [ADR-0008](docs/adr/0008-automatic-code-review-protocol.md).

### Test integrity is a hook, not a promise

The characteristic failure of agent-written code isn't a bug. It's an agent quietly deleting the test that caught the bug.

So that isn't left to the agent's judgment. A `PostToolUse` hook ([`.claude/settings.json`](.claude/settings.json) → [`.claude/hooks/tdd-guard.sh`](.claude/hooks/tdd-guard.sh)) runs on every `Edit` and `Write` and fails the turn when the file it just touched shows any of:

- `.skip` or `.only` added to a test
- a test case or `describe` block removed
- assertions net-removed from a test file
- a coverage threshold lowered or deleted

The hook also knows the one legitimate exception: folding individual cases into an `it.each` table genuinely reduces the literal count of both test blocks and `expect` calls. So a *real* parametrize refactor — an added `.each` **and** a removed `it()`/`test()` in the same diff — is exempt from the two count gates, and never from the `skip`/`only` gate or the coverage ratchet.

Above the hook sits the rule a hook can't check, in [AGENTS.md](AGENTS.md): **the human owns the assertions.** Agents don't invent the spec they grade themselves against, the failing test is committed as a checkpoint before the implementation so that cheating is visible in `git` history, and a test is never weakened to make it pass.

### Where the gates actually stand

Stating this precisely matters more than making it sound impressive:

- **Coverage** — 80% on lines, functions, branches, and statements ([`vitest.config.ts`](vitest.config.ts)), enforced at push and in CI. It's a ratchet: `AGENTS.md` forbids lowering it and the TDD hook blocks the edit.
- **Codacy** — reviews every PR. CI additionally uploads `lcov`, in a step conditional on `CODACY_PROJECT_TOKEN`; the token is set on this repo, so the upload runs, but note the step is written to skip rather than fail if it ever isn't.
- **CodeScene** — reviews every PR, but **the code-health ratchet is not yet enforcing anything.** [`.codescene-thresholds`](.codescene-thresholds) is still zeroed, deferred until enough hotspot history exists for the composite score to mean something. `AGENTS.md` describes the intended ratchet; read it as the target, not a live gate.
- **`e2e:smoke`** is CI-only by design — it needs Convex and Clerk credentials, so it's deliberately kept out of `pre-push` ([`lefthook.yml`](lefthook.yml)).
- **`--no-verify` is never used.** A blocking hook means the code is wrong, not the gate.

### One contract, any tool

[AGENTS.md](AGENTS.md) is the whole working agreement — process, TDD rules, product invariants, stack — written against the cross-tool convention rather than any one vendor's. [CLAUDE.md](CLAUDE.md) is three lines pointing at it, so Claude Code picks it up automatically without a second copy of the rules drifting out of sync. Onboarding another agent tool means adding another pointer, not another rulebook.

## The game and its architecture

Three decisions shape the code. Each has an ADR; [`docs/adr/`](docs/adr/) has the rest.

**Convex mutations are the authoritative writer and the secret vault.** Clients never resolve an at-bat and never write game state. While one side has committed a number and the other hasn't, the read query returns only `pitchCommitted` / `swingCommitted` booleans — never the number itself ([`convex/atBat.ts`](convex/atBat.ts)). That invariant is release-blocking, so it's pinned by tests asserting each side cannot read the other's number before the swing locks ([`convex/atBat.test.ts`](convex/atBat.test.ts)).

**One engine, two contexts.** [`@sandlot/engine`](packages/engine/) is pure, framework-free TypeScript — no React, no Convex SDK, no DOM. Convex imports it as the authoritative resolver; the client imports the same code for read-only odds previews. It compiles under its own `lib: ES2022` tsconfig, so reaching for a DOM API is a build error at the package boundary rather than a runtime surprise on the server ([ADR-0009](docs/adr/0009-engine-workspace-package.md)).

**Append-only log plus authoritative state — deliberately not event sourcing.** Every at-bat appends to an immutable log; current state lives in rows updated transactionally; stats come from maintained rollups. State is never rebuilt by replay. [ADR-0004](docs/adr/0004-data-model-append-only-log-plus-state.md) is explicit about why: full CQRS has subtle failure modes that are exactly where AI agents produce plausible-but-wrong code.

On IP: the core mechanic is adapted from the `r/baseballbythenumbers` community game, credited as prior art. The shipped engine's balance is derived independently through a Monte Carlo harness and validated against public league-average rate baselines. No third-party tables and no player data live in this repo ([ADR-0006](docs/adr/0006-ip-branding-and-data-sourcing.md)).

## Where it stands

The engine and the Convex layer are built and tested — at-bat resolution, ground-ball and bunt sub-resolution, runner advancement, the balance harness, the schema, the secret commit/resolve round-trip, and the game state machine. The React client is still a shell: [`src/App.tsx`](src/App.tsx) renders a title plus a parked, URL-only `/design` route. [`docs/ROADMAP.md`](docs/ROADMAP.md) has the order of work.

## Running it locally

Node 24 ([`.nvmrc`](.nvmrc)) and pnpm.

```bash
pnpm install
npx convex dev   # provisions the dev deployment; writes VITE_CONVEX_URL to .env.local
pnpm dev
```

The check suite — the same commands CI runs:

```bash
pnpm lint          # Biome (format + lint)
pnpm typecheck     # tsc -b, plus the Convex tsconfig
pnpm test          # Vitest
pnpm test:coverage # Vitest + v8 coverage, 80% threshold
pnpm e2e:smoke     # Playwright smoke lane (Chromium)
```

Two engine CLIs support balance work — `pnpm emit-grid` walks the full attribute grid and prints the aggregate slash line, and `pnpm derive-balance` reproduces that aggregate from the committed seed tables and checks it against the public rate-baseline tolerance gates.

Environment: copy [`.env.example`](.env.example). `VITE_CONVEX_URL` is written by `npx convex dev`; `VITE_CLERK_PUBLISHABLE_KEY` comes from the Clerk dashboard; `CLERK_ISSUER_URL` and `SANDLOT_DEV_SEED` are set on the Convex deployment itself via `npx convex env set`. The smoke lane needs the two `VITE_` values.

Nothing in the app creates a game yet, so a fresh deployment gives the Convex functions nothing to act on. A dev-only fixture seed mints one — two invented clubs, their rosters, and a scheduled game:

```bash
npx convex env set SANDLOT_DEV_SEED true   # dev deployments only
npx convex run seed:bootstrapDevLeague     # prints the new game's id
```

It refuses to run without that flag, and it is an internal mutation, so no browser client can reach it in any deployment. Re-running appends another game between the same two clubs.

Once a club has been claimed by a real signed-in user, `bootstrapDevLeague` refuses — it finds its clubs by owner and will not mint duplicates. Mint further games from the two club ids instead, which asks nothing about ownership:

```bash
npx convex run seed:mintDevGame '{"homeTeam":"<id>","awayTeam":"<id>"}'
```
