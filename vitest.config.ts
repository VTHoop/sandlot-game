import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'packages/*/src/**/*.test.ts',
      'convex/**/*.test.ts',
    ],
    environment: 'jsdom',
    // The engine harness suite exhaustively iterates the full attribute grid;
    // under v8 coverage instrumentation those cases run ~5s and intermittently
    // trip the default 5000ms per-test timeout. 15s absorbs the variance without
    // masking a genuine hang.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      include: ['src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
