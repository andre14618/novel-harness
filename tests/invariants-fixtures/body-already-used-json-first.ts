// expected-invariant-failure: body-already-used-detection
//
// Ordering-symmetry fixture. The rule must fire regardless of which
// body-consuming method comes first — `.json()` then `.text()` is equally
// a violation as the reverse. This locks in the detector's method-name-
// agnostic pairing so a future refactor can't accidentally special-case
// text→json ordering.
//
// Not run — intentionally broken. Referenced only via
// `scripts/lint/invariants-check.ts --self-test`.

// @ts-nocheck
/* eslint-disable */

declare const API_BASE: string

async function consumeJsonFirst(): Promise<{ j: unknown; t: string }> {
  const res = await fetch(`${API_BASE}/api/thing`)
  const j = await res.json()
  const t = await res.text()
  return { j, t }
}

export { consumeJsonFirst }
