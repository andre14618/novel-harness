/**
 * Pure renderer for the typed `BeatContext`.
 *
 * No async, no DB, no I/O. Takes a fully-prepared `BeatContext` (built by
 * `buildBeatContextSlots`) plus a compact flag and emits the byte-exact
 * user-prompt string the writer model receives.
 *
 * Section order + spacing are load-bearing: the parity gate at
 * `tests/beat-context-parity.test.ts` asserts byte-equivalence against the
 * pre-D1 implementation for every fixture in
 * `tests/beat-context-fixtures/*.json`. Any change to formatting here MUST
 * be matched in `tests/beat-context-fixtures/legacy-snapshot.ts` in a
 * separate, deliberate commit (or the parity test will fail).
 *
 * The compact flag drives:
 *   - Per-character snapshot formatting (collapsed entries vs full per-
 *     character snapshot blocks separated by blank lines).
 *   - The setting block: compact strips name+description and keeps only the
 *     "Sensory: …" line; full emits the SETTING title + description +
 *     sensory line.
 *
 * Everything else (beat-spec lines, transition bridge, landing target,
 * resolved-references text) is identical across compact and full modes.
 */

import type { BeatContext, BeatSpec, CharacterSnapshot, SceneContractBlock, SettingBlock } from "./beat-context"
import { renderCharacterContextCapsules } from "./character-context"
import type { WriterPromptIdRendering } from "./context-mode"

export interface RenderBeatContextOptions {
  compact: boolean
  /** L099 / adjusted-B1: writer-prompt ID rendering ablation lever.
   *  Defaults to "raw" (legacy behaviour) when omitted. */
  idRendering?: WriterPromptIdRendering
}

export function renderBeatContext(ctx: BeatContext, opts: RenderBeatContextOptions): string {
  const sections: string[] = []

  // ── 1. Beat spec ──────────────────────────────────────────────────────
  sections.push(renderBeatSpec(ctx.beatSpec))

  // ── 1b. Scene contract (L097 Slice 2) ─────────────────────────────────
  // Rendered when sceneCallWriterV1 is on AND the entry has at least one
  // scene-contract field populated. Off-flag the slot is null and this
  // section is suppressed — preserves byte-parity for legacy outlines.
  if (ctx.sceneContract) {
    sections.push(renderSceneContract(ctx.sceneContract))
  }

  // ── 2. Transition bridge ──────────────────────────────────────────────
  if (ctx.transitionBridge) {
    sections.push(`TRANSITION BRIDGE (continue from here):\n${ctx.transitionBridge}`)
  }

  // ── 3. Landing target ─────────────────────────────────────────────────
  if (ctx.landingTarget) {
    sections.push(`LANDING TARGET (end connecting toward this):\nNext beat: ${ctx.landingTarget}`)
  }

  // ── 4. Character snapshots ────────────────────────────────────────────
  if (ctx.characterSnapshots.length > 0) {
    if (opts.compact) {
      sections.push(`CHARACTERS:\n${renderCharactersCompact(ctx.characterSnapshots)}`)
    } else {
      sections.push(`CHARACTERS:\n${renderCharactersFull(ctx.characterSnapshots)}`)
    }
  }

  if (ctx.characterContextCapsules) {
    sections.push(renderCharacterContextCapsules(ctx.characterContextCapsules, { idRendering: opts.idRendering }))
  }

  // ── 5. Resolved references ────────────────────────────────────────────
  if (ctx.resolvedReferencesText) sections.push(ctx.resolvedReferencesText)

  // ── 6. Reader-info state (L38-A) ──────────────────────────────────────
  // Position mirrors `insertEnrichedSection` (enriched-context.ts:328) so
  // chapter-N readers see prior-chapter facts + per-character ignorance
  // immediately before the SETTING block, where the writer is about to
  // ground the next beat. Always null for chapter 1 (gated in slot builder).
  if (ctx.readerInfoState) sections.push(ctx.readerInfoState)

  // ── 7. Setting ────────────────────────────────────────────────────────
  if (ctx.setting) {
    const settingText = renderSetting(ctx.setting, opts.compact)
    if (settingText) sections.push(settingText)
  }

  return sections.filter(Boolean).join("\n\n")
}

