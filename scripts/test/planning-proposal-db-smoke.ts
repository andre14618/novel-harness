import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import db from "../../src/db/connection"
import { createNovel } from "../../src/db/novels"
import {
  getChapterOutline,
  saveChapterOutline,
} from "../../src/db/outlines"
import {
  saveCharacter,
  saveStorySpine,
  saveWorldBible,
} from "../../src/db/world"
import { deleteEnvelopesForNovel } from "../../src/db/proposal-envelopes"
import {
  deletePlanningMutationLineageForNovel,
  findPlanningMutationLineageByProposal,
} from "../../src/db/planning-mutation-lineage"
import { dbReachable } from "../../src/db/test-helpers"
import { handlePlanningProposalRoute } from "../../src/orchestrator/planning-proposal-routes"
import type { CharacterProfile, ChapterOutline, SceneBeat, StorySpine, WorldBible } from "../../src/types"

type JsonResponse = { status: number; body: any }
type SmokeCase = {
  name: string
  run: (novelId: string) => Promise<void>
}

const CASE_TIMEOUT_MS = 20_000
const CASE_RETRIES = 1

const cases: SmokeCase[] = [
  {
    name: "create approve apply lineage",
    run: async (novelId) => {
      const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
        target: {
          kind: "chapter_outline",
          ref: "ch-001-ledger-test",
          fieldPath: "purpose",
        },
        proposedValue: "Reveal the ledger and force Istra to choose.",
        rationale: "The choice needs to be explicit before drafting.",
      }))

      assert.equal(created.status, 200)
      assert.equal(created.body.ok, true)
      assert.equal(created.body.envelope.kind, "planning_edit")
      assert.match(created.body.envelope.target.currentVersion, /^[0-9a-f]{64}$/)
      assert.equal(created.body.diff.before.display, "Reveal the forged ledger.")
      assert.equal(created.body.diff.after.display, "Reveal the ledger and force Istra to choose.")
      assert.ok(created.body.impactPreview.impacts.some((impact: any) => impact.kind === "direct_target"))

      const resolved = await expectJson(await invoke(
        "POST",
        `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
        { status: "approved", resolvedBy: "test" },
      ))
      assert.equal(resolved.status, 200)
      assert.equal(resolved.body.ok, true)
      assert.equal(resolved.body.applied, true)
      assert.equal(resolved.body.status, "approved")

      const persisted = await getChapterOutline(novelId, 1)
      assert.equal(persisted.purpose, "Reveal the ledger and force Istra to choose.")
      assert.equal(persisted.chapterId, "ch-001-ledger-test")

      const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
      assert.equal(lineage?.proposalId, created.body.envelope.id)
      assert.equal(lineage?.proposalKind, "planning_edit")
      assert.equal(lineage?.actorKind, "test")
      assert.equal(lineage?.targetKind, "chapter_outline")
      assert.equal(lineage?.previousRef, "ch-001-ledger-test")
      assert.equal(lineage?.nextRef, "ch-001-ledger-test")
      assert.equal(lineage?.fieldPath, "purpose")
      assert.ok(lineage?.affectedDownstreamRefs.some((ref) =>
        ref.kind === "chapter_outline" && ref.ref === "ch-001-ledger-test"
      ))
    },
  },
  {
    name: "modified resolution diff",
    run: async (novelId) => {
      const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
        target: {
          kind: "chapter_outline",
          ref: "ch-001-ledger-test",
          fieldPath: "purpose",
        },
        proposedValue: "Reveal the ledger and force Istra into public risk.",
        rationale: "Queue a proposal for edit-before-approve.",
      }))
      assert.equal(created.status, 200)

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
      assert.equal(resolved.status, 200)
      assert.equal(resolved.body.ok, true)
      assert.equal(resolved.body.status, "modified")
      assert.equal(
        resolved.body.diff.after.display,
        "Reveal the ledger and force Istra to risk the public record.",
      )

      const diff = await expectJson(await invoke(
        "GET",
        `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/diff`,
      ))
      assert.equal(diff.status, 200)
      assert.equal(diff.body.status, "modified")
      assert.equal(diff.body.diff.before.display, "Reveal the forged ledger.")
      assert.equal(
        diff.body.diff.after.display,
        "Reveal the ledger and force Istra to risk the public record.",
      )
    },
  },
  {
    name: "stale precondition",
    run: async (novelId) => {
      const created = await expectJson(await invoke("POST", `/api/novel/${novelId}/planning-proposals`, {
        target: {
          kind: "chapter_outline",
          ref: "ch-001-ledger-test",
          fieldPath: "setting",
        },
        proposedValue: "The Bell Court",
      }))
      assert.equal(created.status, 200)

      await saveChapterOutline(novelId, outline({ setting: "The Bell Archive" }))

      const resolved = await expectJson(await invoke(
        "POST",
        `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
        { status: "approved", resolvedBy: "test" },
      ))
      assert.equal(resolved.status, 409)
      assert.equal(resolved.body.error, "stale-precondition")
      assert.equal((await getChapterOutline(novelId, 1)).setting, "The Bell Archive")
    },
  },
  {
    name: "source-link apply lineage",
    run: async (novelId) => {
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

      assert.equal(created.status, 200)
      assert.equal(created.body.ok, true)
      assert.equal(created.body.envelope.kind, "planning_edit")
      assert.equal(created.body.envelope.target.kind, "beat_obligation")
      assert.equal(created.body.envelope.target.fieldPath, "sourceLink")

      const resolved = await expectJson(await invoke(
        "POST",
        `/api/novel/${novelId}/planning-proposals/${encodeURIComponent(created.body.envelope.id)}/resolve`,
        { status: "approved", resolvedBy: "test" },
      ))
      assert.equal(resolved.status, 200)
      assert.equal(resolved.body.ok, true)

      const obligation = (await getChapterOutline(novelId, 1))
        .scenes[0]
        .obligations.mustEstablish[0] as any
      assert.equal(obligation.sourceId, "fact-aldrics-motive")
      assert.equal(obligation.sourceKind, "fact")
      assert.equal(obligation.characterId, undefined)

      const lineage = await findPlanningMutationLineageByProposal(created.body.envelope.id)
      assert.equal(lineage?.proposalId, created.body.envelope.id)
      assert.equal(lineage?.proposalKind, "planning_edit")
      assert.equal(lineage?.targetKind, "beat_obligation")
      assert.equal(lineage?.previousRef, "obl-ledger-fact")
      assert.equal(lineage?.nextRef, "obl-ledger-fact")
      assert.equal(lineage?.fieldPath, "sourceLink")
    },
  },
  {
    name: "source-link semantic rejection",
    run: async (novelId) => {
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

      assert.equal(created.status, 400)
      assert.equal(created.body.ok, false)
      assert.match(created.body.error, /mustEstablish cannot reference sourceKind knowledge/)
    },
  },
]

