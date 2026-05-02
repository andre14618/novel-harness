/**
 * Reconnect-on-closed shim test for src/db/connection.ts.
 *
 * Verifies the recovery path that the parity test was hitting in the wild:
 * a long-running process holds a singleton SQL connection, the server (or
 * an idle timeout) closes it, and the next query throws
 * ERR_POSTGRES_CONNECTION_CLOSED. The Proxy now retries once with a fresh
 * connection so callers don't see the transient.
 *
 * We unit-test `withReconnect` and `isConnectionClosed` directly rather than
 * exercising the Proxy end-to-end. Bun.SQL's `end()` fires an unswallowable
 * close-callback rejection, so we can't realistically simulate a closed
 * connection from userland — the integration test would test Bun's
 * close-handler behavior, not our shim. The unit test verifies the contract
 * we actually own.
 */

import { describe, expect, test } from "bun:test"
import { isConnectionClosed, withReconnect } from "./connection"

describe("isConnectionClosed", () => {
  test("matches Bun.SQL connection-closed error code", () => {
    expect(isConnectionClosed({ code: "ERR_POSTGRES_CONNECTION_CLOSED", message: "Connection closed" })).toBe(true)
  })

  test("matches message variants when code missing", () => {
    expect(isConnectionClosed({ message: "Connection closed" })).toBe(true)
    expect(isConnectionClosed({ message: "connection terminated unexpectedly" })).toBe(true)
    expect(isConnectionClosed({ message: "connection reset by peer" })).toBe(true)
  })

  test("rejects unrelated errors", () => {
    expect(isConnectionClosed({ code: "ECONNREFUSED", message: "refused" })).toBe(false)
    expect(isConnectionClosed({ message: "syntax error at or near" })).toBe(false)
    expect(isConnectionClosed(null)).toBe(false)
    expect(isConnectionClosed(undefined)).toBe(false)
    expect(isConnectionClosed("string error")).toBe(false)
  })
})

describe("withReconnect", () => {
  test("returns first-call result when no error", async () => {
    let calls = 0
    const result = await withReconnect(() => { calls++; return "ok" })
    expect(result).toBe("ok")
    expect(calls).toBe(1)
  })

  test("retries once on connection-closed and resets singleton", async () => {
    let calls = 0
    let resets = 0
    const result = await withReconnect(
      () => {
        calls++
        if (calls === 1) {
          const err: any = new Error("Connection closed")
          err.code = "ERR_POSTGRES_CONNECTION_CLOSED"
          throw err
        }
        return "recovered"
      },
      () => { resets++ },
    )
    expect(result).toBe("recovered")
    expect(calls).toBe(2)
    expect(resets).toBe(1)
  })

  test("does not retry on unrelated errors", async () => {
    let calls = 0
    let resets = 0
    await expect(
      withReconnect(
        () => {
          calls++
          throw new Error("syntax error")
        },
        () => { resets++ },
      )
    ).rejects.toThrow("syntax error")
    expect(calls).toBe(1)
    expect(resets).toBe(0)
  })

  test("bubbles second-call failure when retry also fails", async () => {
    let calls = 0
    await expect(
      withReconnect(() => {
        calls++
        const err: any = new Error("Connection closed")
        err.code = "ERR_POSTGRES_CONNECTION_CLOSED"
        throw err
      })
    ).rejects.toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" })
    expect(calls).toBe(2)  // tried, retried, gave up
  })
})
