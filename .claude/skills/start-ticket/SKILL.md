---
name: start-ticket
description: Begin implementing a Sandlot Linear issue from a clean, current base. Fetches origin, branches off origin/main, reads the issue and every comment, reads the ADRs and docs it touches, finds the tests that already cover the area, and stops for the owner's go-ahead on an AC → test plan before writing any code. Use at the start of every implementation session, e.g. /start-ticket SAN-43.
argument-hint: <SAN-XX or Linear URL>
---

# Purpose
Every implementation session used to open with the same hand-typed preamble — pull main, read AGENTS.md, read the issue, branch off main — and it was occasionally missed. This skill is that preamble, made a procedure. It ends at a checkpoint, not at code: the owner approves which test proves which AC bullet before the first red test is written, because AGENTS.md §1 → TDD says the human owns the assertions.

# Inputs
`$ARGUMENTS` — a Linear issue key (`SAN-43`) or URL. If it is missing, ask for it and stop.

# Linear tools
Use the Linear MCP server's `get_issue`, `list_comments`, `save_comment`, `save_issue` and `list_issue_statuses`. The server may be registered under any name (`mcp__linear__…` or `mcp__<uuid>__…`) — match on the suffix. Load them first if they are deferred. If Linear is unreachable, say so and stop: the issue is the source of truth for scope (AGENTS.md §1 → Starting a task), and there is nothing to start without it.

# Workflow

## 1. A clean, current base
1. `git status --porcelain`. If anything is uncommitted, **stop** and show it. Never stash, reset or discard the owner's work to make room.
2. `git fetch origin`.
3. Decide where to branch from:
   - **On `main`, or on a branch with no commits beyond `origin/main`** (`git rev-list --count origin/main..HEAD` is `0`) — continue to step 4.
   - **On a branch with its own commits** — this may be a resumed ticket. Stop and ask whether to resume it or start fresh. Do not move it.
4. Name the branch per AGENTS.md §1 → *Branches & PRs*: `<prefix>/san-<n>-<slug>`, prefix from the issue's labels and title (ask if it is genuinely unclear).
5. If that branch already exists locally or on `origin`, stop and ask — it is a resume or a collision. Otherwise `git switch -c <branch> --no-track origin/main`. `--no-track` matters: without it the branch tracks `origin/main`, and the first `git push` fails. Push the first time with `git push -u origin HEAD`.

## 2. The contract
6. AGENTS.md is imported by `CLAUDE.md`, so it should already be in context. **Check, don't assume:** if you cannot quote its §1 → *Review gate* heading, read `AGENTS.md` in full now.

## 3. The issue
7. Fetch the issue (`get_issue`, with relations) and **every** comment (`list_comments`). Read them all — later comments often amend the description.
8. Stop if the issue cannot start:
   - **Done or Canceled** — say so.
   - **In Review**, or a comment says work already started — show the evidence and ask.
   - **Blocked by** an issue that is not Done — name it.
   - **No AC section, or AC that two engineers would implement differently** — recommend `/refine-ticket <key>` and stop. Do not refine it yourself here; that is the owner's session.

## 4. The area
9. Read what AGENTS.md §1 → *Starting a task* requires for this issue, and nothing it doesn't:
   - `docs/adr/` — list the filenames, read the ones the issue implicates.
   - `docs/ARCHITECTURE.md` and `docs/ABSTRACTIONS.md` — the structure and patterns you will reuse.
   - the existing components in `src/components/` and the visual-direction ADRs (0012, 0013) — if the issue touches UI.
10. Find the tests that already cover the area (grep for the modules you will touch in `*.test.ts(x)`, `convex/`, `e2e/`). This is the *contextual test signal* AGENTS.md asks for.

## 5. The checkpoint
11. Present, briefly:
    - **Branch:** the name, and that it is based on `origin/main` at `<short sha>`.
    - **Read:** the ADRs and docs you read, one line each on why.
    - **AC → tests:** a table with every AC bullet, the test file and test name that will prove it, and whether it is new or an existing test extended. A bullet you cannot test gets a reason, not a blank.
    - **Approach:** a few lines. Name any schema change, ADR, or docs update the change needs.
    - **Risks / questions:** anything that could widen scope. Scope comes from the issue — if the work seems to need more, say so here.
12. Ask: *"Go with this test plan?"* — and **wait**. Adjust it if the owner changes it.

## 6. Go
13. On a yes:
    - Post the Linear comment `🚀 Starting: <one-line approach>` (`save_comment`) — AGENTS.md §1 requires it.
    - If the issue is in a backlog or unstarted state, move it to the team's *In Progress* state (`list_issue_statuses`, then `save_issue`).
14. Begin TDD: the first commit is the failing tests from the approved table.

# Constraints
- **Never write code before the checkpoint is approved.** The approved AC → test map is the spec the work is graded against.
- **Never discard, stash or move existing work.** Stop and ask.
- **Never widen scope.** Anything outside the issue goes under *Risks / questions*, not into the plan.
- **Do not refine the AC here.** Unclear AC sends the owner to `/refine-ticket`.
