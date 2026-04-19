// expected-invariant-failure: body-already-used-detection
//
// Pre-commit-5505985 shape: the response body is consumed inside a
// template literal via `await decideR.text()` for logging, then consumed
// again via `await decideR.json()` when the actual parse is attempted.
// Fetch bodies are one-shot streams; the second call throws
// `TypeError: Body already used`.
//
// Invariant #5 MUST fire on the second consumption. Not run — intentionally
// broken. Referenced only via `scripts/lint/invariants-check.ts --self-test`.

// @ts-nocheck
/* eslint-disable */

declare const assert: (cond: unknown) => void
declare const API_BASE: string

async function decide(novelId: string): Promise<{ ok: boolean }> {
  const decideR = await fetch(`${API_BASE}/api/novel/${novelId}/gate/decide`, {
    method: "POST",
  })
  assert(`decide ${await decideR.text()}`)
  const body = (await decideR.json()) as { ok: boolean }
  return body
}

export { decide }
