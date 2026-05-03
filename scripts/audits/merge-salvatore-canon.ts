/**
 * Merge subagent A and subagent B Salvatore canon fixtures into a single
 * file. Conflict resolution:
 *   - duplicate entity IDs: keep the one with lower firstAppearedChapter
 *     (earliest canonical introduction wins)
 *   - duplicate fact IDs: keep lower provenance.chapter
 *   - duplicate character-state (characterId, asOfChapter): keep B's
 *     (later in time → represents the more current state)
 *   - duplicate promise IDs: merge — earliest setupChapter, latest known
 *     resolution
 *
 * Run: bun scripts/audits/merge-salvatore-canon.ts
 */

import type {
  CanonFact,
  CharacterState,
  Entity,
  StoryPromise,
} from "../../src/canon/api"
import {
  validateCanonFixture,
  type CanonFixture,
} from "../../src/canon/recall-validation"

async function readFixture(path: string): Promise<CanonFixture> {
  const data = await Bun.file(path).json()
  validateCanonFixture(data, path)
  return data
}

function mergeEntities(a: Entity[], b: Entity[]): { merged: Entity[]; conflicts: string[] } {
  const map = new Map<string, Entity>()
  const conflicts: string[] = []
  for (const e of a) map.set(e.id, e)
  for (const e of b) {
    const existing = map.get(e.id)
    if (!existing) {
      map.set(e.id, e)
      continue
    }
    conflicts.push(e.id)
    const aChap = existing.firstAppearedChapter ?? Number.POSITIVE_INFINITY
    const bChap = e.firstAppearedChapter ?? Number.POSITIVE_INFINITY
    map.set(e.id, aChap <= bChap ? existing : e)
  }
  return { merged: [...map.values()], conflicts }
}

function mergeFacts(a: CanonFact[], b: CanonFact[]): { merged: CanonFact[]; conflicts: string[] } {
  const map = new Map<string, CanonFact>()
  const conflicts: string[] = []
  for (const f of a) map.set(f.id, f)
  for (const f of b) {
    const existing = map.get(f.id)
    if (!existing) {
      map.set(f.id, f)
      continue
    }
    conflicts.push(f.id)
    map.set(
      f.id,
      existing.provenance.chapter <= f.provenance.chapter ? existing : f,
    )
  }
  return { merged: [...map.values()], conflicts }
}

function mergeCharacterStates(
  a: CharacterState[],
  b: CharacterState[],
): { merged: CharacterState[]; conflicts: string[] } {
  // Key by (characterId, asOfChapter). Different chapters → both kept.
  // Same key → keep B's (later in extraction order; semantically equivalent
  // since both refer to the same character at the same chapter snapshot).
  const map = new Map<string, CharacterState>()
  const conflicts: string[] = []
  const key = (s: CharacterState) => `${s.characterId}@${s.asOfChapter}`
  for (const s of a) map.set(key(s), s)
  for (const s of b) {
    if (map.has(key(s))) conflicts.push(key(s))
    map.set(key(s), s)
  }
  return { merged: [...map.values()], conflicts }
}

function mergePromises(
  a: StoryPromise[],
  b: StoryPromise[],
): { merged: StoryPromise[]; conflicts: string[] } {
  const map = new Map<string, StoryPromise>()
  const conflicts: string[] = []
  for (const p of a) map.set(p.id, p)
  for (const p of b) {
    const existing = map.get(p.id)
    if (!existing) {
      map.set(p.id, p)
      continue
    }
    conflicts.push(p.id)
    // Merge: take earlier setupChapter; prefer the one with a resolution
    // (resolved > open). If both same status, keep A's.
    const merged: StoryPromise = {
      ...existing,
      setupChapter: Math.min(existing.setupChapter, p.setupChapter),
      // Prefer resolution metadata from whichever has it.
      resolvedAtChapter: existing.resolvedAtChapter ?? p.resolvedAtChapter,
      resolvedAtBeat: existing.resolvedAtBeat ?? p.resolvedAtBeat,
      // Status precedence: resolved > abandoned > open.
      status:
        existing.status === "resolved" || p.status === "resolved"
          ? "resolved"
          : existing.status === "abandoned" || p.status === "abandoned"
            ? "abandoned"
            : "open",
    }
    map.set(p.id, merged)
  }
  return { merged: [...map.values()], conflicts }
}

