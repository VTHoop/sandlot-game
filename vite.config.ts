import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // A hand-written worker (src/sw.ts): it holds the web-push handlers (SAN-23).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // manifest served from public/manifest.webmanifest (committed to repo)
      manifest: false,
    }),
  ],
})
