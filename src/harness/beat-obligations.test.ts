import { expect, test } from "bun:test"

import {
  applyBeatObligationRepairPatch,
  deriveBeatObligations,
  formatObligationCoverageRetryFeedback,
  renderBeatObligations,
  validateBeatObligationCoverage,
} from "./beat-obligations"
import { enrichOutlineIds } from "./ids"
import { planningStateRepairSchema } from "../agents/planning-state-repair/schema"
import type { ChapterOutline, SceneBeat } from "../types"

test("deriveBeatObligations maps payoff links to seed and payoff beat obligations", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra notices the marsh fungus compound slows the Ashrot but keeps quiet.", requiredPayoffs: [{ fact_id: "fungus-slows-ashrot", payoff_beat: 2 }] }),
      beat({ description: "Aldric pressures Istra for a clean answer." }),
      beat({ description: "Istra uses the marsh fungus compound to buy Wren another hour." }),
    ],
    establishedFacts: [
      { id: "fungus-slows-ashrot", fact: "The marsh fungus compound slows Ashrot symptoms", category: "rule" },
    ],
  })

  const result = deriveBeatObligations(outline)

  expect(result.summary.orphanFacts).toBe(0)
  expect(result.beats[0].mustEstablish).toEqual([
    expect.objectContaining({ text: "The marsh fungus compound slows Ashrot symptoms", confidence: "explicit", sourceId: "fungus-slows-ashrot", sourceKind: "fact" }),
  ])
  expect(result.beats[2].mustPayOff).toEqual([
    expect.objectContaining({ text: "The marsh fungus compound slows Ashrot symptoms", confidence: "explicit", sourceId: "fungus-slows-ashrot", sourceKind: "payoff", seededAtBeat: 0 }),
  ])
})

test("deriveBeatObligations treats planner-authored obligations with source IDs as explicit assignments", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [
      beat({
        description: "Calla studies Davan's skin.",
        obligations: {
          mustEstablish: [{ sourceId: "old-script", sourceKind: "fact", text: "Davan bears the Old Tongue on his skin" } as any],
          mustPayOff: [],
          mustTransferKnowledge: [{ sourceId: "know-calla-davan-bears-old-tongue", sourceKind: "knowledge", characterId: "char-calla", characterName: "Calla", text: "Calla learns Davan bears the Old Tongue" } as any],
          mustShowStateChange: [{ sourceId: "state-calla-iron-hall-protective-witness", sourceKind: "state", characterId: "char-calla", characterName: "Calla", text: "Calla changes from detached executioner to protective witness" } as any],
          mustNotReveal: [{ text: "Do not reveal Orvath's full plan" }],
          allowedNewEntities: ["Old Tongue"],
        },
      }),
    ],
    establishedFacts: [
      { id: "old-script", fact: "Davan bears the Old Tongue on his skin", category: "identity" },
    ],
    knowledgeChanges: [
      { id: "know-calla-davan-bears-old-tongue", characterId: "char-calla", characterName: "Calla", knowledge: "Davan bears the Old Tongue", source: "discovered" } as any,
    ],
    characterStateChanges: [
      { id: "state-calla-iron-hall-protective-witness", characterId: "char-calla", name: "Calla", location: "Iron Hall", emotionalState: "protective witness", knows: [], doesNotKnow: [] } as any,
    ],
  }))

  expect(result.summary.orphanFacts).toBe(0)
  expect(result.summary.orphanKnowledgeChanges).toBe(0)
  expect(result.summary.orphanStateChanges).toBe(0)
  expect(result.beats[0].mustEstablish[0]).toEqual(expect.objectContaining({ confidence: "explicit", source: "scene.obligations.mustEstablish", sourceId: "old-script", sourceKind: "fact" }))
  expect(result.beats[0].mustNotReveal[0]).toEqual(expect.objectContaining({ kind: "avoid", text: "Do not reveal Orvath's full plan" }))
  expect(result.beats[0].allowedNewEntities).toContain("Old Tongue")
})

test("validateBeatObligationCoverage does not derive sourceId from matching obligation text", () => {
  const outline = chapter({
    scenes: [
      beat({
        description: "Calla studies Davan's skin.",
        obligations: {
          mustEstablish: [{ text: "Davan bears the Old Tongue on his skin" }],
          mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
        },
      }),
    ],
    establishedFacts: [
      { id: "old-script", fact: "Davan bears the Old Tongue on his skin", category: "identity" },
    ],
  })

  const validation = validateBeatObligationCoverage(outline)

  expect(validation.valid).toBe(false)
  expect(validation.summary.missingSourceIds).toBe(1)
  expect(validation.missingSourceIds).toContain("old-script")
  expect((outline.scenes[0].obligations.mustEstablish[0] as any).sourceId).toBeUndefined()
})

