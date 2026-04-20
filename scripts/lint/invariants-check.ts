#!/usr/bin/env bun
/**
 * Syntactic preflight checker for the invariants in `docs/invariants.md`.
 *
 * Ships three of the five registry invariants (the runtime ones live in
 * `.test.ts` files under `src/phases/`):
 *
 *   #2 Seam-recheck symmetry         — AST walk over `src/phases/drafting.ts`
 *   #3 Trace-seeded watcher          — AST walk over `scripts/test/**\/*.ts`
 *   #5 Body-already-used detection   — AST walk over `src/**\/*.ts` + `scripts/**\/*.ts`
 *
 * Exit 0 on green, 1 on any violation.
 *
 * Flags:
 *   --self-test    Run against `tests/invariants-fixtures/*.ts`; each file
 *                  MUST fire its declared expected-invariant. Exit 0 iff
 *                  every fixture fires correctly.
 *   --target PATH  Scan a single file (used by --self-test internally).
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, relative, join } from "node:path"
import ts from "typescript"
import { loadAllowlist, isAllowlisted, type AllowlistEntry } from "./invariants-allowlist"

// ── Invariant names (exact match with docs/invariants.md status table) ───
const INV_SEAM_RECHECK = "Seam-recheck symmetry"
const INV_WATCHER = "Trace-seeded watcher for post-start event assertions"
const INV_BODY_USED = "Body-already-used detection"

const REPO_ROOT = process.cwd()

interface Violation {
  invariant: string
  file: string
  line: number
  detail: string
}

// ── CLI arg parsing ──────────────────────────────────────────────────────
function parseArgs(argv: string[]): { selfTest: boolean; target: string | null } {
  let selfTest = false
  let target: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--self-test") selfTest = true
    else if (a === "--target") {
      target = argv[++i] ?? null
      if (!target) {
        console.error("invariants-check: --target requires a path argument")
        process.exit(2)
      }
    } else {
      console.error(`invariants-check: unknown argument ${a}`)
      process.exit(2)
    }
  }
  return { selfTest, target }
}

// ── File walkers ─────────────────────────────────────────────────────────
function walkDir(dir: string, exts: string[], excludes: string[] = []): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(cur)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = join(cur, name)
      if (excludes.some(ex => full.includes(ex))) continue
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (exts.some(ex => name.endsWith(ex))) out.push(full)
    }
  }
  return out
}

function relPath(abs: string): string {
  return relative(REPO_ROOT, abs).replaceAll("\\", "/")
}

// ── Invariant #2 — Seam-recheck symmetry ─────────────────────────────────
/**
 * For each CallExpression in `src/phases/drafting.ts` where:
 *   - agent = "chapter-plan-checker" or "chapter-plan-reviser" (via the
 *     `agentName: "..."` property passed to `callAgent({...})`)
 *   - OR callee is `validateChapterDraft`
 *
 * PASS iff SOME ancestor Block/For/While/If body (within the same top-level
 * function) contains a reference to the matching `inject.forceXxx` identifier:
 *   chapter-plan-checker → inject.forcePlanCheck
 *   chapter-plan-reviser → inject.forceReviser
 *   validateChapterDraft → inject.forceValidation
 *
 * Also PASS if the CallExpression's line ±2 has a `// @noninjectable`
 * comment.
 */
interface SeamSite {
  line: number
  kind: "chapter-plan-checker" | "chapter-plan-reviser" | "validateChapterDraft"
  forceName: "forcePlanCheck" | "forceReviser" | "forceValidation"
  node: ts.CallExpression
}

