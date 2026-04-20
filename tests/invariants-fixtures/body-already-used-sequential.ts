// expected-invariant-failure: body-already-used-detection
//
// Plain sequential double-consume — the shape the regex detector never
// caught. The body of `res` is read twice via two body-consuming methods
// without any intervening short-circuit (throw / return). The AST
// detector must flag the second call.
//
// Not run — intentionally broken. Referenced only via
// `scripts/lint/invariants-check.ts --self-test`.

// @ts-nocheck
/* eslint-disable */

declare const API_BASE: string

async function consumeTwice(): Promise<{ a: string; b: unknown }> {
  const res = await fetch(`${API_BASE}/api/thing`)
  const a = await res.text()
  const b = await res.json()
  return { a, b }
}

export { consumeTwice }