test("deriveBeatObligations ignores blank planner-authored obligation items", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [
      beat({
        description: "Calla studies Davan's skin.",
        obligations: {
          mustEstablish: [{ id: "old-script", text: "" }],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      }),
    ],
    establishedFacts: [
      { id: "old-script", fact: "Davan bears the Old Tongue on his skin", category: "identity" },
    ],
  }))

  expect(result.beats[0].mustEstablish).toEqual([])
  expect(result.summary.orphanFacts).toBe(1)
})

test("deriveBeatObligations does NOT cover state items via beat text (exact-ID only)", () => {
  // Even though the beat description contains all the keywords from the
  // fact + knowledge change, no obligation was authored — so under the
  // exact-ID contract, both items are orphans.
  const outline = chapter({
    scenes: [
      beat({ description: "Istra examines Wren's green-lit memory and realizes the cure damages language." }),
      beat({ description: "Aldric waits outside the curtain." }),
    ],
    establishedFacts: [
      { id: "cure-damages-language", fact: "The cure damages language memory", category: "knowledge" },
    ],
    knowledgeChanges: [
      { characterName: "Istra", knowledge: "The cure damages language memory", source: "deduced" },
    ],
  })

  const result = deriveBeatObligations(outline)

  expect(result.summary.orphanFacts).toBe(1)
  expect(result.summary.orphanKnowledgeChanges).toBe(1)
  expect(result.beats[0].mustEstablish).toEqual([])
})

test("deriveBeatObligations warns about orphan state that is not writer-visible", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra prepares another dose." }),
      beat({ description: "Aldric leaves the infirmary." }),
    ],
    characterStateChanges: [
      { name: "Istra", location: "The sealed archive", emotionalState: "furious clarity", knows: ["Aldric falsified the plague ledgers"], doesNotKnow: [] },
    ],
  })

  const result = deriveBeatObligations(outline)

  expect(result.summary.orphanStateChanges).toBe(1)
  expect(result.warnings.some(w => w.includes("source id") && w.includes("state-istra"))).toBe(true)
})

test("validateBeatObligationCoverage fails when chapter state has no covering sourceId obligation", () => {
  const outline = chapter({
    scenes: [beat({ description: "Istra prepares another dose." })],
    establishedFacts: [
      { id: "ledger-forgery", fact: "Aldric falsified the plague ledgers", category: "knowledge" },
    ],
    knowledgeChanges: [
      { characterName: "Istra", knowledge: "Aldric falsified the plague ledgers", source: "deduced" },
    ],
    characterStateChanges: [
      { name: "Istra", location: "The sealed archive", emotionalState: "furious clarity", knows: ["Aldric falsified the plague ledgers"], doesNotKnow: [] },
    ],
  })

  const validation = validateBeatObligationCoverage(outline)

  expect(validation.valid).toBe(false)
  expect(validation.errors.some(e => e.includes("established fact"))).toBe(true)
  expect(validation.errors.some(e => e.includes("knowledge change"))).toBe(true)
  expect(validation.errors.some(e => e.includes("character state change"))).toBe(true)
  expect(validation.missingSourceIds).toContain("ledger-forgery")
})

test("validateBeatObligationCoverage flags unknown obligation source IDs", () => {
  const outline = chapter({
    scenes: [
      beat({
        description: "Istra prepares another dose.",
        obligations: {
          mustEstablish: [
            { sourceId: "fact-not-in-registry", sourceKind: "fact", text: "Some fact" } as any,
          ],
          mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
        },
      }),
    ],
    establishedFacts: [],
  })
  const validation = validateBeatObligationCoverage(outline)

  expect(validation.valid).toBe(false)
  expect(validation.unknownObligations).toEqual([
    expect.objectContaining({ obligationKey: "mustEstablish", sourceId: "fact-not-in-registry" }),
  ])
})

