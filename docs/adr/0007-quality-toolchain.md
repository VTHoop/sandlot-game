# ADR 0007 — Quality Toolchain: Biome, tsc, Vitest v8, Playwright

**Date:** 2026-06-08  
**Status:** Accepted

## Context

SAN-5 established the ADR process; SAN-6 scaffolded the app. This ticket (SAN-7) wires the quality gates described in `AGENTS.md §1 Check suite` so that CI and local development have a single, reproducible command per concern.

## Decision

| Concern | Tool | Script |
|---|---|---|
| Lint + format | **Biome** (`biome.json`) | `pnpm lint` / `pnpm lint:fix` |
| Type safety | **tsc project build** (`tsc -b`) | `pnpm typecheck` |
| Unit tests | **Vitest 4.x** (jsdom) | `pnpm test` |
| Coverage gate | **Vitest v8** provider, ≥80% threshold | `pnpm test:coverage` |
| Smoke lane | **Playwright 1.x** Chromium | `pnpm e2e:smoke` |

### Biome over ESLint + Prettier

Biome runs lint and format in a single binary with no plugin graph, is significantly faster, and has no configuration drift between the two tools. The Vite scaffold's ESLint/Prettier configs were never committed, so there is nothing to migrate.

### `tsc -b` (project-references build mode)

The repo uses `tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json` (project references). `tsc -b` respects the reference graph and is consistent with the `build` script. Both referenced tsconfigs carry `"noEmit": true`, so this is a pure type-check — no files are emitted.

### Vitest v8 coverage gate

Coverage is scoped to `src/**/*.{ts,tsx}` with `src/main.tsx` and type-declaration files excluded (entry-point bootstrapping is not meaningfully unit-testable). The ≥80% threshold on all four axes (statements, branches, functions, lines) gates new code — the `<App />` mount test in `src/App.test.tsx` exercises it so the gate is verified, not vacuous.

### Playwright smoke lane

The smoke test starts the Vite dev server via `webServer`, navigates to `/`, asserts `#root` is populated (React mounted), and asserts no `pageerror` events (uncaught JS errors). This catches crashes before any React code runs, entry-point failures, and fatal provider errors. Scoped to Chromium only for speed; the 30 s per-test timeout keeps the lane well under the 5-minute SLA.

## Consequences

- All five scripts must pass before a PR is merged (enforced in CI per SAN-5 intent).
- The coverage threshold is a ratchet: it can only go up, never down.
- Playwright browsers must be installed in CI (`playwright install chromium`).
- Node.js ≥ 24 is required (Vite 8 + Vitest 4 dropped support for older Node; `.nvmrc` pins `24`).