const caseName = argValue("--case")
if (caseName) await runChild(caseName)
else await runParent()

async function runParent(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url)
  let failures = 0
  for (const smoke of cases) {
    let passed = false
    for (let attempt = 0; attempt <= CASE_RETRIES; attempt++) {
      const exitCode = await runChildProcess(scriptPath, smoke.name)
      if (exitCode === 0) {
        passed = true
        await sleep(1_000)
        break
      }
      if (attempt < CASE_RETRIES) {
        console.error(`RETRY ${smoke.name} after exit ${exitCode}`)
        await sleep(1_000)
      }
    }
    if (!passed) failures++
  }

  if (failures > 0) {
    console.error(`planning proposal DB smoke failed: ${failures}/${cases.length}`)
    process.exit(1)
  }

  console.log(`planning proposal DB smoke passed: ${cases.length}/${cases.length}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runChild(name: string): Promise<void> {
  if (!(await dbReachable())) {
    console.log("planning proposal DB smoke skipped: DB is not reachable")
    process.exit(0)
  }
  const smoke = cases.find((item) => item.name === name)
  if (!smoke) {
    console.error(`unknown planning proposal DB smoke case: ${name}`)
    process.exit(2)
  }

  const started = performance.now()
  const novelId = `test-planning-proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let shouldCleanup = false
  try {
    await seedNovel(novelId)
    shouldCleanup = true
    await withTimeout(smoke.run(novelId), smoke.name)
    console.log(`PASS ${smoke.name} ${Math.round(performance.now() - started)}ms`)
  } catch (err) {
    console.error(`FAIL ${smoke.name}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    if (err instanceof Error && err.message.includes("timed out after")) {
      process.exit(1)
    }
    process.exitCode = 1
  }

  if (shouldCleanup) {
    await cleanupNovel(novelId)
  }
}

async function runChildProcess(scriptPath: string, name: string): Promise<number> {
  const proc = Bun.spawn({
    cmd: ["bun", scriptPath, "--case", name],
    stdout: "inherit",
    stderr: "inherit",
  })
  const timeout = setTimeout(() => {
    console.error(`KILL ${name} after ${CASE_TIMEOUT_MS + 5_000}ms`)
    proc.kill()
  }, CASE_TIMEOUT_MS + 5_000)
  try {
    return await proc.exited
  } finally {
    clearTimeout(timeout)
  }
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  return process.argv[index + 1] ?? null
}

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  return handlePlanningProposalRoute(new Request(url, init), url)
}

async function expectJson(res: Response | null): Promise<JsonResponse> {
  assert.notEqual(res, null)
  return { status: res.status, body: await res.json() }
}

async function withTimeout<T>(promise: Promise<T>, name: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${name} timed out after ${CASE_TIMEOUT_MS}ms`)),
          CASE_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function seedNovel(novelId: string): Promise<void> {
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
}

async function cleanupNovel(novelId: string): Promise<void> {
  await deletePlanningMutationLineageForNovel(novelId).catch(() => {})
  await deleteEnvelopesForNovel(novelId).catch(() => {})
  await db`DELETE FROM world_bibles WHERE novel_id = ${novelId}`.catch(() => {})
  await db`DELETE FROM story_spines WHERE novel_id = ${novelId}`.catch(() => {})
  await db`DELETE FROM characters WHERE novel_id = ${novelId}`.catch(() => {})
  await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`.catch(() => {})
  await db`DELETE FROM novels WHERE id = ${novelId}`.catch(() => {})
}

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