test("validateBeatObligationCoverage rejects duplicate source IDs instead of rewriting them", () => {
  const outline = chapter({
    scenes: [beat({ description: "Istra learns two things.", obligations: {
      mustEstablish: [], mustPayOff: [],
      mustTransferKnowledge: [
        { sourceId: "know-shared", sourceKind: "knowledge", characterId: "char-istra", characterName: "Istra", text: "first" } as any,
      ],
      mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    } })],
    knowledgeChanges: [
      { id: "know-shared", characterId: "char-istra", characterName: "Istra", knowledge: "first", source: "deduced" } as any,
      { id: "know-shared", characterId: "char-istra", characterName: "Istra", knowledge: "second", source: "deduced" } as any,
    ],
  })

  const validation = validateBeatObligationCoverage(outline)

  expect(validation.valid).toBe(false)
  expect(validation.summary.duplicateSourceIds).toBe(1)
  expect((outline.knowledgeChanges[1] as any).id).toBe("know-shared")
})

test("validateBeatObligationCoverage rejects missing or mismatched sourceKind", () => {
  const outline = chapter({
    scenes: [beat({ description: "Istra records the ledger.", obligations: {
      mustEstablish: [
        { sourceId: "ledger-forgery", sourceKind: "knowledge", text: "Aldric falsified the plague ledgers" } as any,
      ],
      mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    } })],
    establishedFacts: [
      { id: "ledger-forgery", fact: "Aldric falsified the plague ledgers", category: "knowledge" },
    ],
  })

  const validation = validateBeatObligationCoverage(outline)

  expect(validation.valid).toBe(false)
  expect(validation.summary.sourceKindMismatches).toBe(1)
})

test("formatObligationCoverageRetryFeedback names missing source IDs and preserves chapter ids", () => {
  const outline = chapter({
    scenes: [beat({ description: "Istra prepares another dose." })],
    establishedFacts: [
      { id: "ledger-forgery", fact: "Aldric falsified the plague ledgers", category: "knowledge" },
    ],
    knowledgeChanges: [
      { characterName: "Istra", knowledge: "Aldric falsified the plague ledgers", source: "deduced" },
    ],
    characterStateChanges: [
      { name: "Istra", location: "The sealed archive", emotionalState: "furious clarity", knows: ["Aldric falsified the plague ledgers"], doesNotKnow: [] },
    ],
  })
  const validation = validateBeatObligationCoverage(outline)

  const feedback = formatObligationCoverageRetryFeedback(outline, validation)

  expect(feedback).toContain("failed exact-ID obligation coverage")
  expect(feedback).toContain("Missing source IDs")
  expect(feedback).toContain("ledger-forgery")
  expect(feedback).toContain("Established facts (preserve all ids)")
  expect(feedback).toContain("Knowledge changes (preserve all ids and characterIds)")
  expect(feedback).toContain("characterId=char-istra")
})

test("applyBeatObligationRepairPatch mechanically applies valid add operations", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [beat({ beatId: "ch-001-treatment-beat-001-dose", description: "Istra prepares another dose.", characters: ["Istra"] })],
    knowledgeChanges: [
      { id: "know-istra-ledger-forgery", characterId: "char-istra", characterName: "Istra", knowledge: "Aldric falsified the plague ledgers", source: "deduced" } as any,
    ],
  })

  const result = applyBeatObligationRepairPatch(outline, {
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-001-dose",
      list: "mustTransferKnowledge",
      sourceId: "know-istra-ledger-forgery",
      sourceKind: "knowledge",
      characterId: "char-istra",
      text: "Istra learns Aldric falsified the plague ledgers.",
    }],
  })

  expect(result.rejected).toEqual([])
  expect(result.applied).toHaveLength(1)
  expect(result.validation.valid).toBe(true)
  const item = result.outline.scenes[0].obligations.mustTransferKnowledge[0] as any
  expect(item.sourceId).toBe("know-istra-ledger-forgery")
  expect(item.sourceKind).toBe("knowledge")
  expect(item.characterId).toBe("char-istra")
  expect(item.obligationId).toMatch(/^obl-/)
  expect((outline.scenes[0].obligations as any)?.mustTransferKnowledge ?? []).toEqual([])
})

test("planningStateRepairSchema accepts null characterId as omitted for fact ops", () => {
  const parsed = planningStateRepairSchema.parse({
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-001-dose",
      list: "mustEstablish",
      sourceId: "fact-ledger-forgery",
      sourceKind: "fact",
      characterId: null,
      text: "Aldric falsified the plague ledgers.",
    }],
  })

  expect((parsed.operations[0] as any).characterId).toBeUndefined()
})