// ── Beat spec ────────────────────────────────────────────────────────────

function renderBeatSpec(spec: BeatSpec): string {
  const lines = [
    `BEAT ${spec.beatNumber} of ${spec.totalBeats}`,
    `POV: ${spec.pov}`,
    `Setting: ${spec.setting}`,
    `Kind: ${spec.kind}`,
    ``,
    spec.description,
  ]
  if (spec.charactersPresent.length > 0) {
    lines.push(`Characters present: ${spec.charactersPresent.join(", ")}`)
  }

  if (spec.seeds.length > 0) {
    const setupLines = spec.seeds
      .map(p => `  - "${p.fact}" (lands at beat ${p.landsAtBeat + 1})`)
      .join("\n")
    lines.push("", "SEEDS (this beat must set up):", setupLines)
  }

  if (spec.payoffsDue.length > 0) {
    const payoffLines = spec.payoffsDue
      .map(d => `  - "${d.fact}" (seeded in beat ${d.seededAtBeat + 1})`)
      .join("\n")
    lines.push("", "PAYOFFS DUE (this beat must realize):", payoffLines)
  }

  const obligationLines = renderObligationLines(spec.obligations)
  if (obligationLines) lines.push("", "BEAT OBLIGATIONS:", obligationLines)

  return lines.join("\n")
}

// ── Scene contract (L097 Slice 2) ───────────────────────────────────────
// Renders the planner-emitted scene-contract fields as a "SCENE CONTRACT"
// block the writer consumes alongside the beat description. The block is
// purely additive — it never replaces or contradicts the beat spec; it
// adds the dramatic shape the writer must satisfy (goal, opposition,
// turning point, crisis choice + alternatives, outcome, consequence,
// POV personal stake, value polarity).
function renderSceneContract(scene: SceneContractBlock): string {
  const lines: string[] = ["SCENE CONTRACT (write the dramatic shape; do not just narrate the beat description):"]
  if (scene.goal) lines.push(`Goal: ${scene.goal}`)
  if (scene.opposition) lines.push(`Opposition: ${scene.opposition}`)
  if (scene.turningPoint) lines.push(`Turning point: ${scene.turningPoint}`)
  if (scene.crisisChoice) lines.push(`Crisis choice: ${scene.crisisChoice}`)
  if (scene.choiceAlternatives.length > 0) {
    lines.push("Choice alternatives the protagonist weighs:")
    for (const alt of scene.choiceAlternatives) {
      lines.push(`  - ${alt}`)
    }
  }
  if (scene.outcome) lines.push(`Outcome (what happens): ${scene.outcome}`)
  if (scene.consequence) lines.push(`Consequence (observable downstream pressure — different from outcome): ${scene.consequence}`)
  if (scene.povPersonalStake) lines.push(`POV personal stake: ${scene.povPersonalStake}`)
  if (scene.valueIn || scene.valueOut) {
    const inVal = scene.valueIn ?? "?"
    const outVal = scene.valueOut ?? "?"
    lines.push(`Value polarity: ${inVal} → ${outVal}`)
  }
  return lines.join("\n")
}

function renderObligationLines(obligations: BeatSpec["obligations"]): string {
  const sections: string[] = []
  pushObligationSection(sections, "Must establish", obligations.mustEstablish.map(i => i.text))
  pushObligationSection(sections, "Must pay off", obligations.mustPayOff.map(i => i.text))
  pushObligationSection(sections, "Must transfer knowledge", obligations.mustTransferKnowledge.map(i => formatCharacterObligation(i.characterName, i.text)))
  pushObligationSection(sections, "Must show state change", obligations.mustShowStateChange.map(i => formatCharacterObligation(i.characterName, i.text)))
  pushObligationSection(sections, "Must not reveal", obligations.mustNotReveal.map(i => i.text))
  pushObligationSection(sections, "Allowed new named entities", obligations.allowedNewEntities)
  return sections.join("\n")
}

