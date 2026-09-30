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

describe('the runtime-import scanner', () => {
  const VALUE = "import { ClubSide } from '../../convex/gameView'"

  it.each([
    ['a plain value import', VALUE],
    ['a value import below a type-only one', `import type { ReactNode } from 'react'\n${VALUE}`],
    [
      'a value import below one with inline type specifiers',
      `import { type ReactNode } from 'react'\n${VALUE}`,
    ],
    ['a default import', "import gameView from '../../convex/gameView'"],
    ['a namespace import', "import * as gameView from '../../convex/gameView'"],
    ['a side-effect import', "import '../../convex/gameView'"],
    ['a value re-export', "export { ClubSide } from '../../convex/gameView'"],
    ['a star re-export', "export * from '../../convex/gameView'"],
    ['a dynamic import', "const view = () => import('../../convex/gameView')"],
    ['a double-quoted specifier', 'import { ClubSide } from "../../convex/gameView"'],
    [
      'a mixed type and value import',
      "import { type GameView, ClubSide } from '../../convex/gameView'",
    ],
  ])('catches %s', (_, source) => {
    expect(runtimeConvexImports(source)).toEqual(['gameView'])
  })

  it.each([
    ['import type', "import type { GameView } from '../../convex/gameView'"],
    ['inline type specifiers only', "import { type GameView } from '../../convex/gameView'"],
    ['export type', "export type { GameView } from '../../convex/gameView'"],
    ['a non-convex value import', "import { useState } from 'react'"],
  ])('lets through %s', (_, source) => {
    expect(runtimeConvexImports(source)).toEqual([])
  })
})

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