test("applyBeatObligationRepairPatch rejects invalid source and character references", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [beat({ beatId: "ch-001-treatment-beat-001-dose", characters: ["Istra"] })],
    knowledgeChanges: [
      { id: "know-istra-truth", characterId: "char-istra", characterName: "Istra", knowledge: "truth", source: "deduced" } as any,
    ],
  })

  const result = applyBeatObligationRepairPatch(outline, {
    operations: [
      { op: "addObligation", beatId: "missing-beat", list: "mustTransferKnowledge", sourceId: "know-istra-truth", sourceKind: "knowledge", characterId: "char-istra", text: "Istra learns the truth." },
      { op: "addObligation", beatId: "ch-001-treatment-beat-001-dose", list: "mustTransferKnowledge", sourceId: "know-istra-truth", sourceKind: "knowledge", characterId: "char-alric", text: "Istra learns the truth." },
    ],
  })

  expect(result.applied).toEqual([])
  expect(result.rejected).toHaveLength(2)
  expect(result.validation.valid).toBe(false)
})

test("applyBeatObligationRepairPatch can remove bad obligations before adding corrected ones", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [beat({ beatId: "ch-001-treatment-beat-001-dose", obligations: {
      mustEstablish: [
        { obligationId: "obl-bad", sourceId: "unknown-source", sourceKind: "fact", text: "Bad link" } as any,
      ],
      mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    } })],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "Aldric falsified the plague ledgers", category: "knowledge" },
    ],
  })

  const result = applyBeatObligationRepairPatch(outline, {
    operations: [
      { op: "removeObligation", beatId: "ch-001-treatment-beat-001-dose", list: "mustEstablish", obligationId: "obl-bad" },
      { op: "addObligation", beatId: "ch-001-treatment-beat-001-dose", list: "mustEstablish", sourceId: "fact-ledger-forgery", sourceKind: "fact", text: "Aldric falsified the plague ledgers." },
    ],
  })

  expect(result.rejected).toEqual([])
  expect(result.validation.valid).toBe(true)
  expect(result.outline.scenes[0].obligations.mustEstablish).toHaveLength(1)
  expect((result.outline.scenes[0].obligations.mustEstablish[0] as any).sourceId).toBe("fact-ledger-forgery")
})

test("deriveBeatObligations counts id-less established facts as orphan telemetry", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [beat({ description: "Istra records the cure result." })],
    establishedFacts: [
      { id: "", fact: "The cure result is unstable", category: "knowledge" },
    ],
  }))

  expect(result.summary.factCount).toBe(1)
  expect(result.summary.orphanFacts).toBe(1)
})

test("deriveBeatObligations warns when a payoff target is outside the chapter", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [
      beat({ description: "Istra plants a cure clue.", requiredPayoffs: [{ fact_id: "cure-clue", payoff_beat: 9 }] }),
    ],
    establishedFacts: [
      { id: "cure-clue", fact: "The cure clue points to the archive", category: "knowledge" },
    ],
  }))

  expect(result.warnings.some(w => w.includes("points outside the chapter"))).toBe(true)
  expect(result.beats[0].mustEstablish[0]).toEqual(expect.objectContaining({ sourceId: "cure-clue" }))
})

test("deriveBeatObligations does not mark known chapter characters as allowed new entities", () => {
  const result = deriveBeatObligations(chapter({
    charactersPresent: ["Istra", "Wren"],
    scenes: [beat({ description: "Wren coughs behind the curtain while the Ledger Key glows.", characters: ["Istra"] })],
  }))

  expect(result.beats[0].allowedNewEntities).not.toContain("Wren")
  expect(result.beats[0].allowedNewEntities).toContain("Ledger Key")
})

test("renderBeatObligations emits compact writer-facing sections", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [
      beat({ description: "Istra finds the Ledger Key under Wren's pillow.", requiredPayoffs: [{ fact_id: "ledger-key", payoff_beat: 1 }] }),
      beat({ description: "Istra unlocks the ledger with the key." }),
    ],
    establishedFacts: [
      { id: "ledger-key", fact: "The Ledger Key is hidden under Wren's pillow", category: "physical" },
    ],
  }))

  const rendered = renderBeatObligations(result.beats[0])

  expect(rendered).toContain("BEAT OBLIGATIONS")
  expect(rendered).toContain("Must establish")
  expect(rendered).toContain("The Ledger Key is hidden under Wren's pillow")
  expect(rendered).toContain("Allowed new named entities")
  expect(rendered).toContain("Ledger Key")
})

