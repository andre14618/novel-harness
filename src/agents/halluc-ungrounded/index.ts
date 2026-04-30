import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { buildContext } from "./context"
import { hallucUngroundedSchema, type HallucUngroundedOutput } from "./schema"
import { deriveBeatEntities, extractProperNouns } from "../../phases/beat-entity-list"

export { buildContext, hallucUngroundedSchema }
export type { HallucUngroundedOutput }

// Load the bounded checker prompt from disk so rubric updates don't require a
// TS recompile.
export const HALLUC_UNGROUNDED_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "halluc-ungrounded-system.md"),
  "utf-8",
)

export interface HallucUngroundedResult {
  pass: boolean
  issues: string[]   // normalized to the BeatIssue.description shape
}

/** Parses the BEAT_ENTITY_LIST_VARIANT env into a canonical variant tag.
 *  The checker-side is active for v1 and v3; v2 is writer-only.
 *
 *  **Default: v1** (promoted 2026-04-20 after exp #254 — charter ladder
 *  found V1 drops the ungrounded fire rate by 16 pts vs V0 on fantasy-debt,
 *  clears all 5 gates: magnitude (−16), adherence (0±0), degenerate (0%),
 *  Class-B (17%), precision (87.5%). See docs/decisions.md. Set
 *  `BEAT_ENTITY_LIST_VARIANT=v0` to opt out for regression testing.
 */
function resolveVariant(): "v0" | "v1" | "v2" | "v3" | "v4" {
  const raw = (process.env.BEAT_ENTITY_LIST_VARIANT ?? "v1").toLowerCase()
  if (raw === "v0" || raw === "v1" || raw === "v2" || raw === "v3" || raw === "v4") return raw
  return "v1"
}

/**
 * Runtime wrapper for the entity-grounding checker. Called
 * from the beat drafting retry loop. Never throws — any transport or
 * schema failure is normalized into a blocking issue so the drafting
 * loop can still decide whether to retry or accept.
 *
 * Beat-entity-list charter (docs/charters/beat-entity-list-v1.md):
 * when `BEAT_ENTITY_LIST_VARIANT` is `v1` or `v3`, derive a per-beat
 * entity list from the outline's establishedFacts + prior-beat
 * description via `deriveBeatEntities` and surface it to the checker as
 * a `Beat-entities:` sub-line inside the WORLD BIBLE block. In every
 * variant (including v0) we write a `groundedSources` object to
 * `llm_calls.request_json` so the mechanism-falsifier can join fired
 * entities against per-source provenance (bible / from_brief /
 * derived_outline_fact / derived_prior_beat / planner_emitted).
 */
export async function checkHallucUngrounded(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  worldBible: any,
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number },
  opts?: { prevBeat?: SceneBeat },
): Promise<HallucUngroundedResult> {
  const variant = resolveVariant()
  const derive = variant === "v1" || variant === "v3"

  const derivation = derive ? deriveBeatEntities(beat, outline, opts?.prevBeat) : null

  const userPrompt = buildContext(
    prose, beat, outline, characters, worldBible,
    derive ? { beatEntities: derivation!.entities } : undefined,
  )

  // Per charter §3 + §9: write the provenance-tagged grounded-surface
  // snapshot into request_json for the mechanism-falsifier. Bible and
  // from_brief are always populated (they're in every variant's
  // surface); derived_* are only populated when the variant activates
  // derivation; planner_emitted is reserved for V4.
  const bibleNames = [
    ...(worldBible?.locations ?? []).map((l: any) => l?.name).filter(Boolean),
    ...(worldBible?.cultures ?? []).map((c: any) => c?.name).filter(Boolean),
    ...(worldBible?.systems ?? []).map((s: any) => s?.name).filter(Boolean),
  ]
  // Re-derive From-brief so the snapshot matches what buildContext
  // surfaces. We compute it here (rather than extracting from the
  // rendered prompt string) because the From-brief line is filtered
  // against bibleKnown, and we want the provenance tag to reflect the
  // *final* set the checker actually saw.
  const briefSources = [beat.description ?? "", outline.setting ?? ""].join(" \n ")
  const bibleKnown = new Set<string>()
  for (const n of [...bibleNames, ...beat.characters, outline.povCharacter]) {
    if (n) bibleKnown.add(String(n).toLowerCase())
  }
  const fromBrief = extractProperNouns(briefSources).filter(e => !bibleKnown.has(e.toLowerCase()))

  const groundedSources = {
    variant,
    bible: bibleNames,
    from_brief: fromBrief,
    derived_outline_fact: derivation?.sources.derivedOutlineFact ?? [],
    derived_prior_beat: derivation?.sources.derivedPriorBeat ?? [],
    planner_emitted: [] as string[],
  }

  try {
    const result = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      beatIndex: tags?.beatIndex,
      attempt: tags?.attempt,
      agentName: "halluc-ungrounded" as const,
      systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
      userPrompt,
      schema: hallucUngroundedSchema,
      logMetadata: { groundedSources },
    })
    const output = result.output
    if (output.pass) return { pass: true, issues: [] }
    // Zod's `.default([])` resolves to an array at parse time, but the
    // inferred input type keeps the field optional — fall back to [] so
    // downstream consumers never see undefined.
    const issues = (output.issues ?? []).map(i =>
      `Ungrounded entity "${i.entity}"${i.excerpt ? ` — context: "${i.excerpt}"` : ""}`,
    )
    return { pass: false, issues }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      pass: false,
      issues: [`Ungrounded check failed: ${msg}`],
    }
  }
}
