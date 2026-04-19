// expected-invariant-failure: trace-seeded-watcher-for-post-start-event-assertions
//
// Script that calls startNovel() and then directly fetches
// /api/novel/:id/events WITHOUT going through the sse-watcher helper. This
// is the exact race class (R3/R4) that scripts/test/lib/sse-watcher.ts
// exists to prevent. Invariant #3 MUST fire on the enclosing function.
//
// Not run — intentionally unsafe. Referenced only via
// `scripts/lint/invariants-check.ts --self-test`.

// @ts-nocheck
/* eslint-disable */

declare const API_BASE: string

async function startNovel(seed: object): Promise<string> {
  const r = await fetch(`${API_BASE}/api/novel/start`, {
    method: "POST",
    body: JSON.stringify({ customSeed: seed, mode: "auto" }),
  })
  const data = (await r.json()) as { novelId: string }
  return data.novelId
}

async function main() {
  const novelId = await startNovel({ title: "fixture" })

  // Directly open the SSE stream without the trace-seeded helper.
  const resp = await fetch(`${API_BASE}/api/novel/${novelId}/events`)
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue
      const event = JSON.parse(line.slice(6)) as { type: string; data: unknown }
      if (event.type === "gate:plan-assist") {
        console.log("got gate:", event.data)
        return
      }
      if (event.type === "done") return
    }
  }
}

main()
