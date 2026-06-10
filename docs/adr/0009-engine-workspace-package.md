# 9. Engine pnpm workspace package (`@sandlot/engine`)

- Status: Accepted
- Date: 2026-06-10

## Context

The at-bat resolution engine must be callable from two deployment contexts:

1. **Convex server functions** (mutations) — the authoritative resolver and secret vault. The pitch number must never leave the server; the engine runs here, writes the result, and appends to the log.
2. **React client** — read-only odds previews and near-miss display require the same resolution logic without a round-trip.

We need a single, shared TypeScript implementation with no framework dependencies.

## Decision

Create `packages/engine` as a **private pnpm workspace package** (`@sandlot/engine`, `"private": true`). Raw `.ts` source is exported via `package.json#exports`; both Vite (client) and the Convex build pipeline resolve TypeScript directly in bundler mode, so no pre-compilation step is required for development or CI.

Engine source is included in the root `tsconfig.app.json` (`"packages/engine/src"`) and scanned by the root Vitest config, keeping the toolchain single-pass.

## Alternatives considered

- **Convex action only**: would duplicate logic if the client ever needs odds previews without a server round-trip, and couples game-math to the Convex SDK.
- **Published npm package**: overkill for a private family project; adds a publish/version lifecycle for no benefit.
- **Inline in `src/`**: conflates client UI code with framework-free engine math; makes the "no DOM, no React" constraint unenforceable at the type-checker level.

## Consequences

- **+** Single implementation shared by both deployment contexts; tested once.
- **+** Engine can be developed and unit-tested without running Convex or the React dev server.
- **−** Raw `.ts` exports (`"./tables": "./src/tables/accessor.ts"`) work under Vite/Vitest bundler resolution but would break if the package were ever consumed outside a TypeScript bundler. Acceptable given `"private": true`; revisit if the engine is ever extracted.
- **−** Compiling under `tsconfig.app.json` (which carries `lib: ["ES2020", "DOM", "DOM.Iterable"]`) means the type-checker will not catch accidental DOM imports in engine code. A dedicated `packages/engine/tsconfig.json` with `"lib": ["ES2020"]` would create a hard compile fence — tracked as SAN-43.
