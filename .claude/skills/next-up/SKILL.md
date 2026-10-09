---
name: next-up
description: Level-set the Sandlot project and recommend the next 2–3 Linear issues to work on, with reasons. Reads Linear projects and issues, recent and open PRs, main's history and the orientation docs, reports what's done, in flight and blocked, flags drift between Linear, GitHub and the docs, and recommends what to refine next. Read-only — never creates, edits or reorders issues. Use every few tickets, e.g. /next-up.
argument-hint: [optional focus, e.g. "Core Multiplayer Loop" or "engine"]
---

# Purpose
Every few tickets the owner steps back and asks where the project is and what should actually come next. This skill is that question, asked the same way each time from a fresh session, so the answer comes from the current state of Linear and the repo rather than from whatever the last session remembered. It recommends; the owner decides. Its output feeds `/refine-ticket`.

# Inputs
`$ARGUMENTS` — optional focus (a Linear project name, or an area of the product). Without one, consider the whole Sandlot team.

# Linear tools
Use the Linear MCP server's `list_projects`, `get_project`, `list_milestones`, `list_issues`, `get_issue` and `list_comments` — match on the suffix, load them if deferred. **Never call `save_issue`, `save_comment` or any other write tool** — this skill is read-only. If Linear is unreachable, say so and stop.

# Workflow

## 1. Gather
1. **Linear.** For the Linear team whose issue key is `SAN`:
   - Projects and their milestones, status and target dates.
   - Open issues (backlog, unstarted, started, in review) with priority, estimate, project, milestone and relations — blocked-by matters most.
   - Issues completed in the last 21 days.
2. **GitHub and git.** `git fetch origin`, then:
   - `gh pr list --state open --json number,title,headRefName,updatedAt,isDraft`
   - `gh pr list --state merged --limit 15 --json number,title,mergedAt`
   - `git log origin/main --oneline -20`
3. **Docs.** `docs/ROADMAP.md` and the ADR filenames in `docs/adr/` — note any ADR whose status is *Proposed*; it is an open decision.

## 2. Check for drift
Report each one you find; say "none" if there are none.
- An issue marked Done with no merged PR that names it.
- A merged PR whose issue is not Done.
- An issue In Progress or In Review with no open PR, or no branch activity for over 7 days.
- An open PR with no issue key in its title or branch.
- `docs/ROADMAP.md` contradicted by what has merged.

## 3. Recommend
Pick **2–3** open issues, ranked. Weigh, in this order:
1. **Unblocked.** Every blocked-by issue is Done. A blocked issue can be named as "next after X", not recommended.
2. **On the critical path to a playable game.** The hidden-number duel and the first real game are the core (ROADMAP.md); prefer work that gets two players closer to finishing a game.
3. **Retires risk early.** Anything that could leak the secret pitch (AGENTS.md §2 → Game integrity), schema and state-machine shape, and the engine's balance.
4. **Fits one small PR.** Too large to land as one reviewable PR → recommend splitting it, and say where the split goes.

For each: the key and title, **why now** (one or two sentences tied to the criteria above), what it unblocks, and **AC readiness** — whether its AC is concrete enough to start or needs `/refine-ticket` first, with the gap named.

If the project needs work that has **no issue**, list it under *Proposed issues*, with a title and one line of reasoning. Do not create it.

## 4. Report

```markdown
## Sandlot — where we are (<date>)

**Shipped (last 21 days):** <issues/PRs, one line each>
**In flight:** <open PRs and started issues>
**Blocked:** <issue — blocked by — on what>
**Open decisions:** <Proposed ADRs, or "none">
**Drift:** <findings, or "none">

### Recommended next
1. **SAN-XX — <title>.** Why now: … Unblocks: … AC: ready | needs /refine-ticket (<gap>)
2. …

### Proposed issues
- <title> — <why>

**Next:** `/refine-ticket SAN-XX`
```

# Constraints
- **Read-only.** No Linear writes, no git writes beyond `fetch`, no PRs.
- **Recommend from evidence.** Every "why now" cites an issue relation, a doc line, or a merged PR — not a general sense of what products need.
- **Scope stays in Linear** (AGENTS.md §1 → Starting a task). Work you think is missing is a *proposed issue* for the owner, never a widening of an existing one.
