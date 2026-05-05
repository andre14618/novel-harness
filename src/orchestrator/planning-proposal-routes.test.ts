import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import db from "../db/connection"
import { createNovel, getNovel } from "../db/novels"
import {
  getChapterOutline,
  saveChapterOutline,
} from "../db/outlines"
import {
  getCharacterById,
  getStorySpine,
  getWorldBible,
  saveCharacter,
  saveStorySpine,
  saveWorldBible,
} from "../db/world"
import { deleteEnvelopesForNovel } from "../db/proposal-envelopes"
import {
  deletePlanningMutationLineageForNovel,
  findPlanningMutationLineageByProposal,
} from "../db/planning-mutation-lineage"
import { dbReachable } from "../db/test-helpers"
import { handlePlanningProposalRoute } from "./planning-proposal-routes"
import type { CharacterProfile, ChapterOutline, SceneBeat, StorySpine, WorldBible } from "../types"

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

describe("handlePlanningProposalRoute — non-matching paths", () => {
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

describe("handlePlanningProposalRoute — resolve validation (non-DB)", () => {
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

  beforeEach(async () => {
    novelId = `test-planning-proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A forged ledger hides the cure.",
      genre: "fantasy",
      characters: [],
      directives: {
        lockedCharacters: [],
        requiredBeats: [],
        forbidden: [],
        tonalAnchors: ["restrained gothic"],
        structuralConstraints: {
          povRotation: "",
          pacing: "",
        },
        rawNotes: "Keep the narration spare.",
      },
    })
    await saveWorldBible(novelId, worldBible())
    await saveStorySpine(novelId, storySpine())
    await saveCharacter(novelId, character())
    await saveChapterOutline(novelId, outline())
  })

  afterEach(async () => {
    await deletePlanningMutationLineageForNovel(novelId)
    await deleteEnvelopesForNovel(novelId)
    await db`DELETE FROM world_bibles WHERE novel_id = ${novelId}`
    await db`DELETE FROM story_spines WHERE novel_id = ${novelId}`
    await db`DELETE FROM characters WHERE novel_id = ${novelId}`
    await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("creates and approves a chapter-outline field proposal with lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "chapter_outline",
        ref: "ch-001-ledger-test",
        fieldPath: "purpose",
      },
      proposedValue: "Reveal the ledger and force Istra to choose.",
      rationale: "The choice needs to be explicit before drafting.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(created.body.diff.before.display).toBe("Reveal the forged ledger.")
    expect(created.body.diff.after.display).toBe("Reveal the ledger and force Istra to choose.")
    expect(created.body.impactPreview.impacts.map((impact: any) => impact.kind)).toContain("direct_target")

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)
    expect(resolved.body.applied).toBe(true)
    expect(resolved.body.status).toBe("approved")
    expect(resolved.body.diff.before.display).toBe("Reveal the forged ledger.")
    expect(resolved.body.diff.after.display).toBe("Reveal the ledger and force Istra to choose.")

    const persisted = await getChapterOutline(novelId, 1)
    expect(persisted.purpose).toBe("Reveal the ledger and force Istra to choose.")
    expect(persisted.chapterId).toBe("ch-001-ledger-test")

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      actorKind: "test",
      targetKind: "chapter_outline",
      previousRef: "ch-001-ledger-test",
      nextRef: "ch-001-ledger-test",
      fieldPath: "purpose",
    })
    expect(lineage?.affectedDownstreamRefs.some((ref) =>
      ref.kind === "chapter_outline" && ref.ref === "ch-001-ledger-test"
    )).toBe(true)
  })

  test("returns deterministic before/after diff for a pending planning proposal", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "chapter_outline",
        ref: "ch-001-ledger-test",
        fieldPath: "purpose",
      },
      proposedValue: "Reveal the ledger and force Istra into public risk.",
      rationale: "Preview the operator-facing diff before approval.",
    }))
    expect(created.status).toBe(200)

    const diff = await expectJson(await invoke(
      "GET",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/diff`,
    ))
    expect(diff.status).toBe(200)
    expect(diff.body.ok).toBe(true)
    expect(diff.body.envelopeId).toBe(created.body.envelope.id)
    expect(diff.body.diff.before.display).toBe("Reveal the forged ledger.")
    expect(diff.body.diff.after.display).toBe(
      "Reveal the ledger and force Istra into public risk.",
    )
    expect(diff.body.diff.changed).toBe(true)
    expect(diff.body.currentTarget.stale).toBe(false)
    expect(diff.body.impactPreview.impacts.map((impact: any) => impact.kind)).toContain("direct_target")
  })

  test("returns modified payload diff after modified resolution", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "chapter_outline",
        ref: "ch-001-ledger-test",
        fieldPath: "purpose",
      },
      proposedValue: "Reveal the ledger and force Istra into public risk.",
      rationale: "Queue a proposal for edit-before-approve.",
    }))
    expect(created.status).toBe(200)

    const modifiedPayload = {
      action: "field_replace",
      target: created.body.envelope.payload.target,
      previousValue: created.body.envelope.payload.previousValue,
      proposedValue: "Reveal the ledger and force Istra to risk the public record.",
      impactPreview: created.body.envelope.payload.impactPreview,
    }
    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "modified", resolvedBy: "test", modifiedPayload },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)
    expect(resolved.body.status).toBe("modified")
    expect(resolved.body.diff.after.display).toBe(
      "Reveal the ledger and force Istra to risk the public record.",
    )

    const diff = await expectJson(await invoke(
      "GET",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/diff`,
    ))
    expect(diff.status).toBe(200)
    expect(diff.body.status).toBe("modified")
    expect(diff.body.diff.before.display).toBe("Reveal the forged ledger.")
    expect(diff.body.diff.after.display).toBe(
      "Reveal the ledger and force Istra to risk the public record.",
    )
  })

  test("lists pending planning proposals", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "story_spine",
        ref: novelId,
        fieldPath: "theme",
      },
      proposedValue: "Truth costs comfort before it earns trust.",
      rationale: "Queue a proposal for the Planning Studio list.",
    }))
    expect(created.status).toBe(200)

    const listed = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/planning-proposals?status=pending`),
    )
    expect(listed.status).toBe(200)
    expect(listed.body.ok).toBe(true)
    expect(listed.body.envelopes.map((env: any) => env.id)).toContain(created.body.envelope.id)
  })

  test("creates and approves a planning-directive rawNotes proposal with lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "planning_directive",
        ref: "rawNotes",
        fieldPath: "rawNotes",
      },
      proposedValue: "Keep narration spare, concrete, and pressure-driven.",
      rationale: "Make the style directive more actionable.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.kind).toBe("planning_directive")
    expect(created.body.envelope.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(created.body.envelope.payload.previousValue).toBe("Keep the narration spare.")

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)

    const novel = await getNovel(novelId)
    expect(novel.seed.directives?.rawNotes).toBe(
      "Keep narration spare, concrete, and pressure-driven.",
    )

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      targetKind: "planning_directive",
      previousRef: "rawNotes",
      nextRef: "rawNotes",
      fieldPath: "rawNotes",
    })
  })

  test("creates and approves a character-bible speechPattern proposal with lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "character",
        ref: "char-istra",
        fieldPath: "speechPattern",
      },
      proposedValue: "Precise and guarded, with abrupt questions under pressure.",
      rationale: "Make Istra's voice more actionable.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.kind).toBe("character")
    expect(created.body.envelope.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(created.body.envelope.payload.previousValue).toBe("Precise, guarded, terse.")

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)

    const persisted = await getCharacterById(novelId, "char-istra")
    expect(persisted?.speechPattern).toBe(
      "Precise and guarded, with abrupt questions under pressure.",
    )

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      targetKind: "character",
      previousRef: "char-istra",
      nextRef: "char-istra",
      fieldPath: "speechPattern",
    })
  })

  test("creates and approves a world-bible setting proposal with lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "world_bible",
        ref: novelId,
        fieldPath: "setting",
      },
      proposedValue: "The bell city above a drowned archive.",
      rationale: "Make the setting more concrete.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.kind).toBe("world_bible")
    expect(created.body.envelope.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(created.body.envelope.payload.previousValue).toBe("The bell city")

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)

    const persisted = await getWorldBible(novelId)
    expect(persisted.setting).toBe("The bell city above a drowned archive.")

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      targetKind: "world_bible",
      previousRef: novelId,
      nextRef: novelId,
      fieldPath: "setting",
    })
  })

  test("creates and approves a story-spine theme proposal with lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "story_spine",
        ref: novelId,
        fieldPath: "theme",
      },
      proposedValue: "Truth costs comfort before it earns trust.",
      rationale: "Sharpen the story theme.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.kind).toBe("story_spine")
    expect(created.body.envelope.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(created.body.envelope.payload.previousValue).toBe("Truth versus comfort.")

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)

    const persisted = await getStorySpine(novelId)
    expect(persisted.theme).toBe("Truth costs comfort before it earns trust.")

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      targetKind: "story_spine",
      previousRef: novelId,
      nextRef: novelId,
      fieldPath: "theme",
    })
  })

  test("stale precondition prevents applying over a newer outline", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "chapter_outline",
        ref: "ch-001-ledger-test",
        fieldPath: "setting",
      },
      proposedValue: "The Bell Court",
    }))
    expect(created.status).toBe(200)

    const changed = outline({ setting: "The Bell Archive" })
    await saveChapterOutline(novelId, changed)

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(409)
    expect(resolved.body.error).toBe("stale-precondition")
    expect((await getChapterOutline(novelId, 1)).setting).toBe("The Bell Archive")
  })

  test("stale precondition prevents applying over a newer world bible", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "world_bible",
        ref: novelId,
        fieldPath: "history",
      },
      proposedValue: "The city rewrote its flood records twice.",
    }))
    expect(created.status).toBe(200)

    await saveWorldBible(novelId, {
      ...worldBible(),
      history: "The city buried the first flood record.",
    })

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(409)
    expect(resolved.body.error).toBe("stale-precondition")
    expect((await getWorldBible(novelId)).history).toBe("The city buried the first flood record.")
  })

  test("creates and approves a beat-plan field proposal with beat lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "beat_plan",
        ref: "ch-001-ledger-test-beat-001-ledger-breaks",
        fieldPath: "description",
      },
      proposedValue: "Istra proves the ledger is forged and chooses to accuse Aldric publicly.",
      rationale: "Make the beat carry the public choice.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.kind).toBe("beat_plan")
    expect(created.body.envelope.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)

    const persisted = await getChapterOutline(novelId, 1)
    expect(persisted.scenes[0].description).toBe(
      "Istra proves the ledger is forged and chooses to accuse Aldric publicly.",
    )
    expect(persisted.scenes[0].beatId).toBe("ch-001-ledger-test-beat-001-ledger-breaks")

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      targetKind: "beat_plan",
      previousRef: "ch-001-ledger-test-beat-001-ledger-breaks",
      nextRef: "ch-001-ledger-test-beat-001-ledger-breaks",
      fieldPath: "description",
    })
  })

  test("creates and approves a beat-obligation text proposal with obligation lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "beat_obligation",
        ref: "obl-ledger-fact",
        fieldPath: "text",
      },
      proposedValue: "Istra establishes Aldric falsified the plague ledgers.",
      rationale: "Make the obligation more writer-actionable.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.kind).toBe("beat_obligation")
    expect(created.body.envelope.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)

    const persisted = await getChapterOutline(novelId, 1)
    expect((persisted.scenes[0].obligations.mustEstablish[0] as any).text).toBe(
      "Istra establishes Aldric falsified the plague ledgers.",
    )
    expect((persisted.scenes[0].obligations.mustEstablish[0] as any).obligationId).toBe("obl-ledger-fact")

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      targetKind: "beat_obligation",
      previousRef: "obl-ledger-fact",
      nextRef: "obl-ledger-fact",
      fieldPath: "text",
    })
  })

  test("creates and approves a beat-obligation source-link proposal with obligation lineage", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "beat_obligation",
        ref: "obl-ledger-fact",
        fieldPath: "sourceLink",
      },
      proposedValue: {
        sourceId: "fact-aldrics-motive",
        sourceKind: "fact",
      },
      rationale: "Retarget the obligation to the more specific fact source.",
    }))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.envelope.kind).toBe("planning_edit")
    expect(created.body.envelope.target.kind).toBe("beat_obligation")
    expect(created.body.envelope.target.fieldPath).toBe("sourceLink")
    expect(created.body.envelope.payload.previousValue).toEqual({
      sourceId: "fact-ledger-forgery",
      sourceKind: "fact",
    })

    const resolved = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
      { status: "approved", resolvedBy: "test" },
    ))
    expect(resolved.status).toBe(200)
    expect(resolved.body.ok).toBe(true)

    const persisted = await getChapterOutline(novelId, 1)
    const obligation = persisted.scenes[0].obligations.mustEstablish[0] as any
    expect(obligation.sourceId).toBe("fact-aldrics-motive")
    expect(obligation.sourceKind).toBe("fact")
    expect(obligation.characterId).toBeUndefined()

    const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
    expect(lineage).toMatchObject({
      proposalId: created.body.envelope.id,
      proposalKind: "planning_edit",
      targetKind: "beat_obligation",
      previousRef: "obl-ledger-fact",
      nextRef: "obl-ledger-fact",
      fieldPath: "sourceLink",
    })
  })

  test("rejects source-link proposals that break obligation-list semantics", async () => {
    const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
      target: {
        kind: "beat_obligation",
        ref: "obl-ledger-fact",
        fieldPath: "sourceLink",
      },
      proposedValue: {
        sourceId: "know-istra-ledger-forgery",
        sourceKind: "knowledge",
        characterId: "char-istra",
      },
      rationale: "This cannot be a mustEstablish link.",
    }))

    expect(created.status).toBe(400)
    expect(created.body.ok).toBe(false)
    expect(created.body.error).toContain("mustEstablish cannot reference sourceKind knowledge")
  })
})