test("enrichOutlineIds is idempotent across repeated calls", () => {
  const outline = chapter({
    scenes: [beat({ description: "Istra reads the ledger." })],
    establishedFacts: [{ id: "fact-some-fact", fact: "Some fact", category: "knowledge" }],
  })
  const r1 = enrichOutlineIds(outline)
  const r2 = enrichOutlineIds(outline)
  expect(r1.chapterId).toBe(r2.chapterId)
  expect(r1.beatIds).toEqual(r2.beatIds)
  expect(outline.scenes[0].beatId).toBe(r1.beatIds[0])
})

// ── Phase-10/11/12 guard tests (post-Opus adversarial review ff9bdda) ────

test("repair schema rejects malformed stable IDs at parse time", () => {
  const result = planningStateRepairSchema.safeParse({
    operations: [{
      op: "addObligation",
      beatId: "Not A Valid Beat ID",
      list: "mustEstablish",
      sourceId: "fact-ok",
      sourceKind: "fact",
      text: "anything",
    }],
  })
  expect(result.success).toBe(false)
})

test("repair schema caps operations at 64 per call", () => {
  const op = (i: number) => ({
    op: "addObligation" as const,
    beatId: `ch-001-x-beat-001-y-${i}`,
    list: "mustEstablish" as const,
    sourceId: `fact-${i}`,
    sourceKind: "fact" as const,
    text: "x",
  })
  const ok = planningStateRepairSchema.safeParse({ operations: Array.from({ length: 64 }, (_, i) => op(i)) })
  const tooMany = planningStateRepairSchema.safeParse({ operations: Array.from({ length: 65 }, (_, i) => op(i)) })
  expect(ok.success).toBe(true)
  expect(tooMany.success).toBe(false)
})

test("apply overwrites agent-emitted text with canonical source text", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [beat({ beatId: "ch-001-treatment-beat-001-dose", characters: ["Istra"] })],
    knowledgeChanges: [
      { id: "know-istra-truth", characterId: "char-istra", characterName: "Istra", knowledge: "Aldric falsified the plague ledgers", source: "deduced" } as any,
    ],
  })

  const result = applyBeatObligationRepairPatch(outline, {
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-001-dose",
      list: "mustTransferKnowledge",
      sourceId: "know-istra-truth",
      sourceKind: "knowledge",
      characterId: "char-istra",
      text: "Istra learns the ledger was DESTROYED.", // hallucinated paraphrase
    }],
  })

  expect(result.applied).toHaveLength(1)
  const item = result.outline.scenes[0].obligations.mustTransferKnowledge[0] as any
  // Apply loop overwrites with canonical source.knowledge text.
  expect(item.text).toBe("Aldric falsified the plague ledgers")
})

test("apply rejects duplicate (beat, list, sourceId) on add", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [beat({ beatId: "ch-001-treatment-beat-001-dose", characters: ["Istra"] })],
    knowledgeChanges: [
      { id: "know-istra-truth", characterId: "char-istra", characterName: "Istra", knowledge: "X", source: "deduced" } as any,
    ],
  })
  const op = {
    op: "addObligation" as const,
    beatId: "ch-001-treatment-beat-001-dose",
    list: "mustTransferKnowledge" as const,
    sourceId: "know-istra-truth",
    sourceKind: "knowledge" as const,
    characterId: "char-istra",
    text: "Istra learns X.",
  }
  const result = applyBeatObligationRepairPatch(outline, { operations: [op, op] })
  expect(result.applied).toHaveLength(1)
  expect(result.rejected).toHaveLength(1)
  expect(result.rejected[0]).toContain("already references sourceId")
  expect(result.outline.scenes[0].obligations.mustTransferKnowledge).toHaveLength(1)
})

test("apply rejects knowledge/state ops on beats where the source character is absent", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [
      beat({ beatId: "ch-001-treatment-beat-001-istra", characters: ["Istra"] }),
      beat({ beatId: "ch-001-treatment-beat-002-aldric-only", characters: ["Aldric"] }),
    ],
    knowledgeChanges: [
      { id: "know-istra-truth", characterId: "char-istra", characterName: "Istra", knowledge: "X", source: "deduced" } as any,
    ],
  })
  const result = applyBeatObligationRepairPatch(outline, {
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-002-aldric-only",
      list: "mustTransferKnowledge",
      sourceId: "know-istra-truth",
      sourceKind: "knowledge",
      characterId: "char-istra",
      text: "Istra learns X.",
    }],
  })
  expect(result.applied).toEqual([])
  expect(result.rejected[0]).toContain("not in beat ch-001-treatment-beat-002-aldric-only")
})

