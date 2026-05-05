import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import db from "../db/connection"
import { createNovel } from "../db/novels"
import { saveChapterDraft } from "../db/drafts"
import { saveChapterOutline } from "../db/outlines"
import { dbReachable } from "../db/test-helpers"
import { handleChapterHealthRoute } from "./chapter-health-routes"
import type { ChapterOutline, SceneBeat } from "../types"

const reachable = await dbReachable()

async function invoke(method: string, path: string): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  return handleChapterHealthRoute(new Request(url, { method }), url)
}

describe("handleChapterHealthRoute — non-matching and validation", () => {
  test("POST on chapter-health returns null", async () => {
    expect(await invoke("POST", "/api/novel/x/chapter-health")).toBeNull()
  })

  test("unknown path returns null", async () => {
    expect(await invoke("GET", "/api/novel/x/not-chapter-health")).toBeNull()
  })

  test("invalid chapter query returns 400 before DB access", async () => {
    const res = await invoke("GET", "/api/novel/x/chapter-health?chapter=1.2")
    expect(res?.status).toBe(400)
    expect(await res?.json()).toEqual(expect.objectContaining({
      ok: false,
      error: "invalid chapter query parameter",
    }))
  })
})

describe.skipIf(!reachable)("handleChapterHealthRoute (DB-backed)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-chapter-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A forged ledger hides a cure.",
      genre: "fantasy",
      characters: [],
      chapterCount: 1,
    })
    await db`UPDATE novels SET total_chapters = 1 WHERE id = ${novelId}`
    await saveChapterOutline(novelId, chapterOutline())
    await saveChapterDraft(novelId, 1, longProse(["Istra", "ledger", "verdict", "shatters", "council", '"Look."']), 520)
  })

  afterEach(async () => {
    await db`DELETE FROM proposal_checker_observations WHERE novel_id = ${novelId}`
    await db`DELETE FROM proposal_envelopes WHERE novel_id = ${novelId}`
    await db`DELETE FROM pipeline_events WHERE novel_id = ${novelId}`
    await db`DELETE FROM issues WHERE novel_id = ${novelId}`
    await db`DELETE FROM chapter_exhaustions WHERE novel_id = ${novelId}`
    await db`DELETE FROM chapter_drafts WHERE novel_id = ${novelId}`
    await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("GET /chapter-health returns draft, outline, validation, and stable refs", async () => {
    const res = await invoke("GET", `/api/novel/${novelId}/chapter-health?chapter=1`)
    expect(res?.status).toBe(200)
    const body = await res!.json()

    expect(body.ok).toBe(true)
    expect(body.novelId).toBe(novelId)
    expect(body.summary.chapterCount).toBe(1)
    expect(body.chapters[0].chapterId).toBe("ch-001-ledger-test")
    expect(body.chapters[0].draft.version).toBe(1)
    expect(body.chapters[0].draft.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.chapters[0].outline.beatRefs).toContain("beat-ledger-verdict")
  })
})

function chapterOutline(): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-ledger-test",
    title: "Ledger Test",
    povCharacter: "Istra",
    povCharacterId: "char-istra",
    setting: "The infirmary",
    purpose: "Reveal the forged ledger.",
    targetWords: 600,
    charactersPresent: ["Istra"],
    charactersPresentIds: ["char-istra"],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "The ledger is forged.", category: "knowledge" },
    ],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes: [sceneBeat()],
  } as ChapterOutline
}

function sceneBeat(): SceneBeat {
  return {
    description: "Ledger verdict shatters the council.",
    characters: ["Istra"],
    kind: "action",
    beatId: "beat-ledger-verdict",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [{
        obligationId: "obl-ledger-fact",
        sourceId: "fact-ledger-forgery",
        sourceKind: "fact",
        text: "The ledger is forged.",
      } as any],
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

function longProse(seedWords: string[]): string {
  const filler = Array.from({ length: 520 - seedWords.length }, (_, index) => `word${index}`)
  return [...seedWords, ...filler].join(" ")
}
