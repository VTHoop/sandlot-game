# Architecture

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Client | React 18 + Vite 8 PWA | Mobile-first; hosted on Cloudflare Pages |
| Backend / data / realtime | Convex | Mutations, queries, scheduled functions |
| Auth | Clerk | JWT template → `ctx.auth` in server functions |
| Package manager | pnpm 11 | Node 24; `pnpm-workspace.yaml` for build approvals |

See `docs/adr/` for the "why" behind each choice.

## Provider tree

```
ClerkProvider                     (Clerk session + JWT)
  └─ ConvexProviderWithClerk      (passes Clerk JWT into Convex auth layer)
       └─ App
```

`ConvexProviderWithClerk` is from `convex/react-clerk`. It receives Clerk's `useAuth`
hook and forwards a validated token to every Convex server function as `ctx.auth`.

## Key files

| Path | Purpose |
|---|---|
| `src/main.tsx` | Entry point — wires ClerkProvider + ConvexProviderWithClerk |
| `src/App.tsx` | Root component |
| `convex/schema.ts` | Convex data model stub (tables added per Multiplayer tickets) |
| `convex/auth.config.ts` | Clerk OIDC provider so Convex validates Clerk JWTs |
| `public/manifest.webmanifest` | PWA manifest (served as-is; `vite-plugin-pwa` handles SW) |
| `pnpm-workspace.yaml` | pnpm 11 build-script approvals (`allowBuilds`) |
| `.env.example` | Required env var names with no real values |

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `VITE_CONVEX_URL` | `.env.local` (written by `npx convex dev`) | Convex deployment URL for the browser client |
| `VITE_CLERK_PUBLISHABLE_KEY` | `.env.local` | Clerk publishable key |
| `CLERK_ISSUER_URL` | Convex dashboard / `npx convex env set` | Clerk Frontend API URL for `convex/auth.config.ts` |
