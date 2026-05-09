import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import db, { migrate } from "../db/connection"
import { createNovel } from "../db/novels"
import { getChapterOutline, saveChapterOutline } from "../db/outlines"
import { dbReachable } from "../db/test-helpers"
import { deleteEnvelopesForNovel } from "../db/proposal-envelopes"
import { deletePlanningMutationLineageForNovel } from "../db/planning-mutation-lineage"
import { handlePlanningProposalRoute } from "./planning-proposal-routes"
import type { ChapterOutline, SceneBeat } from "../types"

const reachable = await dbReachable()

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

describe.skipIf(!reachable)("handlePlanningProposalRoute (DB-backed)", () => {
  let novelId: string

  beforeAll(async () => {
    await migrate()
  })

  beforeEach(async () => {
    novelId = `test-planning-proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A trial exposes an oath road.",
      genre: "fantasy",
      characters: [],
    })
    await saveChapterOutline(novelId, outline())
  })

  afterEach(async () => {
    await deletePlanningMutationLineageForNovel(novelId)
    await deleteEnvelopesForNovel(novelId)
    await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("creates and applies a beat requirement removal planning edit", async () => {
    const created = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals`,
      {
        action: "beat_requirement_remove",
        target: {
          kind: "scene_plan",
          ref: "beat-route-1",
          fieldPath: "requirements",
        },
        proposedValue: {
          requiredCharacterIds: ["char-istra"],
          requiredWorldFactIds: ["world-oath-road"],
        },
        rationale: "Vey is present but no longer required to drive this beat.",
        source: { agent: "test" },
      },
    ))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.payload.action).toBe("beat_requirement_remove")
    expect(created.body.diff.before.value.requiredCharacterIds).toEqual(["char-istra", "char-vey"])
    expect(created.body.diff.after.value.requiredCharacterIds).toEqual(["char-istra"])

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${created.body.envelope.id}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))

    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)
    const persisted = await getChapterOutline(novelId, 1)
    expect((persisted.scenes[0] as any).requiredCharacterIds).toEqual(["char-istra"])
    expect((persisted.scenes[0] as any).requiredWorldFactIds).toEqual(["world-oath-road"])
  })

  test("rejects requirement edits that add IDs or remove too many IDs", async () => {
    const addUnknown = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals`,
      {
        action: "beat_requirement_remove",
        target: {
          kind: "scene_plan",
          ref: "beat-route-1",
          fieldPath: "requirements",
        },
        proposedValue: {
          requiredCharacterIds: ["char-istra", "char-vey", "char-new"],
          requiredWorldFactIds: ["world-oath-road"],
        },
      },
    ))
    expect(addUnknown.status).toBe(400)
    expect(addUnknown.body.error).toMatch(/cannot add IDs/)

    const removeTwo = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals`,
      {
        action: "beat_requirement_remove",
        target: {
          kind: "scene_plan",
          ref: "beat-route-1",
          fieldPath: "requirements",
        },
        proposedValue: {
          requiredCharacterIds: [],
          requiredWorldFactIds: ["world-oath-road"],
        },
      },
    ))
    expect(removeTwo.status).toBe(400)
    expect(removeTwo.body.error).toMatch(/removed more than one ID/)
  })
})

function outline(): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-route-1",
    title: "Oath Trial",
    povCharacter: "Istra",
    povCharacterId: "char-istra",
    setting: "Trial road",
    purpose: "Show the oath road law.",
    targetWords: 600,
    charactersPresent: ["Istra", "Vey"],
    charactersPresentIds: ["char-istra", "char-vey"],
    scenes: [beat()],
    establishedFacts: [],
  } as unknown as ChapterOutline
}

function beat(): SceneBeat {
  return {
    beatId: "beat-route-1",
    kind: "dialogue",
    description: "Istra faces Vey but the oath road does not change the choice.",
    characters: ["Istra", "Vey"],
    requiredCharacterIds: ["char-istra", "char-vey"],
    requiredWorldFactIds: ["world-oath-road"],
    mustEstablish: [],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
  } as unknown as SceneBeat
}
