import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import ts from 'typescript'

/**
 * Every Server Action and API route can be called directly with any
 * arguments, so each must check who is calling before doing anything. These
 * tests read the source and fail when an exported action does not start with
 * requireUser() (or an API route with getSessionUser()), so a new action
 * cannot ship without it.
 *
 * "Start with" means the check runs before any try block: requireUser()
 * redirects by throwing, and a surrounding catch would swallow it.
 */

const SRC = path.join(process.cwd(), 'src')

/** Actions that deliberately need no signed-in user, and why. */
const PUBLIC_ACTIONS: Record<string, string> = {
  signOutAction: 'ending a session that may already be gone'
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function parse(file: string) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
}

function isUseServerFile(source: ts.SourceFile) {
  const first = source.statements[0]
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  )
}

function exportedFunctions(source: ts.SourceFile) {
  return source.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      !!statement.name &&
      !!statement.body &&
      !!statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
  )
}

function callsFunction(node: ts.Node, name: string): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === name
  ) {
    return true
  }
  return ts.forEachChild(node, child => callsFunction(child, name)) ?? false
}

/** True when `name()` is called by a top-level statement before any try block or return. */
function checksFirst(fn: ts.FunctionDeclaration, name: string) {
  for (const statement of fn.body!.statements) {
    if (ts.isTryStatement(statement)) return false
    if (callsFunction(statement, name)) return true
    if (ts.isReturnStatement(statement)) return false
  }
  return false
}

const relative = (file: string) => path.relative(process.cwd(), file)

describe('every Server Action checks the session first', () => {
  const files = walk(SRC).map(parse).filter(isUseServerFile)

  it('finds the action files', () => {
    assert.ok(
      files.length >= 10,
      `only ${files.length} 'use server' files found`
    )
  })

  for (const source of files) {
    for (const fn of exportedFunctions(source)) {
      const name = fn.name!.text
      it(`${relative(source.fileName)}: ${name}`, () => {
        if (name in PUBLIC_ACTIONS) return
        assert.ok(
          checksFirst(fn, 'requireUser'),
          `${name} must call requireUser() before any try block`
        )
      })
    }
  }
})

describe('every API route checks the session first', () => {
  const routes = walk(path.join(SRC, 'app', 'api'))
    .filter(file => file.endsWith('route.ts'))
    // Better Auth's own endpoints are the way in.
    .filter(file => !file.includes(`${path.sep}auth${path.sep}`))
    .map(parse)

  for (const source of routes) {
    for (const fn of exportedFunctions(source)) {
      it(`${relative(source.fileName)}: ${fn.name!.text}`, () => {
        assert.ok(
          checksFirst(fn, 'getSessionUser'),
          `${fn.name!.text} must call getSessionUser() before any try block`
        )
      })
    }
  }
})
