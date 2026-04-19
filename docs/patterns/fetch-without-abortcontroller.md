---
pattern: fetch-without-abortcontroller
status: active
first-seen: 2026-04-19 (docs/sessions/2026-04-19-exhaustion-handler.md)
last-seen: 2026-04-19
---

# Fetch without AbortController hangs on silent socket drop

## Characterization

`fetch()` without an `AbortController` signal will hang indefinitely if the remote socket drops silently (no TCP RST, no EOF). The request hangs forever; no retry fires; no error surfaces. Looks identical to "the server is slow" until someone walks the code and realizes there's no timeout.

Common triggers:
- Intermittent provider-side connection handling (observed on DeepSeek)
- Proxies/load-balancers that drop idle connections
- Network-level packet loss at the wrong phase of the TCP lifecycle

Symptoms:
- One specific call far exceeds historical p99 latency (today: world-builder 7+ min vs p95 105s)
- Other calls in the same process complete normally — it's NOT a general provider outage
- Process stays "busy" but no progress; no error log; no retry attempt

## Sessions where seen

- 2026-04-19 — [exhaustion-handler session](../sessions/2026-04-19-exhaustion-handler.md) — DeepSeek world-builder call hung for 7+ minutes in a live test campaign. Direct `curl` probe to DeepSeek returned in 1.6s — provider was healthy. Fetch in `src/transport.ts:120` had no timeout. Fixed in `0e9b24d` + Codex-flagged retry-logic fix in `83772dd`.

## Canonical fix

Every outbound `fetch` MUST have an `AbortController` signal with a bounded timeout:

```ts
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(new Error("LLM fetch timeout")), timeoutMs)
let res: Response
try {
  res = await fetch(url, { ..., signal: controller.signal })
} catch (err) {
  // AbortError + network errors flow into the retry loop
  if (isAbortOrNetworkError(err)) { /* backoff + retry */ }
  throw err
} finally {
  clearTimeout(timer)
}
```

Three non-obvious rules (all from today's session):

1. **AbortError propagates BEFORE the status-code guard.** If your retry logic is `if (res.status === 429 || res.status >= 500) retry`, that check never runs on timeout. Wrap the `fetch` in try/catch and route abort errors INTO the retry path explicitly.

2. **Timeout-specific retry cap < overall retry cap.** Our initial implementation had `maxRetries = 3` → 4 attempts × 5min timeout = up to 20min worst-case. Cap timeout-specific retries at 2 total attempts so a truly-hung endpoint doesn't exceed downstream test/campaign budgets. Normal 429/5xx retries can still use the full `maxRetries`.

3. **Streaming body reads need a SEPARATE idle timeout.** The outer `fetch` timeout is cleared before the body is consumed. A server can send headers fast then stall mid-stream. Use a per-chunk `Promise.race` timeout in `consumeSSEStream()` — today we set it to 60s per chunk via `LLM_STREAM_IDLE_TIMEOUT_MS`.

Reference commits: `0e9b24d` (initial fetch timeout), `83772dd` (retry + streaming idle + log attribution).

## Anti-patterns

- **"5xx retry will catch it"** — 5xx requires the server to RESPOND with an error. Silent socket drop produces no response; 5xx never fires.
- **"We'll notice"** — 7 min went unnoticed in a live campaign today. The stall detector in the test runner caught it via SSE heartbeats, NOT via HTTP semantics.
- **"Just use a longer timeout"** — doesn't fix anything if the timeout is still finite OR if the default is `no timeout`. The question isn't "how long to wait" but "do we have a mechanism to stop waiting."

## Observability requirement

When the timeout DOES fire, log the specific call that hit it with enough context to debug:
- `[LLM] TIMEOUT: provider/model agent=X after Nms (attempt N/M)`
- Attribution requires `LLMRequest.callerId` being set — plumb it from every wrapper that knows the agent name. Shipped in `13f8143`.

## Related patterns

- Session-level: SSE-stream-consumer stalls are a peer concern — the test-runner's SSE watcher had analogous bugs (subscribe-after race, no hard-stall timer) caught by Codex threads `a2d16769d75b1d9cc` and `ab530b43a6716d937`.
