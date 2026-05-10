import { expect, test } from "bun:test"
import { applyPlanningNotePreset, compactOutlineObligationsForChapterBudget, parseArgs } from "./run"

test("defaults POC writer expansion to retry-short-scenes-v1", () => {
  const args = parseArgs(["--run-id", "poc-test"])

  expect(args.writerExpansionMode).toBe("retry-short-scenes-v1")
})

test("allows expansion-off POC runs for writer expansion isolation", () => {
  const args = parseArgs([
    "--fixture",
    "docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-density-cap.json",
    "--chapters",
    "3",
    "--run-id",
    "poc-test",
    "--writer-expansion-mode",
    "off",
  ])

  expect(args.fixturePath).toBe("docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-density-cap.json")
  expect(args.chapters).toBe(3)
  expect(args.writerExpansionMode).toBe("off")
})

test("rejects unknown writer expansion modes", () => {
  expect(() => parseArgs(["--run-id", "poc-test", "--writer-expansion-mode", "always"])).toThrow(
    /--writer-expansion-mode/,
  )
})

test("parses load-control experiment knobs", () => {
  const args = parseArgs([
    "--run-id",
    "poc-test",
    "--planning-note-preset",
    "single-obligation-hardcap-v2",
    "--obligation-control",
    "chapter-budget-v1",
  ])

  expect(args.planningNotePreset).toBe("single-obligation-hardcap-v2")
  expect(args.obligationControl).toBe("chapter-budget-v1")
})

test("planning note preset appends hardcap instructions without dropping directives", () => {
  const seed = applyPlanningNotePreset({
    premise: "p",
    genre: "g",
    characters: [],
    directives: {
      lockedCharacters: [],
      requiredBeats: [{ chapter: 1, description: "land endpoint", mustInclude: [] }],
      forbidden: [],
      tonalAnchors: [],
      structuralConstraints: { povRotation: "", pacing: "" },
      storyThreads: [],
      storyDebts: [],
      storyPayoffs: [],
      rawNotes: "Existing note.",
    },
  }, "single-obligation-hardcap-v2")

  expect(seed.directives?.requiredBeats).toHaveLength(1)
  expect(seed.directives?.rawNotes).toContain("Existing note.")
  expect(seed.directives?.rawNotes).toContain("single-obligation-hardcap-v2")
})

test("chapter-budget compactor preserves retained IDs and caps load", () => {
  const outline = {
    chapterNumber: 1,
    scenes: [
      {
        obligations: {
          mustEstablish: [{ text: "setup", obligationId: "obl-a", sourceId: "fact-a", sourceKind: "fact" }],
          mustTransferKnowledge: [{ text: "learns Velo target", obligationId: "obl-b", sourceId: "know-b", sourceKind: "knowledge" }],
          mustShowStateChange: [{ text: "shaken", obligationId: "obl-c", sourceId: "state-c", sourceKind: "state" }],
          mustPayOff: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
      {
        obligations: {
          mustEstablish: [{ text: "Council vote", obligationId: "obl-d", sourceId: "fact-d", sourceKind: "fact" }],
          mustTransferKnowledge: [{ text: "Maren chooses Velo meeting", obligationId: "obl-e", sourceId: "know-e", sourceKind: "knowledge", storyDebtStage: "progress" }],
          mustShowStateChange: [],
          mustPayOff: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
      {
        obligations: {
          mustEstablish: [{ text: "Maren refuses and decides", obligationId: "obl-f", sourceId: "fact-f", sourceKind: "fact", storyDebtStage: "partial_payoff", payoffId: "payoff-x" }],
          mustTransferKnowledge: [],
          mustShowStateChange: [{ text: "Maren chooses", obligationId: "obl-g", sourceId: "state-g", sourceKind: "state" }],
          mustPayOff: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    ],
  }

  const result = compactOutlineObligationsForChapterBudget(outline)
  const keptIds = result.outline.scenes.flatMap((scene: any) =>
    Object.values(scene.obligations).flatMap((items: any) =>
      Array.isArray(items) ? items.map((item: any) => item.obligationId).filter(Boolean) : [],
    ),
  )

  expect(result.report.before).toBe(7)
  expect(result.report.after).toBe(3)
  expect(result.report.removed).toBe(4)
  expect(keptIds).toContain("obl-f")
  expect(keptIds.every((id: string) => id.startsWith("obl-"))).toBe(true)
})
