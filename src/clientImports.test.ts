import ts from 'typescript'
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

/** Path segments that only climb or stay put: `.` and `..`. */
const isRelativeStep = (segment: string): boolean => segment === '.' || segment === '..'

/**
 * The `convex/` module a specifier names — a relative path whose first real
 * segment is `convex` — or null for anything else. Split into segments rather
 * than matched with a pattern: a repeated relative-prefix group is the
 * backtracking shape an unsafe-regex check rightly flags.
 */
function convexModuleOf(specifier: ts.Expression | undefined): string | null {
  if (!specifier || !ts.isStringLiteral(specifier)) return null
  const segments = specifier.text.split('/')
  const at = segments.indexOf('convex')
  if (at < 1 || !segments.slice(0, at).every(isRelativeStep)) return null
  const module = segments.slice(at + 1).join('/')
  return module || null
}

/** An import survives compilation unless it, or every name it binds, is
 * type-only. A bare `import '…'` has no clause and always runs. */
function importKeepsValue({ importClause: clause }: ts.ImportDeclaration): boolean {
  if (!clause) return true
  if (clause.isTypeOnly) return false
  if (clause.name) return true
  const bindings = clause.namedBindings
  if (!bindings || ts.isNamespaceImport(bindings)) return true
  return bindings.elements.some((element) => !element.isTypeOnly)
}

/** Likewise for a re-export; `export *` always carries values. */
function exportKeepsValue({ isTypeOnly, exportClause: clause }: ts.ExportDeclaration): boolean {
  if (isTypeOnly) return false
  if (!clause || ts.isNamespaceExport(clause)) return true
  return clause.elements.some((element) => !element.isTypeOnly)
}

/** The `convex/` module a node loads at runtime, or null if it loads none. */
function runtimeTargetOf(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node)) {
    return importKeepsValue(node) ? convexModuleOf(node.moduleSpecifier) : null
  }
  if (ts.isExportDeclaration(node)) {
    return exportKeepsValue(node) ? convexModuleOf(node.moduleSpecifier) : null
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return convexModuleOf(node.arguments[0])
  }
  return null
}

/**
 * Every `convex/` module a source loads at runtime: imports, re-exports and
 * dynamic `import()` that keep a value. Read off the TypeScript AST, one
 * statement at a time — a pattern over the raw text cannot tell where one
 * import ends and the next begins.
 */
function runtimeConvexImports(source: string): string[] {
  const file = ts.createSourceFile(
    'client.tsx',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  )
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    const module = runtimeTargetOf(node)
    if (module) found.push(module)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
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
