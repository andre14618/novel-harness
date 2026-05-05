import { describe, expect, test } from "bun:test"
import { handlePlanningProposalRoute } from "./planning-proposal-routes"

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  return handlePlanningProposalRoute(new Request(url, init), url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe("handlePlanningProposalRoute - non-matching paths", () => {
  test("DELETE on planning-proposals returns method not allowed", async () => {
    const res = await invoke("DELETE", "/api/novel/x/planning-proposals")
    expect(res?.status).toBe(405)
  })

  test("POST on planning proposal diff returns method not allowed", async () => {
    const res = await invoke("POST", "/api/novel/x/planning-proposals/envelope-1/diff")
    expect(res?.status).toBe(405)
  })

  test("unknown path returns null", async () => {
    expect(await invoke("POST", "/api/novel/x/not-planning-proposals")).toBeNull()
  })
})

describe("handlePlanningProposalRoute - create validation before DB lookup", () => {
  test("rejects malformed JSON before target lookup", async () => {
    const url = new URL("http://localhost/api/novel/missing-novel/planning-proposals")
    const res = await handlePlanningProposalRoute(
      new Request(url, {
        method: "POST",
        body: "{",
        headers: { "content-type": "application/json" },
      }),
      url,
    )

    const { status, body } = await expectJson(res)
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toContain("malformed json")
  })

  test("rejects invalid target shape before target lookup", async () => {
    const { status, body } = await expectJson(await invoke(
      "POST",
      "/api/novel/missing-novel/planning-proposals",
      {
        target: {
          kind: "chapter_outline",
          ref: "ch-001",
          fieldPath: "notEditable",
        },
        proposedValue: "new purpose",
      },
    ))

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("invalid request body")
    expect(body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: expect.stringMatching(/^target(?:\.fieldPath)?$/),
        message: expect.stringContaining("Invalid"),
      }),
    ]))
  })

  test("rejects invalid proposed value before target lookup", async () => {
    const { status, body } = await expectJson(await invoke(
      "POST",
      "/api/novel/missing-novel/planning-proposals",
      {
        target: {
          kind: "chapter_outline",
          ref: "ch-001",
          fieldPath: "targetWords",
        },
        proposedValue: "many",
      },
    ))

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("targetWords must be a positive integer")
  })
})

describe("handlePlanningProposalRoute - resolve validation before DB lookup", () => {
  test("rejects modified resolution without modifiedPayload before envelope lookup", async () => {
    const { status, body } = await expectJson(await invoke(
      "POST",
      "/api/novel/missing-novel/planning-proposals/missing-envelope/resolve",
      { status: "modified", resolvedBy: "test" },
    ))

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("invalid request body")
    expect(body.issues).toContainEqual({
      path: "modifiedPayload",
      message: "modifiedPayload is required when status === \"modified\"",
    })
  })

  test("rejects malformed modifiedPayload shape before envelope lookup", async () => {
    const { status, body } = await expectJson(await invoke(
      "POST",
      "/api/novel/missing-novel/planning-proposals/missing-envelope/resolve",
      {
        status: "modified",
        resolvedBy: "test",
        modifiedPayload: {
          action: "field_replace",
          target: {
            kind: "chapter_outline",
            ref: "ch-001",
            fieldPath: "notEditable",
          },
          previousValue: "old purpose",
          proposedValue: "new purpose",
        },
      },
    ))

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("invalid request body")
    expect(body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "modifiedPayload.target.fieldPath",
        message: expect.stringContaining("Invalid"),
      }),
    ]))
  })
})