test("apply enforces per-beat hard-obligation cap of 5", () => {
  // Pre-populate the beat with 5 fact obligations, then attempt to add a
  // 6th. Cap rejection fires before any sourceId validation.
  const facts = Array.from({ length: 6 }, (_, i) => ({ id: `fact-${i}`, fact: `f${i}`, category: "knowledge" }))
  const obligations = {
    mustEstablish: facts.slice(0, 5).map((f, i) => ({
      obligationId: `obl-001-treatment-beat-001-dose-fact-${pad(i)}-${f.id}`,
      sourceId: f.id,
      sourceKind: "fact",
      text: f.fact,
    } as any)),
    mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
  }
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [beat({ beatId: "ch-001-treatment-beat-001-dose", characters: ["Istra"], obligations })],
    establishedFacts: facts,
  })
  const result = applyBeatObligationRepairPatch(outline, {
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-001-dose",
      list: "mustEstablish",
      sourceId: "fact-5",
      sourceKind: "fact",
      text: "f5",
    }],
  })
  expect(result.applied).toEqual([])
  expect(result.rejected[0]).toContain("already has 5 hard obligations")
})

test("apply rejects sourceKind=payoff without a requiredPayoffs link", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [beat({ beatId: "ch-001-treatment-beat-001-dose", characters: ["Istra"] })],
    establishedFacts: [{ id: "fact-no-link", fact: "Some fact", category: "knowledge" }],
  })
  const result = applyBeatObligationRepairPatch(outline, {
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-001-dose",
      list: "mustPayOff",
      sourceId: "fact-no-link",
      sourceKind: "payoff",
      text: "anything",
    }],
  })
  expect(result.applied).toEqual([])
  expect(result.rejected[0]).toContain("requires a requiredPayoffs link")
})

test("apply rejects sourceKind=payoff landing on the wrong beat per requiredPayoffs link", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [
      beat({ beatId: "ch-001-treatment-beat-001-seed", characters: ["Istra"], requiredPayoffs: [{ fact_id: "fact-clue", payoff_beat: 2 }] }),
      beat({ beatId: "ch-001-treatment-beat-002-mid", characters: ["Istra"] }),
      beat({ beatId: "ch-001-treatment-beat-003-payoff", characters: ["Istra"] }),
    ],
    establishedFacts: [{ id: "fact-clue", fact: "Cure clue points to the archive", category: "knowledge" }],
  })
  // Try landing the payoff on beat 1 (the seed beat) instead of beat 2.
  const result = applyBeatObligationRepairPatch(outline, {
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-001-seed",
      list: "mustPayOff",
      sourceId: "fact-clue",
      sourceKind: "payoff",
      text: "anything",
    }],
  })
  expect(result.applied).toEqual([])
  expect(result.rejected[0]).toContain("must land on ch-001-treatment-beat-003-payoff")
})

test("apply accepts sourceKind=payoff on the correct linked beat", () => {
  const outline = chapter({
    chapterId: "ch-001-treatment",
    scenes: [
      beat({ beatId: "ch-001-treatment-beat-001-seed", characters: ["Istra"], requiredPayoffs: [{ fact_id: "fact-clue", payoff_beat: 1 }] }),
      beat({ beatId: "ch-001-treatment-beat-002-payoff", characters: ["Istra"] }),
    ],
    establishedFacts: [{ id: "fact-clue", fact: "Cure clue points to the archive", category: "knowledge" }],
  })
  const result = applyBeatObligationRepairPatch(outline, {
    operations: [{
      op: "addObligation",
      beatId: "ch-001-treatment-beat-002-payoff",
      list: "mustPayOff",
      sourceId: "fact-clue",
      sourceKind: "payoff",
      text: "anything",
    }],
  })
  expect(result.rejected).toEqual([])
  expect(result.applied).toHaveLength(1)
})

function pad(n: number): string { return String(n).padStart(3, "0") }

function chapter(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Treatment",
    povCharacter: "Istra",
    setting: "The Chancel Infirmary",
    purpose: "Test beat obligations",
    targetWords: 450,
    charactersPresent: ["Istra", "Aldric", "Wren"],
    scenes: [beat()],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra treats Wren.",
    characters: ["Istra"],
    kind: "action",
    requiredPayoffs: [],
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  } as SceneBeat
}
