# 29. Client routing: React Router 7 in declarative mode, with an in-place auth gate

- Status: Accepted
- Date: 2026-09-29

## Context

`src/App.tsx` routed by hand: one `window.location.pathname === '/design'` check,
and `<h1>Sandlot</h1>` for every other path. The first real game (SAN-38) needs
a signed-in area, a `/game/:id` route with a path parameter, a not-found screen
for unmatched paths, and a public `/design`. A signed-out visitor who opens
`/game/:id` must also land back on it after signing in.

Hand-rolled matching could cover two routes. It would not cover what comes next:
the duel moving into `/game/:id` (SAN-39), a "my games" list, and links between
them. Those need parameter parsing, client-side navigation without a reload, and
`<Link>`, which are what a router library provides.

Two constraints narrowed the choice. The app is on **React 18**, and the
router's routes have to sit **inside** `ClerkProvider` + `ConvexProviderWithClerk`
(`src/main.tsx`), because the gate reads both.

## Decision

**Adopt `react-router` 7 (`^7.18`) in declarative mode**: `<BrowserRouter>`,
`<Routes>`, `<Route>`, `<Outlet>`, `<Link>`, `useParams`, `useLocation`. We do
not use data mode (loaders, actions, `createBrowserRouter`) or framework mode.
Convex already owns data loading through reactive `useQuery` subscriptions, so
router loaders would add a second, non-reactive way to fetch the same data.

**Version 7 rather than 8.** React Router 8 requires React ≥ 19.2.7. Version 7
supports React ≥ 18 and still receives patch releases (7.18.4, September 2026).
Upgrading the router belongs with the React 19 upgrade, not before it.

**The router lives in `App`, not `main.tsx`,** so a test can mount the whole shell
at a URL with nothing but `<App />`.

**The auth gate is a layout route (`AuthGate`) wrapping every route except
`/design`.** It is a component in the tree, not a redirect. A signed-out visitor
sees Clerk's `<SignIn>` rendered in place at the URL they opened. Clerk runs with
`routing="hash"`, so its multi-step flow stays off the app's paths.
`forceRedirectUrl` and `signUpForceRedirectUrl` are set to the current path and
query. Because the visitor never leaves the URL, returning a deep link needs no
stored return-to state.

**Clerk decides signed-in versus signed-out; Convex decides when the session is
usable.** Signed in to Clerk but not yet confirmed by Convex is a wait, not an
error. Convex's auth state reads the same during the normal post-sign-in window
as it does for a rejected token.

## Alternatives considered

**wouter.** About 2 kB, hooks-first, React ≥ 16.8. It covers today's two routes
well. We rejected it because the next routes need nested layouts sharing a gate,
and React Router has the more established pattern for that (`<Outlet>`). Nearly
all of this project's code is written by agents, and React Router is the router
they are most likely to use correctly without being corrected.

**TanStack Router.** Its type-safe route params are appealing. We rejected it
because it is built around a route tree with codegen or a file-based plugin.
That is a second build-time system to adopt for a handful of routes whose params
are one string.

**Keep matching by hand.** We rejected this for the reasons in Context. The first
parameterised route is where hand-rolled routing starts accumulating bugs.

**A dedicated `/sign-in` route, or Clerk's hosted page (`<RedirectToSignIn>`).**
Either would require carrying the return-to URL across a navigation. The hosted
page would also move the sign-in surface off the app, so the app could no longer
guarantee its 375px layout. Rendering in place avoids both.

**`React Router 8` with a React 19 upgrade in the same change.** We rejected this
because it bundles an unrelated framework upgrade into a shell ticket.

## Consequences

- One new runtime dependency, `react-router`. It is a single package: the v7
  merge folded `react-router-dom` in.
- Screens navigate with `<Link>` and `useNavigate`, not `window.location`. The
  `/design` check in `App.tsx` is gone.
- `gameView.getGame` now accepts its id as a plain string and normalises it with
  `ctx.db.normalizeId`. The id comes from the address bar, so a malformed id is
  untrusted input and must reach the same `null` as an unknown game (ADR-0025)
  rather than failing argument validation before the not-found screen can render.
- If a Clerk session is ever rejected by the Convex backend (a missing `convex`
  JWT template, a wrong `CLERK_ISSUER_URL`), the viewer waits on "Checking your
  sign-in…" indefinitely instead of seeing an error. Telling that apart from the
  normal confirmation window would need a timeout. That is worth adding if it
  ever happens outside setup.
- When React moves to 19, move the router to 8 in the same change.
