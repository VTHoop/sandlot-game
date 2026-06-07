# 2. Backend & data platform: Convex (with Clerk for auth)

- Status: Accepted
- Date: 2026-06-06

## Context
The app needs: server-**authoritative secret state** (the pitcher's hidden number must never reach the opponent's client until the swing locks), realtime updates when both players are online, fully async play with notifications, a weekly cron to ingest external stats, and a **shared pure-TS engine** that runs both server-side (authoritative) and client-side (read-only previews). It is built by AI agents (favor one mental model and safety-by-default), at tiny scale (~6–50 users), as a portfolio piece.

We evaluated **Supabase** (Postgres + RLS + Edge Functions), **Convex** (TS reactive backend), and **Cloudflare Workers + Durable Objects**, and ran a quick read-pattern inventory.

## Decision
Use **Convex** for backend/data/realtime, and **Clerk** for auth.
- All writes go through server **mutations**, so the secret pitch is hidden **structurally** (never returned by a client query), not by RLS-policy discipline — safer when agents write the code.
- Reactive subscriptions provide realtime with no WebSocket wiring; scheduled functions cover the weekly stat ingest and turn reminders.
- The pure TS engine imports identically into mutations and the client.
- The query inventory showed ~90% of reads are point-reads / simple filters / rollup aggregates. SQL's real edge — ad-hoc multi-dimensional stat splits — is a post-POC nice-to-have, so we accept TS aggregation in exchange for testability, reactivity, and a single agent-friendly toolchain.
- Clerk has a first-party Convex integration and a free tier far above our scale.

## Consequences
- **+** Secret-by-default, fast agent build, one TS surface, realtime/cron first-party.
- **−** Proprietary/managed (some lock-in) — acceptable for a portfolio piece and reversible because the engine and game logic are DB-agnostic. No SQL for *ad-hoc* analytics — mitigated by maintained rollups; revisit if rich stat splits become a core feature.
- Runner-up: **Cloudflare Durable Objects** (a per-game actor is the most elegant fit, but more assembly and DIY push). **Supabase** remains the fallback if SQL/relational modeling later becomes central. Superseding this ADR is the path if that happens.
