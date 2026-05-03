/**
 * Canon bundle assembler — produces the deterministic per-chapter L1 packet.
 *
 * Charter: docs/charters/world-bible-architecture.md §0a + first-class principle
 * Lane:    docs/sessions/2026-05-03-world-bible-architecture-step-0a.md
 *
 * The L1 packet is the canon-side prefix of every writer + judge call for
 * chapter N. It must be byte-identical across all callers in chapter N so that
 * the prefix cache shares one entry. This module is the single source of truth
 * for L1 composition.
 *
 * Determinism contract:
 *   - Pure function over (CanonSource snapshot, novelId, chapterN).
 *   - Stable iteration order: entries sorted by stable IDs (CanonId, chapter, beat).
 *   - Deterministic JSON serialization: keys sorted; no Date.now, no Math.random.
 *   - SHA-256 packet hash recorded per emit.
 *
 * Cascade contract:
 *   - L1 ends at L1_BOUNDARY_MARKER. Anything after is L2 (role instructions)
 *     or L3 (volatile tail). assertL1Boundary() verifies prompt assembly
 *     respected the boundary.
 */

import { createHash } from "node:crypto"
import type {
  CanonFact,
  CharacterState,
  Entity,
  StoryPromise,
} from "./api"

// ── Cascade boundary ─────────────────────────────────────────────────────────

/**
 * Marker at the end of L1. Anything after this byte sequence is L2 or L3.
 * Choosing a marker that's vanishingly unlikely to appear inside canon prose
 * or structured fields. Versioned so future format changes don't silently
 * collide with old caches.
 */
export const L1_BOUNDARY_MARKER = "\n<<<L1_END_v1>>>\n"

// ── CanonSource interface (read-side abstraction) ────────────────────────────

/**
 * Read-side interface the bundle assembler depends on. Step 1 (Canon Substrate)
 * provides the real implementation backed by Postgres; tests provide an
 * in-memory mock. The assembler does not care which.
 *
 * Each method is point-in-time queryable: "as of chapter N." Implementations
 * MUST return results in stable ID order; the assembler also re-sorts
 * defensively so non-conforming implementations cannot break determinism.
 */
export interface CanonSource {
  /** All canon facts visible as of chapter N. */
  factsAsOfChapter(novelId: string, chapterN: number): readonly CanonFact[]
  /** All entities visible as of chapter N. */
  entitiesAsOfChapter(novelId: string, chapterN: number): readonly Entity[]
  /** Character states as of chapter N. One snapshot per character. */
  characterStatesAsOfChapter(novelId: string, chapterN: number): readonly CharacterState[]
  /** Promises with status open or resolved at chapter ≤ N. */
  promisesAsOfChapter(novelId: string, chapterN: number): readonly StoryPromise[]
  /** Stable identifier for the canon snapshot version. Two calls with the
   *  same returned version string MUST yield byte-identical query results. */
  snapshotVersion(novelId: string): string
}

// ── L1 packet shape ──────────────────────────────────────────────────────────

export interface L1Sections {
  facts: readonly CanonFact[]
  entities: readonly Entity[]
  characterStates: readonly CharacterState[]
  activePromises: readonly StoryPromise[]
}

export interface L1Packet {
  /** The serialized L1 byte stream including the boundary marker at the end. */
  bytes: string
  /** SHA-256 hex of the bytes (without trailing boundary, to make boundary
   *  changes orthogonal to canon-content changes). */
  packetHash: string
  /** Byte length of bytes (including boundary marker). */
  byteLength: number
  /** Approximate token count (4 chars/token heuristic). For token-cap checks. */
  approxTokens: number
  /** The canon-source snapshot version this packet was assembled from. */
  snapshotVersion: string
  /** Inputs the packet was built from, for downstream provenance. */
  novelId: string
  chapterN: number
  /** Section byte offsets within bytes. Useful for debugging/auditing. */
  sectionOffsets: {
    factsStart: number
    entitiesStart: number
    characterStatesStart: number
    activePromisesStart: number
    boundaryStart: number
  }
  /** The structured sections, in case downstream wants typed access. */
  sections: L1Sections
}

export const L1_TOKEN_CAP = 6_000

// ── Stable comparators ───────────────────────────────────────────────────────

const cmpString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const cmpFact = (a: CanonFact, b: CanonFact): number => cmpString(a.id, b.id)
const cmpEntity = (a: Entity, b: Entity): number => cmpString(a.id, b.id)
const cmpCharacterState = (a: CharacterState, b: CharacterState): number =>
  cmpString(a.characterId, b.characterId)
const cmpPromise = (a: StoryPromise, b: StoryPromise): number =>
  cmpString(a.id, b.id)

// ── Deterministic JSON ───────────────────────────────────────────────────────

/**
 * JSON.stringify with keys sorted recursively. The default JSON.stringify
 * preserves insertion order, which is non-deterministic across object
 * constructors. Sorting is the only safe option for byte-stable serialization.
 *
 * Arrays are NOT sorted by this function — array order is preserved (the
 * caller is responsible for sorting arrays before passing them in).
 */
