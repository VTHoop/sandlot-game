# AGENTS.md — Sandlot (working name)

A turn-based baseball strategy game: a hidden-number duel (pitcher vs. batter) resolved against attribute-sized outcome bands, wrapped in a salary-cap league. Async-first multiplayer. Built largely with AI coding agents — this file is the contract every agent (and human) follows.

> **Status:** foundation in progress. The toolchain (package.json, configs, hooks) lands with `docs/adr/0001-*`. Commands below are the committed target; treat anything not yet wired as the spec to wire, not as already-passing.

> **Inspiration & IP:** the core mechanic is adapted from the `r/baseballbythenumbers` community game (credited as prior art). Game *mechanics* are not copyrightable; we use the system, **not** anyone's brand or verbatim content. See Product Rules.

---

## 1. Development Process

### Starting a task
- Read the **Linear** issue and all comments fully. The issue is the source of truth for scope.
- Check `docs/adr/` for relevant architecture decisions before any structural choice.
- Check `docs/ARCHITECTURE.md` and `docs/ABSTRACTIONS.md` for existing structure and patterns.
- For engine/balance work: consult the private engine reference (see Product Rules — it is **not** in this repo).
- For UI tasks: study the existing visual language and components first. **Reuse before recreating** (components, hooks, tokens).
- Post a Linear comment: `🚀 Starting: <brief approach>`.
- **Health pre-check:** run the CodeScene MCP code-health score against `.codescene-thresholds`. If already below the gate, **refactor first**, commit, then start. Never start feature work on a codebase that's already below the bar.

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
pnpm test:coverage # Vitest v8 coverage — NEW-code threshold ≥ 80%, ratcheted
pnpm e2e:smoke     # Playwright smoke lane — must stay under 5 minutes
```
Coverage is a **release gate, not a vanity metric**: gate on new/changed code (~80%), ratchet only upward (`thresholdAutoUpdate: false`). Don't chase a high global %; meaningful coverage on critical paths (the engine, the secret-pitch flow) beats padded coverage on trivial branches.

### Code health — CodeScene (mandatory; free OSS tier, public repo)
- Pre-commit/pre-push and the PR check enforce **Hotspot** and **Average** Code Health ≥ `.codescene-thresholds`.
- Thresholds are a **ratchet — only go up.** When remote scores improve, update `.codescene-thresholds` and commit the new floor.
- **Boy Scout Rule:** every file you touch leaves with a *higher* score; if it was already `10.0`, it stays `10.0`. Every **new** scorable file must reach `10.0` (or zero findings if unscorable).
- **Before editing a file:** capture its file-level score. **After:** re-check and verify it improved/held.
- **⛔ NEVER edit `.codescene-thresholds` downward. NEVER add `eslint-disable`, `// @ts-ignore`, or `as any` to dodge a finding.** Fix the code.
- Access order: CodeScene MCP → `cs` CLI → CodeScene API (`CODESCENE_PAT` + `CODESCENE_PROJECT_ID`).

### Security & static analysis — Codacy (mandatory)
- Run **Codacy Guardrails** (MCP, or `.codacy/cli.sh analyze <path>`) on every touched file before a PR is marked ready.
- **Always fix Critical & High findings introduced by your change** before requesting review.
- Review Medium findings: fix real defects/security issues; otherwise justify in the completion comment.
- Never silence a rule to pass — remove the finding with a small code change.

### PR-readiness checklist → completion comment on the Linear issue
Before marking the issue done, post a comment covering:
- **What** was implemented (logic + UX, a few lines).
- **Tests/coverage:** commands run, final coverage on changed code.
- **CodeScene:** before/after touched-file scores; final Hotspot & Average pass `.codescene-thresholds`.
- **Codacy:** scan summary; confirm no new Critical/High.
- **ADRs:** new/updated, or "none".
- **Docs:** updated `ARCHITECTURE.md`/`ABSTRACTIONS.md`/etc., or "none".
- **Data hygiene:** confirm no MLB data and no secret-state leaks were committed (see Product Rules).

### ADRs & docs
- ADRs live in `docs/adr/`, created **in the same commit** as the code. **Never edit an existing ADR — supersede it** with a new one.
- **When:** new dependency, storage/data strategy, platform target, core abstraction, cross-cutting pattern, IP/licensing call. **Not for:** bug fixes, styling, refactors.
- After any new Supabase function/table, component/hook, data-model change, or integration: update `docs/ARCHITECTURE.md` / `docs/ABSTRACTIONS.md` in the same commit.

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
- **Quality:** Biome · tsc · Vitest (v8 coverage) · Playwright · Codacy · CodeScene · Lefthook (git hooks)
- **PM:** Linear (roadmap & issues). Package manager: pnpm.

### Key paths
- `docs/adr/` — architecture decisions (the "why")
- `docs/ARCHITECTURE.md`, `docs/ABSTRACTIONS.md` — the "what" and "how"
- `docs/ROADMAP.md` — Linear roadmap mirror
- engine package — the at-bat resolution core + Monte Carlo harness (balance validator + price derivation)

### Diagrams
Prefer Mermaid (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`). ASCII only for spatial wireframes.
