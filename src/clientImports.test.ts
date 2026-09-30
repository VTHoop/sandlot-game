import { describe, expect, it } from 'vitest'

/**
 * The browser bundle must not pull in Convex's server runtime. A value import
 * from a module like `convex/gameView.ts` drags `_generated/server` in behind it,
 * which throws `process is not defined` the moment the chunk loads — and nothing
 * else catches that: the test suite runs under Node, where `process` exists, and
 * the build type-checks and bundles fine.
 *
 * So every runtime import a client module makes from `convex/` must name a
 * module written to be safe there: the generated function references, or a
 * leaf that imports no server runtime (`duelContract.ts` says so in its header).
 * Type-only imports are erased and always fine.
 */

/** The `convex/` modules a client may import values from. */
const CLIENT_SAFE = new Set(['_generated/api', 'duelContract', 'clubSide'])

const sources = import.meta.glob<string>(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/testing/**'],
  { query: '?raw', import: 'default', eager: true },
)

/** Every `import … from '…/convex/<module>'` that keeps a value at runtime. */
function runtimeConvexImports(source: string): string[] {
  const imports = source.matchAll(/^import\s+([\s\S]*?)\s+from\s+'(?:\.\.\/)+convex\/([^']+)'/gm)
  return [...imports]
    .filter(([, clause = '']) => !isTypeOnly(clause))
    .map(([, , module = '']) => module)
}

/** `import type { … }`, or braces whose every specifier is `type X`. */
function isTypeOnly(clause: string): boolean {
  if (clause.startsWith('type ')) return true
  const braced = clause.match(/^\{([\s\S]*)\}$/)?.[1]
  if (braced === undefined) return false
  const specifiers = braced
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean)
  return specifiers.every((specifier) => specifier.startsWith('type '))
}

describe('the client bundle', () => {
  it('finds the client modules it guards', () => {
    expect(Object.keys(sources)).toContain('./shell/LiveGame.tsx')
  })

  it('imports values from convex/ only through modules that carry no server runtime', () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      runtimeConvexImports(source)
        .filter((module) => !CLIENT_SAFE.has(module))
        .map((module) => `${file} → convex/${module}`),
    )
    expect(offenders).toEqual([])
  })
})
