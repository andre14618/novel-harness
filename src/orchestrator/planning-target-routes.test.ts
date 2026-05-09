import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import db from "../db/connection"
import { createNovel } from "../db/novels"
import { saveCharacter, saveStorySpine, saveWorldBible } from "../db/world"
import { saveChapterOutline } from "../db/outlines"
import { dbReachable } from "../db/test-helpers"
import { deleteEnvelopesForNovel } from "../db/proposal-envelopes"
import {
  deleteProposalCheckerObservationsForNovel,
  deleteProposalResolutionImpactsForNovel,
  deleteProposalResolutionOutcomesForNovel,
} from "../db/proposal-resolution-outcomes"
import { handlePlanningTargetRoute } from "./planning-target-routes"
import type { CharacterProfile, ChapterOutline, SceneBeat, StorySpine, WorldBible } from "../types"

const reachable = await dbReachable()

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  return handlePlanningTargetRoute(new Request(url, init), url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe("handlePlanningTargetRoute — non-matching paths", () => {
  test("POST on planning-targets returns null", async () => {
    expect(await invoke("POST", "/api/novel/x/planning-targets")).toBeNull()
  })

  test("GET on planning-impact preview returns null", async () => {
    expect(await invoke("GET", "/api/novel/x/planning-impact/preview")).toBeNull()
  })

  test("unknown path returns null", async () => {
    expect(await invoke("GET", "/api/novel/x/not-planning-targets")).toBeNull()
  })
})

describe.skipIf(!reachable)("handlePlanningTargetRoute (DB-backed)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-planning-target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A forged ledger hides the cure.",
      genre: "fantasy",
      characters: [],
      directives: {
        tonalAnchors: ["quiet dread"],
      } as any,
    })
    await saveWorldBible(novelId, { setting: "The bell city" } as WorldBible)
    await saveCharacter(novelId, character("char-istra", "Istra"))
    await saveStorySpine(novelId, { centralConflict: "Truth versus comfort" } as StorySpine)
    await saveChapterOutline(novelId, outline())
  })

  afterEach(async () => {
    await deleteProposalCheckerObservationsForNovel(novelId)
    await deleteProposalResolutionImpactsForNovel(novelId)
    await deleteProposalResolutionOutcomesForNovel(novelId)
    await deleteEnvelopesForNovel(novelId)
    await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
    await db`DELETE FROM characters WHERE novel_id = ${novelId}`
    await db`DELETE FROM world_bibles WHERE novel_id = ${novelId}`
    await db`DELETE FROM story_spines WHERE novel_id = ${novelId}`
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("GET /planning-targets returns deterministic target refs and snapshot hash", async () => {
    const { status, body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/planning-targets`),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.novelId).toBe(novelId)
    expect(body.planningSnapshotVersion).toBe("v2")
    expect(body.planningSnapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.targets.map((target: any) => `${target.kind}:${target.ref}`)).toEqual(
      expect.arrayContaining([
        `world_bible:${novelId}`,
        `story_spine:${novelId}`,
        "character:char-istra",
        "chapter_outline:ch-001-ledger-test",
        "scene_plan:ch-001-ledger-test-beat-001-ledger-breaks",
        "beat_obligation:obl-ledger-fact",
        "world_fact:fact-ledger-forgery",
        "planning_directive:tonalAnchors",
      ]),
    )
  })

  test("GET /planning-targets/:kind/:ref returns one target", async () => {
    const { status, body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/planning-targets/character/char-istra`),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.target.kind).toBe("character")
    expect(body.target.ref).toBe("char-istra")
    expect(body.target.currentVersion).toMatch(/^[0-9a-f]{64}$/)
  })

  test("GET /planning-targets/:kind/:ref accepts legacy beat_plan alias", async () => {
    const { status, body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/planning-targets/beat_plan/ch-001-ledger-test-beat-001-ledger-breaks`),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.target.kind).toBe("scene_plan")
    expect(body.target.ref).toBe("ch-001-ledger-test-beat-001-ledger-breaks")
  })

  test("POST /planning-impact/preview returns deterministic downstream references", async () => {
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-impact/preview`, {
        target: { kind: "character", ref: "char-istra" },
      }),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.target.kind).toBe("character")
    expect(body.impacts.map((impact: any) => impact.kind)).toEqual(
      expect.arrayContaining(["direct_target", "snapshot_participation", "chapter_reference"]),
    )
    expect(body.impacts.some((impact: any) =>
      impact.kind === "chapter_reference" &&
      impact.target.kind === "chapter_outline" &&
      impact.target.ref === "ch-001-ledger-test"
    )).toBe(true)
  })

  test("POST /planning-impact/preview validates target kind", async () => {
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-impact/preview`, {
        target: { kind: "nope", ref: "x" },
      }),
    )

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("invalid request body")
  })
})

function character(id: string, name: string): CharacterProfile {
  return {
    id,
    name,
    role: "protagonist",
    backstory: "",
    traits: [],
    speechPattern: "",
    goals: "Expose the false cure.",
    fears: "Losing Wren.",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  } as CharacterProfile
}

function outline(): ChapterOutline {
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
    ],
    knowledgeChanges: [],
    characterStateChanges: [],
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
