# AGENTS.md — Sandlot (working name)

A turn-based baseball strategy game: a hidden-number duel (pitcher vs. batter) resolved against attribute-sized outcome bands, wrapped in a salary-cap league. Async-first multiplayer. Built largely with AI coding agents — this file is the contract every agent (and human) follows.

> **Status:** the toolchain is wired and enforcing — Lefthook `pre-commit` (Biome + typecheck) and `pre-push` (lint, typecheck, CodeScene delta, coverage), the TDD guard hook on every `Edit`/`Write`, CI (lint · typecheck · coverage · Playwright smoke) on every PR, the CodeScene code-health ratchet after every merge to `main`, and Vitest suites across the engine, the Convex functions, and the client. Linear MCP is connected — read and write issues directly. Treat every command below as live and binding. **One caveat about what "enforcing" means:** `main` currently has *no required status checks*, so every gate below reports but none can block a merge — the discipline is human, not mechanical.

> **Inspiration & IP:** the core mechanic is adapted from the `r/baseballbythenumbers` community game (credited as prior art). Game *mechanics* are not copyrightable; we use the system, **not** anyone's brand or verbatim content. See Product Rules.

---

## 1. Development Process

### Starting a task
- Read the **Linear** issue and all comments fully (`mcp__linear__get_issue`, `mcp__linear__list_comments`). The issue is the source of truth for scope.
- Check `docs/adr/` for relevant architecture decisions before any structural choice.
- Check `docs/ARCHITECTURE.md` and `docs/ABSTRACTIONS.md` for existing structure and patterns.
- For engine/balance work: consult the private engine reference (see Product Rules — it is **not** in this repo). **Run `pnpm emit-grid` immediately** to get the current aggregate slash line before any analysis — don't hand-compute what the harness already answers exactly.
- For UI tasks: study the existing visual language and components first. **Reuse before recreating** (components, hooks, tokens).
- Post a Linear comment: `🚀 Starting: <brief approach>` (`mcp__linear__save_comment`).

### Branches & PRs (light PR flow)
- One short-lived branch per task: `feat/…`, `fix/…`, `refactor/…`. Branch off `main`.
- Open a **PR** for every change, even solo. Keep PRs small and single-purpose — the PR is the visible record of review discipline.
- The PR must show: passing check suite, `/code-review` agent pass, and green Codacy + CodeScene checks.
- Squash-merge to `main`. Delete the branch.
- **A task is not done until the PR is merged and the issue's completion comment is posted.**
- **⛔ NEVER `--no-verify`.** If a hook blocks you, read the error and fix the code — never bypass, never lower a gate.