function stableStringify(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`stableStringify: non-finite number ${value} not allowed in canon`)
    }
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]"
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    )
  }
  throw new Error(`stableStringify: unsupported type ${typeof value}`)
}

// ── Section serialization ────────────────────────────────────────────────────

const SECTION_HEADERS = {
  facts: "## Canon Facts\n",
  entities: "## Entity Registry\n",
  characterStates: "## Character States\n",
  activePromises: "## Active Promises\n",
} as const

function serializeFacts(facts: readonly CanonFact[]): string {
  return facts.map((f) => stableStringify(f)).join("\n") + (facts.length ? "\n" : "")
}

function serializeEntities(entities: readonly Entity[]): string {
  return entities.map((e) => stableStringify(e)).join("\n") + (entities.length ? "\n" : "")
}

function serializeCharacterStates(states: readonly CharacterState[]): string {
  return states.map((s) => stableStringify(s)).join("\n") + (states.length ? "\n" : "")
}

function serializePromises(promises: readonly StoryPromise[]): string {
  return promises.map((p) => stableStringify(p)).join("\n") + (promises.length ? "\n" : "")
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Build the L1 packet for chapter N. Pure function: same (source snapshot,
 * novelId, chapterN) → byte-identical output.
 *
 * Throws if the assembled bundle exceeds L1_TOKEN_CAP — bundle padding /
 * scope-rule failures should fail loudly, not silently truncate.
 */
export function assembleL1(
  source: CanonSource,
  novelId: string,
  chapterN: number,
): L1Packet {
  const facts = [...source.factsAsOfChapter(novelId, chapterN)].sort(cmpFact)
  const entities = [...source.entitiesAsOfChapter(novelId, chapterN)].sort(cmpEntity)
  const characterStates = [
    ...source.characterStatesAsOfChapter(novelId, chapterN),
  ].sort(cmpCharacterState)
  const activePromises = [
    ...source.promisesAsOfChapter(novelId, chapterN),
  ]
    .filter((p) => p.status === "open")
    .sort(cmpPromise)

  const factsBlock = SECTION_HEADERS.facts + serializeFacts(facts)
  const entitiesBlock = SECTION_HEADERS.entities + serializeEntities(entities)
  const characterStatesBlock =
    SECTION_HEADERS.characterStates + serializeCharacterStates(characterStates)
  const activePromisesBlock =
    SECTION_HEADERS.activePromises + serializePromises(activePromises)

  const factsStart = 0
  const entitiesStart = factsStart + factsBlock.length
  const characterStatesStart = entitiesStart + entitiesBlock.length
  const activePromisesStart = characterStatesStart + characterStatesBlock.length
  const boundaryStart =
    activePromisesStart + activePromisesBlock.length

  const contentBytes =
    factsBlock + entitiesBlock + characterStatesBlock + activePromisesBlock
  const bytes = contentBytes + L1_BOUNDARY_MARKER

  const approxTokens = Math.ceil(bytes.length / 4)
  if (approxTokens > L1_TOKEN_CAP) {
    throw new Error(
      `assembleL1: bundle exceeds token cap (~${approxTokens} > ${L1_TOKEN_CAP}). ` +
        `novelId=${novelId} chapterN=${chapterN}. Bundle scope rules need tightening.`,
    )
  }

  // Hash the canon content (excluding boundary marker) so future boundary
  // versioning doesn't invalidate every prior packet hash.
  const packetHash = createHash("sha256").update(contentBytes).digest("hex")

  return {
    bytes,
    packetHash,
    byteLength: bytes.length,
    approxTokens,
    snapshotVersion: source.snapshotVersion(novelId),
    novelId,
    chapterN,
    sectionOffsets: {
      factsStart,
      entitiesStart,
      characterStatesStart,
      activePromisesStart,
      boundaryStart,
    },
    sections: { facts, entities, characterStates, activePromises },
  }
}

// ── Cascade boundary assertion ───────────────────────────────────────────────

/**
 * Verifies that an assembled prompt places L1 contiguously at the start and
 * the boundary marker is intact at the expected offset. Call this from the
 * prompt assembler before sending; failure means L2 or L3 leaked into L1
 * (or vice-versa) and the cache contract is broken.
 */
export function assertL1Boundary(promptBytes: string, packet: L1Packet): void {
  if (!promptBytes.startsWith(packet.bytes)) {
    throw new Error(
      "assertL1Boundary: prompt does not start with the L1 packet bytes. " +
        "L1 must be the contiguous prefix of the prompt (charter first-class principle).",
    )
  }
  // Defensive: the boundary marker must end exactly at packet.byteLength.
  const markerStart = packet.byteLength - L1_BOUNDARY_MARKER.length
  if (
    promptBytes.slice(markerStart, packet.byteLength) !== L1_BOUNDARY_MARKER
  ) {
    throw new Error(
      "assertL1Boundary: L1 boundary marker not found at expected offset.",
    )
  }
}
