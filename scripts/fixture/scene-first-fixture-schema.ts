/**
 * Shared schema + parser for scene-first lane fixtures.
 *
 * Two fixture shapes:
 *
 * 1. Concept fixture (P1/P2/P3): a single JSON file under
 *    `docs/fixtures/scene-first/concepts/{over-target,undershoot,pre-resolved}/`.
 *    The `concept` block is the SeedInput the planner consumes.
 *    `fixture_metadata` carries operator-readable expectations.
 *    `pre_resolved_entities` and `scene_contract_target` are diagnostic
 *    notes for the operator; they are NOT consumed by the runtime.
 *
 * 2. Frozen-plan fixture (P4): a directory under
 *    `docs/fixtures/scene-first/frozen-plan/<slug>/` carrying
 *    `concept.json`, `chapter-outlines.json`, optional `world-bible.json`
 *    and `character-profiles.json`, plus a `README.md` capture trace.
 *    The `chapter-outlines.json` is meant to round-trip through the DB.
 *
 * No runtime behavior depends on these shapes. They are operator/test
 * scaffolding only.
 */

import type { SeedInput } from "../../src/types"

export type FixtureProfile = "P1-over-target" | "P2-undershoot" | "P3-pre-resolved" | "P4-real-runtime"

export interface FixtureMetadata {
  profile: FixtureProfile
  expected_baseline_ratio: string
  expected_baseline_failures: string[]
  scene_contract_population_target?: string
  derived_from?: string
  casting_gap_intentional?: boolean
  notes?: string
}

export interface ConceptFixture {
  fixture_metadata: FixtureMetadata
  concept: SeedInput
  pre_resolved_entities?: {
    officers_named_in_seed?: string[] | "n/a"
    casting_gaps_intentional?: string[]
  }
  scene_contract_target?: {
    fields_populated?: string[] | "all 9"
    fields_null?: string[]
  }
}

export interface FrozenPlanFixtureManifest {
  fixture_metadata: FixtureMetadata & {
    source_novel_id?: string
    source_central_run_id?: number
    source_experiment_id?: number
    captured_at?: string
    captured_against_commit?: string
    pipeline_overrides_at_capture?: Record<string, unknown>
  }
  outlines: Array<{
    chapterNumber: number
    outline_json: unknown // pass-through; matches persistedChapterOutlineSchema at hydration time
  }>
  /** True when the file is a stub / placeholder. The loader rejects stub files. */
  is_stub?: boolean
}

const PROFILES: ReadonlySet<FixtureProfile> = new Set([
  "P1-over-target",
  "P2-undershoot",
  "P3-pre-resolved",
  "P4-real-runtime",
])

function ensureRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`fixture ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function ensureString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`fixture ${path} must be a non-empty string`)
  }
  return value
}

function ensureStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every(v => typeof v === "string")) {
    throw new Error(`fixture ${path} must be an array of strings`)
  }
  return value as string[]
}

function ensureProfile(value: unknown): FixtureProfile {
  const s = ensureString(value, "fixture_metadata.profile")
  if (!PROFILES.has(s as FixtureProfile)) {
    throw new Error(`fixture_metadata.profile must be one of ${[...PROFILES].join(", ")}; got ${s}`)
  }
  return s as FixtureProfile
}

function parseFixtureMetadata(raw: unknown): FixtureMetadata {
  const obj = ensureRecord(raw, "fixture_metadata")
  const profile = ensureProfile(obj.profile)
  const expected_baseline_ratio = ensureString(obj.expected_baseline_ratio, "fixture_metadata.expected_baseline_ratio")
  const expected_baseline_failures = ensureStringArray(
    obj.expected_baseline_failures ?? [],
    "fixture_metadata.expected_baseline_failures",
  )
  const out: FixtureMetadata = { profile, expected_baseline_ratio, expected_baseline_failures }
  if (typeof obj.scene_contract_population_target === "string") {
    out.scene_contract_population_target = obj.scene_contract_population_target
  }
  if (typeof obj.derived_from === "string") out.derived_from = obj.derived_from
  if (typeof obj.casting_gap_intentional === "boolean") out.casting_gap_intentional = obj.casting_gap_intentional
  if (typeof obj.notes === "string") out.notes = obj.notes
  return out
}

function parseConcept(raw: unknown): SeedInput {
  const obj = ensureRecord(raw, "concept")
  const seed: Record<string, unknown> = {
    premise: ensureString(obj.premise, "concept.premise"),
    genre: ensureString(obj.genre, "concept.genre"),
    chapterCount: typeof obj.chapterCount === "number" && Number.isFinite(obj.chapterCount)
      ? obj.chapterCount
      : (() => { throw new Error("concept.chapterCount must be a finite number") })(),
  }
  if (Array.isArray(obj.characters)) seed.characters = obj.characters
  // Carry through any other fields the runtime SeedInput accepts. We do not
  // exhaustively validate — createNovel will reject mismatches at insert time.
  for (const [k, v] of Object.entries(obj)) {
    if (k in seed) continue
    seed[k] = v
  }
  return seed as unknown as SeedInput
}

export function parseConceptFixture(json: unknown, sourcePath: string): ConceptFixture {
  const obj = ensureRecord(json, sourcePath)
  const fixture_metadata = parseFixtureMetadata(obj.fixture_metadata)
  if (fixture_metadata.profile === "P4-real-runtime") {
    throw new Error(`${sourcePath} declares profile P4-real-runtime but is being loaded as a concept fixture; use load-frozen-plan.ts for P4`)
  }
  const concept = parseConcept(obj.concept)
  const result: ConceptFixture = { fixture_metadata, concept }
  if (obj.pre_resolved_entities && typeof obj.pre_resolved_entities === "object") {
    result.pre_resolved_entities = obj.pre_resolved_entities as ConceptFixture["pre_resolved_entities"]
  }
  if (obj.scene_contract_target && typeof obj.scene_contract_target === "object") {
    result.scene_contract_target = obj.scene_contract_target as ConceptFixture["scene_contract_target"]
  }
  return result
}

export function parseFrozenPlanManifest(json: unknown, sourcePath: string): FrozenPlanFixtureManifest {
  const obj = ensureRecord(json, sourcePath)
  const fixture_metadata = parseFixtureMetadata(obj.fixture_metadata) as FrozenPlanFixtureManifest["fixture_metadata"]
  if (fixture_metadata.profile !== "P4-real-runtime") {
    throw new Error(`${sourcePath} must declare profile P4-real-runtime; got ${fixture_metadata.profile}`)
  }
  // Carry through P4-specific provenance fields without strict validation; they
  // are operator-trace material, not load-bearing for hydration.
  const provFields = [
    "source_novel_id", "source_central_run_id", "source_experiment_id",
    "captured_at", "captured_against_commit", "pipeline_overrides_at_capture",
  ] as const
  const metaSrc = obj.fixture_metadata as Record<string, unknown>
  for (const f of provFields) {
    if (metaSrc[f] !== undefined) (fixture_metadata as Record<string, unknown>)[f] = metaSrc[f]
  }
  const is_stub = obj.is_stub === true
  if (is_stub) {
    return { fixture_metadata, outlines: [], is_stub: true }
  }
  if (!Array.isArray(obj.outlines)) {
    throw new Error(`${sourcePath} must include an "outlines" array unless is_stub: true is set`)
  }
  const outlines = obj.outlines.map((entry, idx) => {
    const e = ensureRecord(entry, `${sourcePath}.outlines[${idx}]`)
    if (typeof e.chapterNumber !== "number" || !Number.isFinite(e.chapterNumber)) {
      throw new Error(`${sourcePath}.outlines[${idx}].chapterNumber must be a finite number`)
    }
    if (e.outline_json === undefined) {
      throw new Error(`${sourcePath}.outlines[${idx}].outline_json is required`)
    }
    return { chapterNumber: e.chapterNumber, outline_json: e.outline_json }
  })
  return { fixture_metadata, outlines }
}