function character(): CharacterProfile {
  return {
    id: "char-istra",
    name: "Istra",
    role: "protagonist",
    backstory: "A chancel scribe who learned to mistrust official mercy.",
    traits: ["precise", "guarded"],
    speechPattern: "Precise, guarded, terse.",
    internalConflict: "She wants public truth but fears it will cost Wren.",
    avoids: "Appearing sentimental in public.",
    goals: "Expose the forged ledger.",
    fears: "Losing Wren to the false cure.",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  } as CharacterProfile
}

function worldBible(): WorldBible {
  return {
    setting: "The bell city",
    timePeriod: "Late industrial civic fantasy",
    geography: "Canal wards stacked over flooded archives.",
    politicalStructure: "A chancellor and public ledger courts.",
    technologyConstraints: "Clockwork and bells, no wireless systems.",
    socialCustoms: ["Public ledgers settle disputes."],
    sensoryPalette: "brass bells, wet stone, ink, fever smoke",
    rules: ["Bells carry witnessed memory."],
    locations: [],
    culture: "Scribes prize witnessed accuracy.",
    history: "The city survived a flood and made memory civic law.",
    systems: [],
    cultures: [],
  } as WorldBible
}

function storySpine(): StorySpine {
  return {
    acts: [],
    centralConflict: "Truth versus civic comfort",
    theme: "Truth versus comfort.",
    endingDirection: "Istra exposes the false cure and pays a public cost.",
  } as StorySpine
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-ledger-test",
    title: "Ledger Test",
    povCharacter: "Istra",
    povCharacterId: "char-istra",
    setting: "The Chancel Infirmary",
    purpose: "Reveal the forged ledger.",
    targetWords: 450,
    charactersPresent: ["Istra"],
    charactersPresentIds: ["char-istra"],
    scenes: [beat()],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "Aldric falsified the plague ledgers", category: "knowledge" },
      { id: "fact-aldrics-motive", fact: "Aldric forged ledgers to hide a failed cure", category: "knowledge" },
    ],
    knowledgeChanges: [
      {
        id: "know-istra-ledger-forgery",
        characterId: "char-istra",
        characterName: "Istra",
        knowledge: "Aldric falsified the plague ledgers",
        source: "deduced",
      } as any,
    ],
    characterStateChanges: [],
    ...overrides,
  } as ChapterOutline
}

function beat(): SceneBeat {
  return {
    description: "Istra proves the ledger is forged and chooses to protect Wren.",
    characters: ["Istra"],
    kind: "action",
    beatId: "ch-001-ledger-test-beat-001-ledger-breaks",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [
        {
          obligationId: "obl-ledger-fact",
          sourceId: "fact-ledger-forgery",
          sourceKind: "fact",
          text: "Aldric falsified the plague ledgers",
        } as any,
      ],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
  } as SceneBeat
}