### TDD (mandatory)
**Red → Green → Refactor → Commit.** One cycle per commit.
- **You (the human) own the assertions.** The agent must not invent the spec it grades itself against. Tests encode behavior we decided, not behavior the agent prefers.
- For bugs: write the failing regression test **first**, then fix.
- **Commit the failing test as a checkpoint** before implementing, so cheating is visible in history.
- **⛔ NEVER modify, weaken, or delete a test to make it pass.** If a test is wrong, fix it in its own commit with a stated reason.
- Drive to green without touching the committed tests; then refactor with the suite as the safety net.
- **Don't just "do TDD" procedurally** — give the agent the *contextual* test signal (which tests cover the change). Surface coverage of the touched area, not a ritual.
- **Test quality (Beck's desiderata):** Isolated · Deterministic · Fast · Behavioral · Structure-insensitive · Specific · Predictive. Fix flaky tests before anything else. Harden module boundaries with property-based tests where trivial-pass is a risk.
- Exception: pure styling/layout changes.

### Check suite (runs in CI on every PR; run locally before pushing)
```bash
pnpm lint          # Biome (format + lint); zero warnings
pnpm typecheck     # tsc --noEmit — the single best correctness signal for LLM-written code
pnpm test          # Vitest
pnpm test:coverage # Vitest v8 coverage — global threshold ≥ 80% on lines/functions/branches/statements, ratcheted
pnpm e2e:smoke     # Playwright smoke lane — must stay under 5 minutes
```
Coverage is a **release gate, not a vanity metric**: the 80% floor in `vitest.config.ts` is a ratchet that only moves upward (`thresholdAutoUpdate` stays off; the TDD guard hook blocks any edit that lowers a threshold). Clearing the floor is not the goal — meaningful coverage on critical paths (the engine, the secret-pitch flow) beats padded coverage on trivial branches.

### Code health — CodeScene (free OSS tier, public repo)
Two surfaces that answer different questions. Both are live.

**1. The PR bot — relative.** The CodeScene GitHub app posts a Code Health Review on every PR, evaluating the *change* against `main` under the "Clean Code Collective" quality-gate profile (Hotspot Goals · Code Health Decline · Low Code Health in New Code · Absent Change Patterns). Configured server-side at [the project's delta-analysis config](https://codescene.io/projects/81097/config/delta-analysis) — not from any file in this repo. **Read what it flags and address it.**

**Reproduce it locally before pushing.** The [`cs` CLI](https://codescene.io/docs/cli/index.html) is installed (`curl https://downloads.codescene.io/enterprise/cli/install-codescene-cli.sh | sh`) and runs the same analysis the bot does, using the same `CS_ACCESS_TOKEN`:

```bash
cs delta main                       # what the PR check will say — run this before pushing
cs check path/to/file.ts            # one file's code health score (1–10)
cs review path/to/file.ts           # the score plus the specific findings
cs delta --staged                   # only what's staged
```
A new file must score **10.00** to clear the "New code is healthy" gate, and per-rule deductions are fixed — a partial fix scores the same as no fix, so eliminate a flagged rule entirely rather than easing it. Do not push blind and read the bot; it is a ~60s round trip that `cs delta main` answers in seconds.

`pre-push` runs `cs delta --error-on-warnings main` for you, so a finding blocks the push. It *skips* if the CLI or token is missing rather than blocking a fresh clone — so a passing hook with neither installed means nothing was checked. Two gaps to know: `cs delta` only sees git-tracked files (fine at pre-push, everything is committed), and it compares against `main`, so it says nothing about work already merged there.

**2. The ratchet — absolute.** `.codescene-thresholds` commits a floor for the whole repo's aggregate score, enforced by `scripts/check-code-health.ts` via the `Code Health` workflow after every merge to `main` (and weekly). This exists because the PR bot stays green while the repo slides downward one acceptable PR at a time; only the aggregate catches that.

```bash
pnpm codescene:check            # grade the last analysis CodeScene ran
pnpm codescene:check --refresh  # analyse current main first, then grade (~75s)
```
Needs `CS_ACCESS_TOKEN` — a free personal token from https://codescene.io/users/me/pat, kept in `.env.local` (see `.env.example`) and stored as a GitHub Actions secret. The free OSS tier issues these and serves the full `api.codescene.io/v2` API; no paid plan required.

- **The floor only moves upward.** Raise it deliberately after a sustained improvement. **⛔ NEVER lower `.codescene-thresholds` to make a build pass** — that is the same offence as weakening a test.
- The ratchet runs *after* the merge, so it is an alarm, not a blocker: CodeScene analyses `main`, not arbitrary branches. Pre-merge enforcement is the PR bot's job.
- **Boy Scout Rule (binding, judged by eye):** every file you touch should leave more readable than you found it — smaller functions, fewer branches, clearer names. You don't need a score to know when you've made a function worse.
- **⛔ NEVER add `biome-ignore`, `// @ts-ignore`, or `as any` to dodge a finding.** Fix the code.
- **⛔ NEVER use the Suppress link CodeScene offers next to a finding.** It is one click and it is always the wrong click. `scripts/check-code-health.ts` was itself flagged (Primitive Obsession, String Heavy Function Arguments) and refactored to 10.00 instead — the fix improved the code, which is the usual outcome when the gate looks like the problem.

### Security & static analysis — Codacy (mandatory)
**What runs:** the Codacy GitHub app posts a static-analysis check on every PR, and CI uploads coverage to it. Locally, [Codacy CLI v2](https://github.com/codacy/codacy-cli-v2) is free and needs no account or token — it is installed via `brew install codacy/codacy-cli-v2/codacy-cli-v2` and configured by the committed `.codacy/codacy.yaml`.

```bash
codacy-cli install                    # once, after cloning — pulls the pinned tools
codacy-cli analyze --tool trivy       # secrets + dependency CVEs (whole repo)
codacy-cli analyze --tool opengrep src/   # security patterns, 80+ rules over TS
```
- Run both **before marking a PR ready**. They are fast (seconds) and need no network beyond the first install.
- **Always fix Critical & High findings introduced by your change** before requesting review.
- Review Medium findings: fix real defects/security issues; otherwise justify in the completion comment.
- Never silence a rule to pass — remove the finding with a small code change.
- **The local CLI is a subset of the PR bot, not a replacement.** The bot runs Codacy's server-side [`codacy-eslint`](https://github.com/codacy/codacy-eslint), which bundles `@typescript-eslint/parser` and the plugin rule sets — it analyses this repo's TypeScript properly. The CLI does not ship either:
  - Its ESLint install is bare `eslint` + a SARIF formatter, **no TypeScript parser**, yet the config `init` generates lists `**/*.ts`/`**/*.tsx` in `files:` without setting `languageOptions.parser`. Every `.ts` file then fails with `Parsing error: Unexpected token`. That's why ESLint is excluded from `.codacy/codacy.yaml` — it is a CLI config-generation bug, not a limit of Codacy itself.
  - `init` also reports *"Ignoring plugin rules. ESLint plugins are not supported yet"*, so `security/detect-object-injection` — the **Generic Object Injection Sink** this codebase hits repeatedly (see "Code conventions") — is reachable **only** through the PR check.

  Net: a clean local `trivy`/`opengrep` run does **not** imply a clean Codacy check. Read the bot.

### Code conventions
How we write code, as distinct from the gates above that catch us not doing so. Every rule here was already being followed before it was written down: the first two surfaced in review (ADR-0021 cites the first as "the project's prefer-enums convention"), the last four from a sweep for rules applied in three or more unrelated places with nothing to cite. That split is the point — **the first two are syntactic and a linter or a reviewer will catch you; the last four are architectural and nothing will.**

- **Enums over magic strings.** A finite set of internal values is a **TS string enum** (`export enum SwingType { Normal = 'normal', … }`), not an inline string-literal union. Callers get a named symbol, not a quoted string to typo. Examples: `Half`, `GameStatus`, `GroundBallResult`, `BuntResult`, `FieldSpot`, `DuelSeat`.
  - **The one exception is the Convex schema layer.** `convex/validators.ts` must express its domains as `v.union(v.literal(…))` because Convex infers the persisted types from the validators. Where a validator and an engine enum describe the same domain, **One layer owns a domain** below governs.
- **No computed member access.** Never `obj[key]` with a non-literal key — a variable index, a `for…of` over a key list. Codacy flags every one as a **Generic Object Injection Sink**. This codebase already carries ten of these workarounds; the rule is written down so the eleventh is cheap instead of a review round-trip. Three shapes cover every case:
  - **id / dynamic-key lookup** → a `ReadonlyMap`. See `src/design/duel/roster.ts` and `convex/schema.test.ts`.
  - **an exhaustive keyed table** → declare the object literal with `satisfies Record<Key, V>` so a missing key is still a compile error, then read it through a `Map` built from `Object.entries`. Exhaustiveness and injection-safety are not a trade-off. See `OUTCOME_NAMES` / `outcomeName()` in `src/design/duel/scenario.ts`.
  - **a small fixed field set** → just write the reads out, one per line. A label→accessor table only relocates the problem: `['contact', (b) => b.power]` typechecks and lies.
  - **The tell:** if you're writing `as Record<string, T>` to make an index compile, you are about to introduce this finding *and* you have just turned off type checking on that read. Both problems have the same fix — narrow the type and read the field by name.
- **Structural over remembered.** When an invariant can be expressed so that breaking it fails to compile — or so the offending code has no access path at all — express it that way instead of documenting it and trusting everyone to remember. A rule people have to remember is one that gets missed once and then lives on as a bug. Examples: `getGame` returns a discriminated union on `status` rather than one shape with nullable seats, so no screen can read a batter off a finished game (ADR-0025); the reveal's field and the commit screen's field are two components rather than one with a flag, making the divergence "structural rather than a prop nobody remembers to set" (ADR-0022); `duelCommitments` is its own table so no at-bat read path can reach it (`convex/schema.ts`); `DuelSituation` excludes both duel numbers by type, so the secret-state law holds at the seam and not merely in the UI (`src/design/duel/seatAgent.ts`); all writes go through mutations, hiding the pitch structurally rather than by policy discipline (ADR-0002).
- **Refuse rather than guess.** Authoritative state that is internally inconsistent is a bug, not an input — throw. Never default past it, optional-chain around it, or substitute a placeholder. A situation that renders but is wrong is worse than a loud failure, because the player commits a number against it. Examples: `convex/gameView.ts` throws on a live game with an empty seat, or a base holding a player that no longer exists; `convex/seed.ts` refuses rather than minting a replacement when a club has moved; the engine's transition tests pin the cases where a silent default would corrupt the out total and cascade into wrong inning flips.
- **One layer owns a domain; every mirror is guard-locked.** When two layers describe the same set of values, name one the source of truth and tie the other to it with a compile-time assertion, so the two cannot drift. Never hand-maintain the same domain in two places. The engine is the source for anything the at-bat model produces. Examples: `convex/validators.ts` mirrors the engine's outcome bands and is locked to them by an `AssertEqual` guard coercing the enum to its string values; `packages/engine/src/outcomes.ts` is the canonical band list the persisted `atBats.outcome` enum follows; `GroundBallResult` belongs to the engine with the persisted enum locked to it (ADR-0019); runner-aware base state keeps the engine as source and maps `Id<'players'>` onto it at the Convex boundary (ADR-0018).
- **Concurrency by OCC, not by mechanism.** Convex runs mutations as serializable transactions, so reading the index range you are about to write into is enough to make a race safe: the loser conflicts and retries against the row the winner wrote. Do not add uniqueness columns, locks, or a `pending`/`claimed` state to defend against a double submit — that is a second thing to keep in step for a guarantee the database already gives. Examples: the duel's at-bat ordinal (SAN-20), the provisioning upsert on `by_clerk_subject` (SAN-55), and club claiming on `by_owner` (SAN-63, ADR-0024) are the same argument on three different indexes.

### PR-readiness checklist → completion comment on the Linear issue
Before marking the issue done, post a comment covering:
- **What** was implemented (logic + UX, a few lines).
- **Tests/coverage:** commands run, final coverage on changed code.
- **CodeScene:** what the PR bot's Code Health Review flagged, and what you did about it (or "clean").
- **Codacy:** the PR check's result, plus the local `trivy` / `opengrep` runs; confirm no new Critical/High.
- **ADRs:** new/updated, or "none".
- **Docs:** updated `ARCHITECTURE.md`/`ABSTRACTIONS.md`/etc., or "none".
- **Data hygiene:** confirm no MLB data and no secret-state leaks were committed (see Product Rules).

### ADRs & docs
- ADRs live in `docs/adr/`, created **in the same commit** as the code. **Never edit an existing ADR — supersede it** with a new one.
- **When:** new dependency, storage/data strategy, platform target, core abstraction, cross-cutting pattern, IP/licensing call. **Not for:** bug fixes, styling, refactors.
- After any new Convex function/table, component/hook, data-model change, or integration: update `docs/ARCHITECTURE.md` / `docs/ABSTRACTIONS.md` in the same commit.

### Working with multiple agents
This workflow is multi-agent-ready: the writer agent and an independent reviewer/QA agent must not be the same context. Use `/code-review` (fresh subagent) for adversarial review against the issue spec — the author never grades its own work. Background loops (e.g. refactor/health bots) are assistants, **not** a substitute for fixing your own regressions before merge.

### Automatic Code Review Protocol

After completing code edits in a turn, you MUST run the following review cycle before presenting results to the user. This is not optional.

**Skip this cycle only if:** the turn contained no code edits (reads, searches, planning, or conversation only).

#### Step 1 — Spawn the Challenger
Use the Agent tool with `subagent_type: "challenger"`. The agent definition lives at `.claude/agents/challenger.md`. Provide it:
- The files you edited (paths)
- A summary of what you changed
- The **artifact type** (e.g. React component, Convex mutation/query/action, TypeScript engine module, Vitest test suite, Playwright spec, config file, markdown workflow spec)

The challenger is read-only (no Edit/Write) and will return either `LGTM` or a single specific concern.

#### Step 2 — Arbitrate yourself
Evaluate the challenger's concern directly. You have full context the challenger does not. Rule on:
1. Is the concern valid and worth addressing?
2. If yes: what specifically should change and why?
3. If no: why is the original approach correct?

#### Step 3 — Act on the ruling, then output a findings summary
- If you sided with the challenger: implement the fix immediately.
- If you sided with your original approach: note why the concern was dismissed.

Then present your work to the user followed by a **Review Findings** block in this format:

```
---
**Review Findings**
- **Challenger:** [one sentence — the concern raised]
- **Ruling:** Upheld / Dismissed
- **Reason:** [one sentence — why]
- **Action:** [what was changed, or "none"]
---
```

---

## 2. Product Rules

### IP & data hygiene (cardinal)
- **NEVER commit MLB player data, names, or statistics to this public repo.** Real data is fetched at runtime/build into local/ignored storage. (MLB/MLBPA data is licensed; the free MLB Stats API is non-commercial/non-bulk — fine for private play, not for redistribution.)
- **The reverse-engineered source calculator and its verbatim tuned tables are PRIVATE reference only — they do not live in this repo.** They exist to understand the mechanic's *structure*. **The shipped engine's balance is independently derived via our simulation harness and validated against public MLB rate baselines** — not copied from any third-party spreadsheet.
- Credit `r/baseballbythenumbers` as inspiration in docs; never use its name or content as our brand.

### Game integrity (cardinal)
- **The pitch is secret. The server is the vault.** The pitcher's number is written by a Convex **mutation** and must NEVER be returned by any client query before the swing is locked. Resolution runs in a server function that reads both numbers, calls the engine, writes the result, appends to the at-bat log, and updates state. Any code path that could expose the pitch to the opposing client is a release-blocking bug — **add a test asserting the batter cannot read the pitch.**
- The server is the authoritative referee: clients never resolve at-bats, and never write game state directly — all writes go through mutations.

### UI
- **Use shadcn/ui components.** No raw HTML form controls for user-facing UI (`<input>`, `<select>`, `<button>`, native date pickers). Search `src/components/` for an existing component before building a new one. New UI must feel native to the app — if it looks like a browser default, it's wrong.

---

## 3. Reference

### Stack
- **Backend / data / realtime:** **Convex** — TS server functions (queries/mutations/actions), reactive subscriptions (realtime for free), scheduled functions (weekly stat ingest + turn reminders). **Mutations are the authoritative writer and the secret vault.** Document-relational; data aggregation is **TypeScript (testable), not SQL**.
- **Auth:** **Clerk** (first-party Convex integration; free at our scale). *[overridable]*
- **Engine:** pure, framework-free TypeScript package — imported into Convex functions (authoritative resolution) AND the client (read-only odds/near-miss previews). One engine, shared.
- **Client (beta):** TypeScript · React + Vite **PWA**, mobile-first · shadcn/ui · Convex reactive client (+ optional `@convex-dev/react-query`). Hosted on **Cloudflare Pages**.
- **Notifications (beta):** **web push (VAPID)** via the PWA — acceptable at this scale (~half the family on Android, where web push is solid; iOS users guided through Add-to-Home-Screen manually). Email/SMS available as a fallback if needed.
- **Future (if it grows):** Expo/React Native native app + real APNs/FCM push (Convex push component), when reliable cross-platform push matters at scale. Engine + Convex backend port over; only the UI shell is rebuilt.
- **Data shape:** append-only at-bat log + authoritative current-state rows (**NOT full event sourcing**); stats via maintained rollups, aggregated in TS. Never aggregate raw events on the client.

### Diagrams
Prefer Mermaid (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`). ASCII only for spatial wireframes.