function findSeamSites(sf: ts.SourceFile): SeamSite[] {
  const sites: SeamSite[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      // Detect `validateChapterDraft(...)`
      if (ts.isIdentifier(callee) && callee.text === "validateChapterDraft") {
        sites.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          kind: "validateChapterDraft",
          forceName: "forceValidation",
          node,
        })
      }
      // Detect `callAgent({ ..., agentName: "chapter-plan-checker" | "chapter-plan-reviser", ... })`
      if (
        ts.isIdentifier(callee) &&
        callee.text === "callAgent" &&
        node.arguments.length >= 1 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const obj = node.arguments[0] as ts.ObjectLiteralExpression
        for (const prop of obj.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === "agentName" &&
            ts.isStringLiteral(prop.initializer)
          ) {
            const agentName = prop.initializer.text
            if (agentName === "chapter-plan-checker") {
              sites.push({
                line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                kind: "chapter-plan-checker",
                forceName: "forcePlanCheck",
                node,
              })
            } else if (agentName === "chapter-plan-reviser") {
              sites.push({
                line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                kind: "chapter-plan-reviser",
                forceName: "forceReviser",
                node,
              })
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return sites
}

/**
 * Line-window proximity check, AST-scoped.
 *
 * Rationale (Codex review `a01385f5` HIGH #1 + `acf3a597` follow-up): the
 * original function-scope subtree scan over-accepted — any guard anywhere
 * in the enclosing function passed, so a new unguarded sibling call slipped
 * through. The first fix was a raw text substring scan of ±50 lines, but
 * that accepted comments and string literals that happened to contain
 * `inject.forceXxx` text.
 *
 * Current rule: collect all real AST nodes of shape `inject.<forceName>`
 * or `inject["<forceName>"]` in the source file (PropertyAccessExpression
 * / ElementAccessExpression), map them to their line numbers, and check
 * whether any of those lines falls within ±SEAM_WINDOW_LINES of the call
 * site. Comments and string literals are naturally excluded because the
 * TypeScript parser does not emit AST nodes for them of that shape.
 *
 * The 50-line window was chosen by measuring HEAD: the largest call-to-
 * guard distance is 40 lines (chapter-plan-checker initial call at
 * drafting.ts:425 paired with `inject.forcePlanCheck` at :470). 50 adds a
 * small margin; a regression >50 lines from any real guard node FAILS.
 * If a future seam legitimately exceeds 50 lines, either refactor to move
 * the guard closer, annotate with `// @noninjectable`, or add an allowlist
 * entry with a 30-day expiry per `docs/invariants.md` §Allowlist.
 */
const SEAM_WINDOW_LINES = 50

/**
 * Collect the line numbers of every AST node of shape `inject.<forceName>`
 * or `inject["<forceName>"]` (literal property-access, not identifier
 * shadowing or string-literal text). Returns a sorted array of 1-indexed
 * line numbers, one per occurrence.
 */
function collectForceRefLines(sf: ts.SourceFile, forceName: string): number[] {
  const lines: number[] = []
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "inject" &&
      ts.isIdentifier(node.name) &&
      node.name.text === forceName
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "inject" &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === forceName
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines.sort((a, b) => a - b)
}

function lineWindowHasForceRef(
  forceRefLines: number[],
  siteLine: number,
): boolean {
  for (const l of forceRefLines) {
    if (Math.abs(l - siteLine) <= SEAM_WINDOW_LINES) return true
  }
  return false
}

/**
 * Check for a `// @noninjectable` comment within ±2 lines of the site.
 */
function hasNonInjectableComment(sf: ts.SourceFile, line: number): boolean {
  const text = sf.getFullText()
  const lines = text.split("\n")
  const lo = Math.max(0, line - 3)
  const hi = Math.min(lines.length, line + 2)
  for (let i = lo; i < hi; i++) {
    if (lines[i].includes("@noninjectable")) return true
  }
  return false
}

function checkSeamRecheckSymmetry(
  draftingPath: string,
  allowlist: AllowlistEntry[],
): { violations: Violation[]; allowlisted: number; siteCount: number } {
  const abs = resolve(REPO_ROOT, draftingPath)
  const rel = relPath(abs)
  const src = readFileSync(abs, "utf8")
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const sites = findSeamSites(sf)
  const violations: Violation[] = []
  let allowlistedCount = 0

  // Precompute force-ref line indexes per forceName so each site check is O(N).
  const forceRefIndex = new Map<string, number[]>()
  for (const forceName of ["forcePlanCheck", "forceValidation", "forceReviser"]) {
    forceRefIndex.set(forceName, collectForceRefLines(sf, forceName))
  }

  for (const site of sites) {
    if (hasNonInjectableComment(sf, site.line)) continue
    const refLines = forceRefIndex.get(site.forceName) ?? []
    if (lineWindowHasForceRef(refLines, site.line)) continue

    // Not guarded — check allowlist before reporting.
    const hit = isAllowlisted(allowlist, INV_SEAM_RECHECK, rel, site.line)
    if (hit) {
      console.log(`allowlisted: ${INV_SEAM_RECHECK} @ ${rel}:${site.line} (expires ${hit.expires})`)
      allowlistedCount++
      continue
    }
    violations.push({
      invariant: INV_SEAM_RECHECK,
      file: rel,
      line: site.line,
      detail: `${site.kind} call site has no enclosing inject.${site.forceName} guard`,
    })
  }
  return { violations, allowlisted: allowlistedCount, siteCount: sites.length }
}

// ── Invariant #3 — Trace-seeded watcher ──────────────────────────────────
/**
 * For each function-like node in `scripts/test/**\/*.ts`:
 *   - PRECONDITION: body contains `startNovel(...)` call OR
 *     `apiPost("/api/novel/start", ...)` call.
 *   - Event consumption evidence:
 *     (a) string literal matching /^(gate:|phase:|llm-call-|trace$|error$|done$)/
 *     (b) PropertyAccess/ElementAccess on `event|e|evt|gateEvent|sseEvent|*Event|*Evt`
 *         for members {eventType, type, data, chapter, agent}
 *     (c) fetch to URL containing `/api/novel/` + (`/events` OR `/trace`)
 *   - If BOTH, body MUST also contain `watchForExpectations(...)` or
 *     `watchForTerminal(...)` (same body — subtree walk).
 */
const EVENT_MEMBER_NAMES = new Set(["eventType", "type", "data", "chapter", "agent"])
const EVENT_IDENT_SUFFIX = /(^event$|^e$|^evt$|^gateEvent$|^sseEvent$|Event$|Evt$)/

function bodyStartsNovel(body: ts.Node): boolean {
  let found = false
  function visit(n: ts.Node) {
    if (found) return
    if (ts.isCallExpression(n)) {
      const cal = n.expression
      if (ts.isIdentifier(cal) && cal.text === "startNovel") {
        found = true
        return
      }
      if (
        ts.isIdentifier(cal) &&
        cal.text === "apiPost" &&
        n.arguments.length >= 1 &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        (n.arguments[0] as ts.StringLiteralLike).text === "/api/novel/start"
      ) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  return found
}

function bodyConsumesEvents(body: ts.Node): boolean {
  let found = false
  function visit(n: ts.Node) {
    if (found) return
    // (a) event-type literal prefixes
    if (ts.isStringLiteralLike(n)) {
      const s = (n as ts.StringLiteralLike).text
      if (/^(gate:|phase:|llm-call-)/.test(s) || s === "trace" || s === "error" || s === "done") {
        found = true
        return
      }
      // (c) URL endpoint detection
      if (/\/api\/novel\/.+\/(events|trace)\b/.test(s) || /\/api\/novel\/\$\{[^}]+\}\/(events|trace)\b/.test(s)) {
        found = true
        return
      }
    }
    if (ts.isTemplateExpression(n)) {
      const raw = n.getText()
      if (/\/api\/novel\/[^`]+\/(events|trace)\b/.test(raw)) {
        found = true
        return
      }
    }
    // (b) event-shaped property accesses
    if (ts.isPropertyAccessExpression(n)) {
      const obj = n.expression
      const mem = n.name.text
      if (ts.isIdentifier(obj) && EVENT_IDENT_SUFFIX.test(obj.text) && EVENT_MEMBER_NAMES.has(mem)) {
        found = true
        return
      }
      // Optional-chain access (a?.b) is represented as PropertyAccess with
      // questionDotToken — ts-morph handles it in .expression too, so the
      // base case above covers it. Also handle nested: `e.data?.eventType`.
      if (ts.isPropertyAccessExpression(obj)) {
        const base = obj.expression
        if (ts.isIdentifier(base) && EVENT_IDENT_SUFFIX.test(base.text) && EVENT_MEMBER_NAMES.has(mem)) {
          found = true
          return
        }
      }
    }
    if (ts.isElementAccessExpression(n)) {
      const obj = n.expression
      if (ts.isIdentifier(obj) && EVENT_IDENT_SUFFIX.test(obj.text)) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  return found
}

function bodyHasWatcher(body: ts.Node): boolean {
  let found = false
  function visit(n: ts.Node) {
    if (found) return
    if (ts.isCallExpression(n)) {
      const cal = n.expression
      if (ts.isIdentifier(cal) && (cal.text === "watchForExpectations" || cal.text === "watchForTerminal")) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  return found
}

function collectFunctionBodies(sf: ts.SourceFile): { body: ts.Node; line: number }[] {
  const out: { body: ts.Node; line: number }[] = []
  function visit(n: ts.Node) {
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n)) &&
      n.body
    ) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
      out.push({ body: n.body, line })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

function checkTraceWatcher(
  files: string[],
  allowlist: AllowlistEntry[],
): { violations: Violation[]; allowlisted: number; siteCount: number } {
  const violations: Violation[] = []
  let allowlistedCount = 0
  let siteCount = 0
  for (const abs of files) {
    const rel = relPath(abs)
    const src = readFileSync(abs, "utf8")
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const bodies = collectFunctionBodies(sf)
    for (const { body, line } of bodies) {
      if (!bodyStartsNovel(body)) continue
      if (!bodyConsumesEvents(body)) continue
      siteCount++
      if (bodyHasWatcher(body)) continue
      const hit = isAllowlisted(allowlist, INV_WATCHER, rel, line)
      if (hit) {
        console.log(`allowlisted: ${INV_WATCHER} @ ${rel}:${line} (expires ${hit.expires})`)
        allowlistedCount++
        continue
      }
      violations.push({
        invariant: INV_WATCHER,
        file: rel,
        line,
        detail:
          "function starts novel + consumes events but has no watchForExpectations/watchForTerminal call",
      })
    }
  }
  return { violations, allowlisted: allowlistedCount, siteCount }
}

// ── Invariant #5 — Body-already-used detection (AST) ─────────────────────
/**
 * AST detector for double-consumes of Response body streams. Flags any
 * source-ordered pair of body-consuming method calls (`.text()`, `.json()`,
 * `.arrayBuffer()`, `.blob()`) on the same receiver within the same
 * enclosing function, method-name-agnostic.
 *
 * Widened from the earlier template-literal regex per `docs/plans/
 * 2026-04-19-t1-invariant-5-ast.md` (exp #244). The regex caught only the
 * commit-5505985 template-literal shape; the AST walk catches plain
 * sequential double-consumes as well.
 *
 * Grouping key (Codex review `ac53ffe9` MEDIUM): `(file, receiverDeclaration,
 * enclosingFunction)` when the receiver resolves to a local declaration,
 * falling back to `(file, name, enclosingFunction)` for property-access
 * receivers or parameters of outer closures. Name-only grouping was wrong
 * — it conflated shadowed bindings.
 *
 * Reachability heuristic (conservative — only flag real bugs): suppress a
 * pair when the FIRST call sits inside an `IfStatement` branch (then or
 * else) that terminates in `throw` or `return` AND the SECOND call is a
 * sibling statement in the enclosing block positioned AFTER the
 * IfStatement. This matches the 4 HEAD `if (!res.ok) throw ... ${await
 * res.text()}; const j = await res.json()` sites. Anything else flags.
 */
const BODY_METHODS = new Set(["text", "json", "arrayBuffer", "blob"])

interface BodyConsumeSite {
  call: ts.CallExpression
  method: string
  line: number
  // Receiver identification:
  //   - `decl` is the VariableDeclaration / ParameterDeclaration / BindingElement
  //     where the receiver identifier was declared, if resolvable locally.
  //   - `fallbackKey` is a stable string keying by enclosing function + receiver
  //     shape (identifier name or property access) when decl is null.
  decl: ts.Node | null
  fallbackKey: string
  enclosingFn: ts.Node
}

function enclosingFunctionOf(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isConstructorDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n) ||
      ts.isSourceFile(n)
    ) {
      return n
    }
    n = n.parent
  }
  return node.getSourceFile()
}

/**
 * Resolve an Identifier to its nearest declaration node in the current
 * source file, walking the scope chain outward from the identifier's
 * position. Returns null if the identifier isn't declared locally (imports,
 * globals, closure captures beyond the file).
 *
 * Scan is lexical: variable/param/binding nodes that contain the usage and
 * whose declared identifier matches by text.
 */
function resolveIdentifierDeclaration(
  id: ts.Identifier,
  enclosingFn: ts.Node,
): ts.Node | null {
  const name = id.text
  let match: ts.Node | null = null
  function visit(n: ts.Node) {
    if (match) return
    // Don't descend into nested functions (different scope).
    if (
      n !== enclosingFn &&
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n))
    ) {
      // Still check parameter list of the nested function if the usage is inside it.
      if (id.pos >= n.pos && id.end <= n.end) {
        ts.forEachChild(n, visit)
      }
      return
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      match = n
      return
    }
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      match = n
      return
    }
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      match = n
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(enclosingFn)
  return match
}

/**
 * Describe the receiver of a property-access expression as a stable
 * fallback key string. Covers identifiers and simple property chains
 * (e.g. `this.res`, `state.response`). Fall back to the raw text for
 * anything weirder.
 */
function receiverKey(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return `ident:${expr.text}`
  if (ts.isPropertyAccessExpression(expr)) {
    return `${receiverKey(expr.expression)}.${expr.name.text}`
  }
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return "this"
  return `text:${expr.getText()}`
}

function collectBodyConsumeSites(sf: ts.SourceFile): BodyConsumeSite[] {
  const sites: BodyConsumeSite[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        const method = callee.name.text
        if (BODY_METHODS.has(method) && node.arguments.length === 0) {
          const receiver = callee.expression
          // Skip receivers that construct a fresh object at each call site
          // (NewExpression, CallExpression, ParenthesizedExpression wrapping
          // either). Each invocation yields a different Response-like
          // instance, so pairing two such calls is spurious.
          const unwrapped = ts.isParenthesizedExpression(receiver)
            ? receiver.expression
            : receiver
          if (ts.isNewExpression(unwrapped) || ts.isCallExpression(unwrapped)) {
            ts.forEachChild(node, visit)
            return
          }
          const enclosingFn = enclosingFunctionOf(node)
          let decl: ts.Node | null = null
          let fallbackKey: string
          if (ts.isIdentifier(receiver)) {
            decl = resolveIdentifierDeclaration(receiver, enclosingFn)
            fallbackKey = `ident:${receiver.text}`
          } else {
            fallbackKey = receiverKey(receiver)
          }
          sites.push({
            call: node,
            method,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            decl,
            fallbackKey,
            enclosingFn,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return sites
}

/**
 * Return true iff `stmt` terminates its containing block unconditionally
 * via throw or return (allowing a trailing block statement, a single throw
 * expression, etc.). Recurses into the then/else branches of IfStatements
 * only when the statement itself is an IfStatement.
 */
function blockEndsInThrowOrReturn(stmt: ts.Statement): boolean {
  if (
    ts.isThrowStatement(stmt) ||
    ts.isReturnStatement(stmt) ||
    ts.isContinueStatement(stmt) ||
    ts.isBreakStatement(stmt)
  ) {
    return true
  }
  if (ts.isBlock(stmt)) {
    const last = stmt.statements[stmt.statements.length - 1]
    return last !== undefined && blockEndsInThrowOrReturn(last)
  }
  if (ts.isIfStatement(stmt)) {
    if (!stmt.elseStatement) return false
    return blockEndsInThrowOrReturn(stmt.thenStatement) && blockEndsInThrowOrReturn(stmt.elseStatement)
  }
  if (ts.isTryStatement(stmt)) {
    // A try-statement terminates iff its try-block terminates AND, if a
    // catch clause exists, the catch-block also terminates. A finally
    // block that unconditionally returns/throws makes it terminate too.
    if (stmt.finallyBlock && blockEndsInThrowOrReturn(stmt.finallyBlock)) return true
    const tryEnds = blockEndsInThrowOrReturn(stmt.tryBlock)
    const catchEnds =
      !stmt.catchClause || blockEndsInThrowOrReturn(stmt.catchClause.block)
    return tryEnds && catchEnds
  }
  return false
}

/**
 * Return true iff every execution path that enters `stmt` exits `stmt` via
 * throw or return (i.e. control flow never falls through to the statement
 * after `stmt` in the enclosing block).
 *
 * Covers:
 *   - ThrowStatement / ReturnStatement (trivially terminal).
 *   - Block: terminates iff its last statement terminates (recursively),
 *     OR iff any statement inside it terminates the containing function —
 *     use the "last-statement" approximation; it's conservative (returns
 *     false when unsure) and matches the patterns we care about.
 *   - IfStatement: terminates iff BOTH then-branch terminates AND an else
 *     branch exists that terminates. If no else branch, fall-through is
 *     possible → not terminal.
 *   - SwitchStatement: not handled — conservative false.
 */
function alwaysTerminates(stmt: ts.Statement): boolean {
  return blockEndsInThrowOrReturn(stmt)
}

/**
 * Returns the nearest enclosing Statement ancestor (the one whose parent
 * is a Block, SourceFile, ModuleBlock, CaseClause, DefaultClause, or
 * another container). Used to find sibling-position ordering.
 */
function enclosingStatement(node: ts.Node): ts.Statement | null {
  let n: ts.Node | undefined = node
  while (n) {
    if (
      n.parent &&
      (ts.isBlock(n.parent) ||
        ts.isSourceFile(n.parent) ||
        ts.isModuleBlock(n.parent) ||
        ts.isCaseClause(n.parent) ||
        ts.isDefaultClause(n.parent))
    ) {
      if (
        ts.isStatement(n) ||
        ts.isVariableStatement(n) ||
        ts.isExpressionStatement(n) ||
        ts.isIfStatement(n) ||
        ts.isReturnStatement(n) ||
        ts.isThrowStatement(n) ||
        ts.isBlock(n)
      ) {
        return n as ts.Statement
      }
    }
    n = n.parent
  }
  return null
}

/**
 * Heuristic: is the first call made unreachable-before-`second` by a
 * short-circuit control-flow idiom?
 *
 * Strategy: find the nearest common ancestor block of the two calls. The
 * first call sits inside some top-level child statement `A` of that block;
 * the second sits inside a different top-level child statement `B` (or the
 * same one — in which case fall-through applies). If `A` precedes `B` in
 * source order AND `A` always terminates control flow (every path through
 * `A` throws or returns), then control never falls through from the first
 * call to the second → suppress.
 *
 * This covers:
 *   - `if (!ok) throw ...; second`  (A = IfStatement with terminating then-branch
 *     and no else — doesn't always-terminate, BUT since second runs only when
 *     the if condition is false, and first is inside the then-branch, they're
 *     mutually exclusive; we want to suppress this case.)
 *   - Multiple sibling route branches: `if (path==="a") { first; return }`
 *     then later `if (path==="b") { second; return }` — first's containing
 *     IfStatement has a terminating then-branch; if path === "a" we return
 *     and never reach second; if path !== "a" we never entered first. Either
 *     way, they're mutually exclusive.
 *
 * Refined rule: suppress iff A precedes B AND the branch of A containing
 * first terminates in throw/return. Rationale: if the branch containing
 * first terminates, there's no path from first to second that stays in
 * source order (either first aborts, or first was never entered).
 */
function firstUnreachableBeforeSecond(
  first: ts.CallExpression,
  second: ts.CallExpression,
): boolean {
  // Walk `first` up to each enclosing Statement ancestor. For each, check
  // whether `second` is in a LATER sibling of the same parent block AND
  // whether the branch-of-first terminates.
  let firstAncestor: ts.Node | undefined = first
  while (firstAncestor) {
    const parent = firstAncestor.parent
    if (!parent) break
    if (
      ts.isBlock(parent) ||
      ts.isSourceFile(parent) ||
      ts.isModuleBlock(parent) ||
      ts.isCaseClause(parent) ||
      ts.isDefaultClause(parent)
    ) {
      // firstAncestor is a top-level statement in `parent`. Is second in a
      // later sibling of the same parent?
      if (second.pos >= firstAncestor.end && second.end <= parent.end) {
        // Find second's direct child-of-parent ancestor.
        let secondAncestor: ts.Node | undefined = second
        while (secondAncestor && secondAncestor.parent !== parent) {
          secondAncestor = secondAncestor.parent
        }
        if (secondAncestor && secondAncestor !== firstAncestor && secondAncestor.pos >= firstAncestor.end) {
          // Check the branch of firstAncestor containing `first` terminates.
          if (branchContainingTerminates(firstAncestor as ts.Node, first)) {
            return true
          }
        }
      }
    }
    firstAncestor = parent
  }
  return false
}

/**
 * Given a statement `stmt` containing `inner`, check whether the smallest
 * sub-branch of `stmt` that contains `inner` terminates in throw/return.
 *
 * - If stmt is an IfStatement: identify which branch (then/else) contains
 *   inner; return whether that branch's last statement terminates.
 * - If stmt is a Block: return whether its last statement terminates
 *   (inner must be somewhere inside; if first call aborts before the
 *   last, it's still terminated at block exit).
 * - If stmt is a VariableStatement / ExpressionStatement containing inner:
 *   stmt does not terminate (falls through).
 * - Otherwise: false (conservative).
 */
function branchContainingTerminates(stmt: ts.Node, inner: ts.Node): boolean {
  if (ts.isThrowStatement(stmt) || ts.isReturnStatement(stmt)) return true
  if (ts.isIfStatement(stmt)) {
    const inThen = inner.pos >= stmt.thenStatement.pos && inner.end <= stmt.thenStatement.end
    const inElse =
      stmt.elseStatement !== undefined &&
      inner.pos >= stmt.elseStatement.pos &&
      inner.end <= stmt.elseStatement.end
    if (inThen) return blockEndsInThrowOrReturn(stmt.thenStatement) || alwaysTerminates(stmt.thenStatement)
    if (inElse) return blockEndsInThrowOrReturn(stmt.elseStatement!) || alwaysTerminates(stmt.elseStatement!)
    return false
  }
  if (ts.isBlock(stmt)) {
    const last = stmt.statements[stmt.statements.length - 1]
    return last !== undefined && (blockEndsInThrowOrReturn(last) || alwaysTerminates(last))
  }
  // For ForStatement, WhileStatement, etc.: treat as non-terminating
  // (loops may exit normally). Conservative.
  return false
}

function checkBodyAlreadyUsed(
  files: string[],
  allowlist: AllowlistEntry[],
): { violations: Violation[]; allowlisted: number; siteCount: number } {
  const violations: Violation[] = []
  let allowlistedCount = 0
  let siteCount = 0
  for (const abs of files) {
    const rel = relPath(abs)
    const src = readFileSync(abs, "utf8")
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const sites = collectBodyConsumeSites(sf)
    siteCount += sites.length

    // Group by (enclosingFn, receiver-key). receiver-key prefers the
    // declaration-node identity; falls back to the shape string.
    const groups = new Map<string, BodyConsumeSite[]>()
    for (const s of sites) {
      const receiverId = s.decl
        ? `decl@${(s.decl as any).pos}:${(s.decl as any).end}`
        : s.fallbackKey
      const fnId = `fn@${(s.enclosingFn as any).pos}:${(s.enclosingFn as any).end}`
      const key = `${fnId}::${receiverId}`
      let arr = groups.get(key)
      if (!arr) {
        arr = []
        groups.set(key, arr)
      }
      arr.push(s)
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue
      group.sort((a, b) => a.call.getStart(sf) - b.call.getStart(sf))
      // Check each source-ordered pair. Any reachable pair flags.
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const first = group[i]
          const second = group[j]
          if (firstUnreachableBeforeSecond(first.call, second.call)) continue
          // FLAG: violation reported at the SECOND call's line.
          const allowHit = isAllowlisted(allowlist, INV_BODY_USED, rel, second.line)
          if (allowHit) {
            console.log(
              `allowlisted: ${INV_BODY_USED} @ ${rel}:${second.line} (expires ${allowHit.expires})`,
            )
            allowlistedCount++
            // Only count one allowlist hit per pair; continue inner loop so
            // later pairs on the same receiver still get checked.
            continue
          }
          violations.push({
            invariant: INV_BODY_USED,
            file: rel,
            line: second.line,
            detail: `Response body consumed twice on same receiver: \`.${first.method}()\` @ line ${first.line} then \`.${second.method}()\` @ line ${second.line}`,
          })
        }
      }
    }
  }
  return { violations, allowlisted: allowlistedCount, siteCount }
}

// ── Target sets ──────────────────────────────────────────────────────────
const DRAFTING_PATH = "src/phases/drafting.ts"
const TEST_SCRIPT_GLOB_DIR = "scripts/test"
const FIXTURE_DIR = "tests/invariants-fixtures"

function collectScriptTestFiles(): string[] {
  return walkDir(resolve(REPO_ROOT, TEST_SCRIPT_GLOB_DIR), [".ts"], [
    "/lib/",
    "/node_modules/",
  ])
}

function collectAllSourceFiles(): string[] {
  const files: string[] = []
  files.push(...walkDir(resolve(REPO_ROOT, "src"), [".ts", ".tsx"], ["node_modules"]))
  files.push(
    ...walkDir(resolve(REPO_ROOT, "scripts"), [".ts"], [
      "node_modules",
    ]),
  )
  // Exclude fixture dir (intentional violations).
  return files.filter(f => !relPath(f).startsWith(FIXTURE_DIR))
}

// ── Reporting ────────────────────────────────────────────────────────────
function reportViolations(vs: Violation[]): void {
  for (const v of vs) {
    console.error(`INVARIANT_FAILURE: ${v.invariant}`)
    console.error(`  file: ${v.file}`)
    console.error(`  line: ${v.line}`)
    console.error(`  detail: ${v.detail}`)
  }
}

// ── Self-test mode ───────────────────────────────────────────────────────
/**
 * Runs the checker against each fixture in `tests/invariants-fixtures/`.
 * Expected expected-invariant is declared via a top-of-file comment:
 *   // expected-invariant-failure: <slug>
 *
 * Slug → invariant-name:
 *   seam-recheck-symmetry                                      → #2
 *   trace-seeded-watcher-for-post-start-event-assertions       → #3
 *   body-already-used-detection                                → #5
 */
const SLUG_TO_INV: Record<string, string> = {
  "seam-recheck-symmetry": INV_SEAM_RECHECK,
  "trace-seeded-watcher-for-post-start-event-assertions": INV_WATCHER,
  "body-already-used-detection": INV_BODY_USED,
}

function readExpectedSlug(abs: string): string | null {
  const src = readFileSync(abs, "utf8")
  const m = src.match(/^\/\/\s*expected-invariant-failure:\s*(\S+)/m)
  return m ? m[1] : null
}

function runSelfTest(): number {
  const fixtureDir = resolve(REPO_ROOT, FIXTURE_DIR)
  const fixtures = walkDir(fixtureDir, [".ts"], []).filter(
    p => !p.endsWith("README.md") && !relPath(p).endsWith("/README.ts"),
  )
  if (fixtures.length === 0) {
    console.error(`invariants-check --self-test: no fixtures found in ${FIXTURE_DIR}`)
    return 1
  }
  let failures = 0
  const allowlist: AllowlistEntry[] = [] // fixtures bypass allowlist
  for (const abs of fixtures) {
    const rel = relPath(abs)
    const slug = readExpectedSlug(abs)
    if (!slug) {
      console.error(`self-test FAIL: ${rel} has no \`// expected-invariant-failure: ...\` header`)
      failures++
      continue
    }
    const expected = SLUG_TO_INV[slug]
    if (!expected) {
      console.error(`self-test FAIL: ${rel} has unknown slug \`${slug}\``)
      failures++
      continue
    }
    // Dispatch based on expected invariant.
    let fired: Violation[] = []
    if (expected === INV_SEAM_RECHECK) {
      // Treat the fixture file as a stand-in for drafting.ts.
      const res = checkSeamRecheckSymmetry(rel, allowlist)
      fired = res.violations
    } else if (expected === INV_WATCHER) {
      const res = checkTraceWatcher([abs], allowlist)
      fired = res.violations
    } else if (expected === INV_BODY_USED) {
      const res = checkBodyAlreadyUsed([abs], allowlist)
      fired = res.violations
    }
    const matched = fired.find(v => v.invariant === expected)
    if (matched) {
      console.log(
        `self-test OK:   ${rel} fired ${expected} @ line ${matched.line}`,
      )
    } else {
      console.error(
        `self-test FAIL: ${rel} expected ${expected} to fire, got ${fired.length} violation(s):`,
      )
      for (const v of fired) console.error(`  - ${v.invariant} @ line ${v.line}: ${v.detail}`)
      failures++
    }
  }
  if (failures > 0) {
    console.error(`invariants-check --self-test: ${failures}/${fixtures.length} fixture(s) failed to fire`)
    return 1
  }
  console.log(`invariants-check --self-test: ${fixtures.length}/${fixtures.length} fixtures fired their expected invariants`)
  return 0
}

// ── Default scan mode ────────────────────────────────────────────────────
function runDefaultScan(targetFile: string | null): number {
  const allowlist = loadAllowlist()

  // #2
  let inv2: ReturnType<typeof checkSeamRecheckSymmetry>
  if (targetFile) {
    inv2 = checkSeamRecheckSymmetry(targetFile, allowlist)
  } else {
    inv2 = checkSeamRecheckSymmetry(DRAFTING_PATH, allowlist)
  }

  // #3
  const testFiles = targetFile ? [resolve(REPO_ROOT, targetFile)] : collectScriptTestFiles()
  const inv3 = checkTraceWatcher(testFiles, allowlist)

  // #5
  const allSources = targetFile ? [resolve(REPO_ROOT, targetFile)] : collectAllSourceFiles()
  const inv5 = checkBodyAlreadyUsed(allSources, allowlist)

  const allViolations = [...inv2.violations, ...inv3.violations, ...inv5.violations]
  const totalSites = inv2.siteCount + inv3.siteCount + inv5.siteCount

  if (allViolations.length > 0) {
    reportViolations(allViolations)
    console.error(
      `\ninvariants-check: 3 syntactic invariants, ${totalSites} sites scanned, ${allViolations.length} violation(s)`,
    )
    return 1
  }
  console.log(
    `invariants-check: 3 syntactic invariants, ${totalSites} sites scanned, 0 violations`,
  )
  return 0
}

// ── Main ─────────────────────────────────────────────────────────────────
const { selfTest, target } = parseArgs(process.argv.slice(2))
const code = selfTest ? runSelfTest() : runDefaultScan(target)
process.exit(code)