function pushObligationSection(sections: string[], label: string, items: string[]): void {
  const clean = items.map(i => i.trim()).filter(Boolean)
  if (clean.length === 0) return
  sections.push(`${label}:`)
  for (const item of clean) sections.push(`  - ${item}`)
}

function formatCharacterObligation(characterName: string | undefined, text: string): string {
  return characterName ? `${characterName}: ${text}` : text
}

// ── Character snapshots ──────────────────────────────────────────────────

function renderCharactersCompact(snapshots: CharacterSnapshot[]): string {
  // Compact path: per-character entries flattened with a trailing blank
  // line between characters, joined on \n. Matches the legacy
  // `flatMap(c => [...entry, ""])` + trailing-blank-trim pattern exactly.
  const lines: string[] = []
  for (const c of snapshots) {
    lines.push(`${c.name}:`)
    if (c.voice) lines.push(`  Voice: ${c.voice}`)
    if (c.drives) lines.push(`  Drives: ${c.drives}`)
    if (c.avoids) lines.push(`  Avoids: ${c.avoids}`)
    if (c.conflict) lines.push(`  Conflict: ${c.conflict}`)
    if (c.exampleLines.length > 0) {
      lines.push(`  Example voiced lines:`)
      c.exampleLines.forEach((line, i) => {
        lines.push(`    ${i + 1}. "${line.replace(/^"|"$/g, "")}"`)
      })
    }
    lines.push("")
  }
  // Trim trailing blank
  while (lines.length && lines[lines.length - 1] === "") lines.pop()
  return lines.join("\n")
}

function renderCharactersFull(snapshots: CharacterSnapshot[]): string {
  return snapshots.map(renderSnapshotFull).join("\n\n")
}

function renderSnapshotFull(snap: CharacterSnapshot): string {
  const lines: string[] = [`${snap.name}:`]

  if (snap.voice) lines.push(`  Voice: ${snap.voice}`)
  if (snap.drives) lines.push(`  Drives: ${snap.drives}`)
  if (snap.avoids) lines.push(`  Avoids: ${snap.avoids}`)
  if (snap.conflict) lines.push(`  Conflict: ${snap.conflict}`)

  if (snap.state) lines.push(`  State: ${snap.state}`)

  if (snap.withPov) {
    // The slot builder stashes the POV character's display name on the
    // snapshot via the optional `povDisplayName` field — this is the same
    // name the legacy emits in the "With X: …" line (povChar.name from
    // CharacterProfile, NOT outline.povCharacter, so casing follows the
    // canonical character profile). The field is documented in
    // beat-context.ts.
    const povName = snap.povDisplayName ?? ""
    lines.push(`  With ${povName}: [${snap.withPov.trustLevel}] ${snap.withPov.dynamic}`)
    if (snap.withPov.tension) lines.push(`    Tension: ${snap.withPov.tension}`)
  }

  if (snap.doesNotKnow && snap.doesNotKnow.length > 0) {
    lines.push(`  Doesn't know: ${snap.doesNotKnow.join("; ")}`)
  }

  if (snap.exampleLines.length > 0) {
    lines.push(`  Example voiced lines:`)
    snap.exampleLines.forEach((line, i) => {
      lines.push(`    ${i + 1}. "${line.replace(/^"|"$/g, "")}"`)
    })
  }

  return lines.join("\n")
}

// ── Setting ─────────────────────────────────────────────────────────────

function renderSetting(setting: SettingBlock, compact: boolean): string | null {
  if (compact) {
    // Compact: only emit the Sensory: line if present; otherwise the
    // section is suppressed entirely (matches legacy: `find(l => l.startsWith("Sensory:"))`
    // returning undefined → no push to sections).
    if (setting.sensoryDetails) return `Sensory: ${setting.sensoryDetails}`
    return null
  }
  let section = `SETTING: ${setting.name}`
  if (setting.description) section += `\n${setting.description}`
  if (setting.sensoryDetails) section += `\nSensory: ${setting.sensoryDetails}`
  return section
}
