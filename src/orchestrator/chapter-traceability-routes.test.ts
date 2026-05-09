import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import db from "../db/connection"
import { createNovel } from "../db/novels"
import { saveChapterOutline } from "../db/outlines"
import { dbReachable } from "../db/test-helpers"
import { handleChapterTraceabilityRoute } from "./chapter-traceability-routes"
import type { ChapterOutline, SceneBeat } from "../types"

const reachable = await dbReachable()

async function invoke(method: string, path: string): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  return handleChapterTraceabilityRoute(new Request(url, { method }), url)
}

describe("handleChapterTraceabilityRoute — non-matching and validation", () => {
  test("POST on chapter traceability returns null", async () => {
    expect(await invoke("POST", "/api/novel/x/traceability/chapter/1")).toBeNull()
  })

  test("unknown path returns null", async () => {
    expect(await invoke("GET", "/api/novel/x/not-traceability/chapter/1")).toBeNull()
  })

  test("invalid chapter path returns 400 before DB access", async () => {
    const res = await invoke("GET", "/api/novel/x/traceability/chapter/1.2")
    expect(res?.status).toBe(400)
    expect(await res?.json()).toEqual(expect.objectContaining({
      ok: false,
      error: "invalid chapter path parameter",
    }))
  })
})

describe.skipIf(!reachable)("handleChapterTraceabilityRoute (DB-backed)", () => {
  let novelId: string
  let runId: number

  beforeEach(async () => {
    novelId = `test-chapter-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A forged ledger hides a cure.",
      genre: "fantasy",
      characters: [],
      chapterCount: 1,
    })
    await db`UPDATE novels SET total_chapters = 1 WHERE id = ${novelId}`
    await saveChapterOutline(novelId, chapterOutline())
    const [run] = await db`
      INSERT INTO runs (run_type, model_config, label)
      VALUES ('traceability-test', ${{}}, ${novelId})
      RETURNING id
    `
    runId = (run as any).id
    await db`
      INSERT INTO llm_calls (
        run_id, agent, model, provider, chapter, novel_id, beat_index, beat_id,
        attempt, prompt_tokens, completion_tokens, request_json
      ) VALUES (
        ${runId}, 'beat-writer', 'test-model', 'test-provider', 1, ${novelId},
        0, 'beat-ledger-verdict', 1, 10, 20,
        ${{
          meta: {
            chapterId: "ch-001-ledger-test",
            beatId: "beat-ledger-verdict",
            obligationIds: ["obl-ledger-fact"],
            sourceIds: ["fact-ledger-forgery"],
          },
        }}
      )
    `
    await db`
      INSERT INTO pipeline_events (
        novel_id, chapter, beat_index, event_type, agent, payload
      ) VALUES (
        ${novelId}, 1, 0, 'llm-call-start', 'beat-writer',
        ${{
          chapterId: "ch-001-ledger-test",
          beatId: "beat-ledger-verdict",
          obligationIds: ["obl-ledger-fact"],
          sourceIds: ["fact-ledger-forgery"],
        }}
      )
    `
  })

  afterEach(async () => {
    await db`DELETE FROM pipeline_events WHERE novel_id = ${novelId}`
    await db`DELETE FROM llm_calls WHERE novel_id = ${novelId}`
    await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
    await db`DELETE FROM novels WHERE id = ${novelId}`
    await db`DELETE FROM runs WHERE id = ${runId}`
  })

  test("GET /traceability/chapter/:chapterNumber returns stable beat and evidence links", async () => {
    const res = await invoke("GET", `/api/novel/${novelId}/traceability/chapter/1`)
    expect(res?.status).toBe(200)
    const body = await res!.json()

    expect(body.ok).toBe(true)
    expect(body.novelId).toBe(novelId)
    expect(body.chapterId).toBe("ch-001-ledger-test")
    expect(body.planningSnapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.summary).toEqual(expect.objectContaining({
      beatCount: 1,
      linkedObligationCount: 1,
      writerCallCount: 1,
      traceEventCount: 1,
    }))
    expect(body.beats[0].beatId).toBe("beat-ledger-verdict")
    expect(body.beats[0].llmCalls[0].linkEvidence).toBe("beat_id")
    expect(body.beats[0].traceEvents[0].refs).toEqual(expect.arrayContaining([
      { kind: "scene_plan", ref: "beat-ledger-verdict" },
      { kind: "beat_obligation", ref: "obl-ledger-fact" },
    ]))
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
