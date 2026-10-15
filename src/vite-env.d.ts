/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
  /** The VAPID public key turn pushes are encrypted for; unset means no push. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
