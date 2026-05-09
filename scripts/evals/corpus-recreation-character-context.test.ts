import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCorpusRecreationCharacterContext,
  renderCorpusRecreationCharacterContext,
} from "./corpus-recreation-character-context"

describe("corpus-recreation-character-context", () => {
  test("builds per-scene character context from character IDs and obligations", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-character-context-"))
    try {
      const pocDir = join(root, "poc")
      writeCharacterContextFixture(pocDir)

      const report = buildCorpusRecreationCharacterContext(pocDir, "2026-05-09T00:00:00.000Z")
      const sceneOne = report.contexts[0]!
      const sceneTwo = report.contexts[1]!

      expect(report.contextCount).toBe(2)
      expect(report.issueCount).toBe(0)
      expect(sceneOne.activeCharacterIds).toEqual(["char-nara", "char-tovin"])
      expect(sceneOne.affectedCharacterIds).toEqual([])
      expect(sceneOne.characterCards).toEqual(expect.arrayContaining([
        expect.objectContaining({
          characterId: "char-nara",
          sceneRole: "pov",
          want: "clear her name",
          need: "ask for help",
          lie: "private cleverness restores honor",
          truth: "public accountability restores honor",
        }),
        expect.objectContaining({
          characterId: "char-tovin",
          sceneRole: "supporting",
          pressure: "He can restore Nara legally if she gives him leverage.",
          sourceObligationIds: ["obl-tovin-pressure"],
          activeThreadIds: ["thread-tovin"],
        }),
      ]))
      expect(sceneTwo.characterCards.find(card => card.characterId === "char-mirel")?.sourceObligationIds)
        .toEqual(["obl-mirel-truth"])

      const rendered = renderCorpusRecreationCharacterContext(report)
      expect(rendered).toContain("Writer Context Boundary")
      expect(rendered).toContain("char-nara (pov) Nara Venn")
      expect(rendered).toContain("Need: ask for help")
      expect(rendered).toContain("Source obligations: obl-tovin-pressure")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("surfaces unknown character refs without semantic inference", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-character-context-"))
    try {
      const pocDir = join(root, "poc")
      writeCharacterContextFixture(pocDir, {
        badObligation: {
          obligationId: "obl-ghost",
          sceneId: "analog-sc02",
          sourceId: "char-ghost",
          requirementText: "Unknown character changes the scene.",
        },
      })

      const report = buildCorpusRecreationCharacterContext(pocDir, "2026-05-09T00:00:00.000Z")
      expect(report.issueCount).toBeGreaterThan(0)
      expect(report.contexts[1]!.structuralIssues.join("\n")).toContain("unknown character sourceId char-ghost")
      expect(renderCorpusRecreationCharacterContext(report)).toContain("unknown character sourceId char-ghost")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("flags exact named characters missing from character refs", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-character-context-"))
    try {
      const pocDir = join(root, "poc")
      writeCharacterContextFixture(pocDir, {
        omitMirelObligation: true,
      })

      const report = buildCorpusRecreationCharacterContext(pocDir, "2026-05-09T00:00:00.000Z")
      const sceneTwo = report.contexts[1]!

      expect(sceneTwo.activeCharacterIds).toContain("char-mirel")
      expect(sceneTwo.structuralIssues.join("\n")).toContain("character char-mirel is named in scene contract but missing requiredCharacterIds/source obligation")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("keeps consequence-only affected characters out of active writer cards", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-character-context-"))
    try {
      const pocDir = join(root, "poc")
      writeCharacterContextFixture(pocDir, {
        consequenceAffectedCharacter: true,
      })

      const report = buildCorpusRecreationCharacterContext(pocDir, "2026-05-09T00:00:00.000Z")
      const sceneOne = report.contexts[0]!

      expect(report.issueCount).toBe(0)
      expect(sceneOne.activeCharacterIds).toEqual(["char-nara"])
      expect(sceneOne.affectedCharacterIds).toEqual(["char-tovin"])
      expect(sceneOne.characterCards.map(card => card.characterId)).toEqual(["char-nara"])
      expect(renderCorpusRecreationCharacterContext(report)).toContain("Affected characters: char-tovin")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("treats beat-hint character names as local writer context refs", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-character-context-"))
    try {
      const pocDir = join(root, "poc")
      writeCharacterContextFixture(pocDir, {
        beatHintOnlyCharacter: true,
      })

      const report = buildCorpusRecreationCharacterContext(pocDir, "2026-05-09T00:00:00.000Z")
      const sceneOne = report.contexts[0]!

      expect(sceneOne.activeCharacterIds).toContain("char-tovin")
      expect(sceneOne.structuralIssues.join("\n")).toContain("character char-tovin is named in scene contract but missing requiredCharacterIds/source obligation")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeCharacterContextFixture(path: string, opts: {
  badObligation?: Record<string, unknown>
  omitMirelObligation?: boolean
  consequenceAffectedCharacter?: boolean
  beatHintOnlyCharacter?: boolean
} = {}): void {
  writeJson(join(path, "packet.json"), {
    sourceReference: { book: "crystal_shard", chapterLabel: "1" },
    diagnosticConfig: { plannerVariant: "baseline" },
    originalAnalogSeed: {
      protagonist: {
        characterId: "char-nara",
        name: "Nara Venn",
        role: "courier",
        want: "clear her name",
        need: "ask for help",
        lie: "private cleverness restores honor",
        truth: "public accountability restores honor",
        speechPattern: "clipped, practical, avoids pleading",
        exampleLines: ["I can carry it or bury it. Choose."],
      },
      supportingCharacters: [
        {
          characterId: "char-tovin",
          name: "Tovin Ash",
          role: "rival surveyor",
          pressure: "He can restore Nara legally if she gives him leverage.",
          voiceAnchors: ["Law is just a map with teeth."],
        },
        {
          characterId: "char-mirel",
          name: "Mirel Sorn",
          role: "frontier guide",
          pressure: "She demands Nara name the abandoned convoy.",
        },
      ],
    },
  })
  writeJson(join(path, "plan.json"), {
    chapterId: "analog-ch01",
    title: "Test",
    scenes: [
      {
        sceneId: "analog-sc01",
        povCharacterId: "char-nara",
        goal: "Reach the clerk before curfew.",
        opposition: (opts.consequenceAffectedCharacter || opts.beatHintOnlyCharacter) ? "The clerk is about to close the office." : "Tovin blocks her with a writ.",
        crisisChoice: "Refuse him or sign.",
        outcome: "She signs.",
        consequence: opts.consequenceAffectedCharacter ? "Tovin can use the delay against her later." : "Tovin gains leverage.",
        requiredCharacterIds: (opts.consequenceAffectedCharacter || opts.beatHintOnlyCharacter) ? [] : ["char-tovin"],
        affectedCharacterIds: opts.consequenceAffectedCharacter ? ["char-tovin"] : [],
        beatHints: opts.beatHintOnlyCharacter ? [{ purpose: "Tovin watches for her signature from the corridor." }] : [],
      },
      {
        sceneId: "analog-sc02",
        povCharacterId: "char-nara",
        goal: "Get a route from Mirel.",
        opposition: "Mirel demands the convoy name.",
        crisisChoice: "Tell the truth or keep moving.",
        outcome: "Nara withholds the name.",
        consequence: "Mirel becomes a future witness.",
      },
    ],
    obligations: [
      ...((opts.consequenceAffectedCharacter || opts.beatHintOnlyCharacter) ? [] : [{
        obligationId: "obl-tovin-pressure",
        sceneId: "analog-sc01",
        sourceId: "char-tovin",
        threadId: "thread-tovin",
        requirementText: "Tovin uses the writ to force Nara's signature.",
      }]),
      ...(opts.omitMirelObligation ? [] : [{
        obligationId: "obl-mirel-truth",
        sceneId: "analog-sc02",
        sourceId: "char-mirel",
        threadId: "thread-accountability",
        promiseId: "debt-oathmark",
        requirementText: "Mirel demands Nara name the convoy.",
      }]),
      ...(opts.badObligation ? [opts.badObligation] : []),
    ],
  })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