async function main() {
  const fixturesDir = "tests/canon/fixtures"
  const a = await readFixture(`${fixturesDir}/salvatore-crystal-shard-A.canon.json`)
  const b = await readFixture(`${fixturesDir}/salvatore-crystal-shard-B.canon.json`)

  console.log(`Subagent A: ${a.facts.length} facts, ${a.entities.length} entities, ${a.characterStates.length} states, ${a.promises.length} promises`)
  console.log(`Subagent B: ${b.facts.length} facts, ${b.entities.length} entities, ${b.characterStates.length} states, ${b.promises.length} promises`)

  const facts = mergeFacts(a.facts, b.facts)
  const entities = mergeEntities(a.entities, b.entities)
  const characterStates = mergeCharacterStates(a.characterStates, b.characterStates)
  const promises = mergePromises(a.promises, b.promises)

  console.log("")
  console.log(`Conflicts:`)
  console.log(`  facts:           ${facts.conflicts.length}${facts.conflicts.length ? " — " + facts.conflicts.join(", ") : ""}`)
  console.log(`  entities:        ${entities.conflicts.length}${entities.conflicts.length ? " — " + entities.conflicts.join(", ") : ""}`)
  console.log(`  characterStates: ${characterStates.conflicts.length}${characterStates.conflicts.length ? " — " + characterStates.conflicts.join(", ") : ""}`)
  console.log(`  promises:        ${promises.conflicts.length}${promises.conflicts.length ? " — " + promises.conflicts.join(", ") : ""}`)

  const merged: CanonFixture = {
    novelId: "salvatore-crystal-shard",
    snapshotVersion: "salvatore-poc-v1",
    description:
      "Manual canon for R.A. Salvatore's The Crystal Shard, prelude + chapters 1-5. Merged from subagent A (prelude + ch1-3) and subagent B (ch4-5).",
    facts: facts.merged,
    entities: entities.merged,
    characterStates: characterStates.merged,
    promises: promises.merged,
  }

  validateCanonFixture(merged, "<merged>")

  const outPath = `${fixturesDir}/salvatore-crystal-shard.canon.json`
  await Bun.write(outPath, JSON.stringify(merged, null, 2) + "\n")

  console.log("")
  console.log(`Merged: ${merged.facts.length} facts, ${merged.entities.length} entities, ${merged.characterStates.length} states, ${merged.promises.length} promises`)
  console.log(`Wrote: ${outPath}`)

  // Cross-reference sanity: every promise.promiseFactId points at a real fact?
  const factIds = new Set(merged.facts.map((f) => f.id))
  const danglingPromises = merged.promises.filter((p) => !factIds.has(p.promiseFactId))
  if (danglingPromises.length) {
    console.log("")
    console.log(`WARN: ${danglingPromises.length} promises reference unknown fact IDs:`)
    for (const p of danglingPromises) {
      console.log(`  ${p.id} -> ${p.promiseFactId}`)
    }
  }

  // Cross-reference: every characterState.knownFacts ID exists?
  const danglingKnownFacts: Array<{ characterId: string; missing: string[] }> = []
  for (const s of merged.characterStates) {
    const missing = s.knownFacts.filter((id) => !factIds.has(id))
    if (missing.length) danglingKnownFacts.push({ characterId: s.characterId, missing })
  }
  if (danglingKnownFacts.length) {
    console.log("")
    console.log(`WARN: ${danglingKnownFacts.length} character states reference unknown fact IDs in knownFacts:`)
    for (const d of danglingKnownFacts) {
      console.log(`  ${d.characterId}: ${d.missing.join(", ")}`)
    }
  }
}

await main()
