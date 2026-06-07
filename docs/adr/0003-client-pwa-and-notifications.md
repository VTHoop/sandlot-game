# 3. Client & notifications: React/Vite PWA + web push (native deferred)

- Status: Accepted
- Date: 2026-06-06

## Context
Mobile-first; the family/friends beta is mostly on phones. Push notifications are the core engagement loop ("it's your turn"). Adoption favors a tap-a-link experience. As of 2026, iOS web push is unreliable (requires manual Add-to-Home-Screen, ~70–85% delivery, subscriptions can silently die). About half the beta users are on Android, where web push is solid.

## Decision
**Beta:** React + Vite **PWA** + shadcn/ui, hosted on Cloudflare Pages, with **web push (VAPID)**. The maintainer will manually ensure iOS users complete Add-to-Home-Screen.
**Deferred ("if it grows"):** a native Expo/React Native app with real APNs/FCM push.

## Consequences
- **+** Fastest path to a clean, installable web app; zero-install sharing; strong web portfolio artifact; web push is dependable on Android and acceptable for a managed ~6-person beta.
- **−** iOS push needs manual hand-holding and may be flaky (accepted at this scale). Going native later means rebuilding the **UI shell** in React Native — but the engine and Convex backend are client-agnostic, so it's a contained change, not a rewrite. That contained cost is why we don't pre-pay for Expo now.
