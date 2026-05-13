import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import db from "../db/connection"
import { createNovel } from "../db/novels"
import { approveChapterDraft, saveChapterDraft } from "../db/drafts"
import { saveChapterOutline } from "../db/outlines"
import { dbReachable } from "../db/test-helpers"
import type { ChapterOutline } from "../types"
import { handleNovelRoute } from "./novel-routes"

const reachable = await dbReachable()

async function invoke(path: string): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  return handleNovelRoute(new Request(url, { method: "GET" }), url)
}

describe.skipIf(!reachable)("handleNovelRoute export", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-novel-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A contract blade tests the export route.",
      genre: "fantasy",
      characters: [],
      chapterCount: 2,
    })
    await db`
      UPDATE novels
      SET total_chapters = 2,
          seed_json = jsonb_set(seed_json, '{title}', to_jsonb(${"Export Route Test"}::text), true)
      WHERE id = ${novelId}
    `
    await saveChapterOutline(novelId, outline(1, "Approved Chapter"))
    await saveChapterOutline(novelId, outline(2, "Draft Chapter"))
    await saveChapterDraft(novelId, 1, "Approved prose.", 2)
    await approveChapterDraft(novelId, 1)
    await saveChapterDraft(novelId, 2, "Draft-only prose.", 2)
  })

  afterEach(async () => {
    await db`DELETE FROM chapter_drafts WHERE novel_id = ${novelId}`
    await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("approved-only JSON export filters without SQL fragment drift", async () => {
    const res = await invoke(`/api/novel/${novelId}/export?format=json&approved=true`)
    expect(res?.status).toBe(200)

    const body = await res!.json()
    expect(body.title).toBe("Export Route Test")
    expect(body.chapters).toHaveLength(1)
    expect(body.chapters[0]).toMatchObject({
      chapterNumber: 1,
      title: "Approved Chapter",
      status: "approved",
      prose: "Approved prose.",
    })
  })
})

function outline(chapterNumber: number, title: string): ChapterOutline {
  return {
    chapterNumber,
    chapterId: `ch-${chapterNumber.toString().padStart(3, "0")}-export-test`,
    title,
    povCharacter: "Kael",
    povCharacterId: "char-kael",
    setting: "Contract Hall",
    purpose: "Exercise the export route.",
    targetWords: 500,
    charactersPresent: ["Kael"],
    charactersPresentIds: ["char-kael"],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes: [],
  } as ChapterOutline
}
