import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCorpusRecreationReview,
  renderCorpusRecreationReviewHtml,
} from "./corpus-recreation-review"

describe("corpus-recreation-review", () => {
  test("renders plan, prose, reference shape, warnings, and semantic findings", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-review-"))
    try {
      const pocDir = join(root, "poc")
      writeJson(join(pocDir, "packet.json"), {
        generatedAt: "2026-05-09T00:00:00.000Z",
        sourceReference: { book: "crystal_shard", chapterLabel: "1" },
        diagnosticConfig: { plannerVariant: "materiality-v1", writerContextMode: "thread-context-v1" },
        target: {
          targetWords: 1000,
          sceneCount: 1,
          sceneBlueprints: [
            {
              referenceSceneOrdinal: 0,
              targetWords: 1000,
              targetBeatCount: 4,
              polarity: "-",
              micePrimaryThread: "M",
              beatKindCounts: { action: 2 },
              boundarySignalCounts: { scene_start: 1 },
              gapSizeCounts: { large: 1 },
              sourceStructuralDigest: "private structural digest",
              beatPurposeHints: ["hint one"],
            },
          ],
        },
      })
      writeJson(join(pocDir, "run-manifest.json"), {
        schemaVersion: "1.0",
        generatedAt: "2026-05-09T00:00:00.000Z",
        laneId: "run-thread-id-drafting-coherence",
        phase: "corpus-recreation-poc",
        runId: "run-poc-1",
        rootRunId: "root-run-1",
        parentRunId: null,
        variantId: "materiality-v1",
        command: { name: "diagnostics:corpus-recreation-poc", argv: ["--planner-variant", "materiality-v1"] },
        model: { provider: "deepseek", model: "deepseek-v4-flash" },
        inputs: [],
        outputs: [],
        relatedRunIds: [],
        metadata: {},
      })
      writeJson(join(pocDir, "plan.json"), {
        chapterId: "analog-ch01",
        title: "Test",
        scenes: [
          {
            sceneId: "analog-sc01",
            referenceSceneOrdinal: 0,
            targetWords: 1000,
            structuralRole: "Open the problem.",
            goal: "Reach the gate.",
            opposition: "The gate rejects her.",
            turningPoint: "The bell rings.",
            crisisChoice: "Enter or retreat?",
            choiceAlternatives: ["enter", "retreat"],
            outcome: "She enters.",
            consequence: "The city marks her.",
          },
        ],
        obligations: [
          {
            obligationId: "obl-1",
            sceneId: "analog-sc01",
            sourceId: "world-bell",
            threadId: "thread-bell",
            promiseId: "debt-bell",
            payoffId: "payoff-bell-rings",
            requirementText: "Make the bell matter.",
            materialityTest: "The bell changes the outcome.",
          },
        ],
      })
      writeJson(join(pocDir, "thread-map.json"), {
        generatedAt: "2026-05-09T00:00:00.000Z",
        pocDirs: [pocDir],
        rowCount: 1,
        issueCount: 0,
        scenes: [
          {
            sceneId: "analog-sc01",
            chapterId: "analog-ch01",
            consequence: "The city marks her.",
            movementCount: 1,
            threadIds: ["thread-bell"],
            promiseIds: ["debt-bell"],
            payoffIds: ["payoff-bell-rings"],
            issueCount: 0,
          },
        ],
        threads: [],
        promises: [],
        impacts: [
          {
            refKind: "payoff",
            ref: "payoff-bell-rings",
            affectedSceneIds: ["analog-sc01"],
            affectedObligationIds: ["obl-1"],
          },
        ],
        rows: [],
        issues: [],
      })
      writeJson(join(pocDir, "thread-context.json"), {
        generatedAt: "2026-05-09T00:00:00.000Z",
        pocDir,
        source: { book: "crystal_shard", chapterLabel: "1" },
        plannerVariant: "materiality-v1",
        sceneCount: 1,
        contextCount: 1,
        issueCount: 1,
        contexts: [
          {
            sceneId: "analog-sc01",
            sceneIndex: 0,
            sceneGoal: "Reach the gate.",
            sceneTurn: "The bell rings.",
            sceneOutcome: "She enters.",
            sceneConsequence: "The city marks her.",
            activeThreadIds: ["thread-bell"],
            activePromiseIds: ["debt-bell"],
            activePayoffIds: ["payoff-bell-rings"],
            requiredObligationIds: ["obl-1"],
            currentResponsibilities: ["obl-1 thread=thread-bell promise=debt-bell payoff=payoff-bell-rings: Make the bell matter."],
            ledger: [],
            priorMovements: [],
            futureImpactPreview: [],
            structuralIssues: [],
          },
        ],
        threadMapIssues: [],
      })
      writeJson(join(pocDir, "character-context.json"), {
        generatedAt: "2026-05-09T00:00:00.000Z",
        pocDir,
        source: { book: "crystal_shard", chapterLabel: "1" },
        plannerVariant: "materiality-v1",
        sceneCount: 1,
        contextCount: 1,
        issueCount: 0,
        contexts: [
          {
            sceneId: "analog-sc01",
            sceneIndex: 0,
            povCharacterId: "char-mara",
            sceneGoal: "Reach the gate.",
            sceneOpposition: "The gate rejects her.",
            sceneChoice: "Enter or retreat?",
            sceneOutcome: "She enters.",
            sceneConsequence: "The city marks her.",
            activeCharacterIds: ["char-mara", "char-bellkeeper"],
            characterCards: [
              {
                characterId: "char-mara",
                name: "Mara",
                role: "cartographer",
                sceneRole: "pov",
                want: "restore her map",
                need: "trust witnesses",
                lie: "private proof is enough",
                truth: "public proof requires allies",
                pressure: null,
                speechPattern: null,
                voiceAnchors: [],
                sourceObligationIds: [],
                activeThreadIds: [],
                activePromiseIds: [],
                activePayoffIds: [],
              },
              {
                characterId: "char-bellkeeper",
                name: "Bellkeeper",
                role: "gate official",
                sceneRole: "supporting",
                want: null,
                need: null,
                lie: null,
                truth: null,
                pressure: "Can bar Mara from the city.",
                speechPattern: null,
                voiceAnchors: [],
                sourceObligationIds: ["obl-1"],
                activeThreadIds: ["thread-bell"],
                activePromiseIds: ["debt-bell"],
                activePayoffIds: ["payoff-bell-rings"],
              },
            ],
            currentResponsibilities: ["obl-1 source=world-bell thread=thread-bell: Make the bell matter."],
            structuralIssues: ["analog-sc01: character char-bellkeeper is named in scene contract but missing requiredCharacterIds/source obligation"],
          },
        ],
      })
      writeJson(join(pocDir, "writer-context.json"), {
        generatedAt: "2026-05-09T00:00:00.000Z",
        mode: "thread-context-v1",
        sceneCount: 1,
        contexts: [
          {
            mode: "thread-context-v1",
            sceneId: "analog-sc01",
            activeThreads: [{ threadId: "thread-bell", label: "Bell Thread" }],
            activePromises: [{ promiseId: "debt-bell", threadId: "thread-bell" }],
            activePayoffs: [{ payoffId: "payoff-bell-rings", threadId: "thread-bell", promiseId: "debt-bell" }],
            currentResponsibilities: [
              {
                obligationId: "obl-1",
                sourceId: "world-bell",
                threadId: "thread-bell",
                promiseId: "debt-bell",
                payoffId: "payoff-bell-rings",
                requirementText: "Make the bell matter.",
                materialityTest: "The bell changes the outcome.",
              },
            ],
            priorMovements: [],
            futureImpactPreview: [],
          },
        ],
      })
      writeJson(join(pocDir, "plan-comparison.json"), {
        valuePolarity: { exactMatches: 1, expected: ["-"], ratio: 1 },
        miceThread: { exactMatches: 1, expected: ["M"], ratio: 1 },
        beatHintShape: { actualTotal: 4, expectedTotal: 4, ratio: 1 },
        sceneContract: {
          scenes: [
            { sceneId: "analog-sc01", issues: ["consequence weak"] },
          ],
        },
        issues: ["scene contract weak for analog-sc01"],
      })
      writeJson(join(pocDir, "chapter.json"), {
        chapterTitle: "Test",
        scenes: [
          { sceneId: "analog-sc01", prose: "She crossed the white road.\n\nThe bell rang and everyone turned." },
        ],
      })
      writeJson(join(pocDir, "chapter-comparison.json"), {
        wordCount: { target: 1000, actual: 10, ratio: 0.01 },
        sceneWordCounts: [
          { sceneId: "analog-sc01", target: 1000, actual: 10, meetsMinimum: false },
        ],
        sourceBoundary: { forbiddenTermsPresent: [] },
        issues: [],
        warnings: ["scene prose below advisory floor"],
      })
      writeJson(join(pocDir, "semantic-review-live/semantic-review.json"), {
        results: [
          {
            sceneId: "analog-sc01",
            dimension: "worldFactPressure",
            label: "WFACT-1",
            ordinal: 1,
            confidence: 0.8,
            missingForNextLevel: "World fact must change the available choices.",
          },
        ],
      })
      writeJson(join(pocDir, "prose-quality-live/prose-review.json"), {
        results: [
          {
            sceneId: "analog-sc01",
            dimension: "commercialPacing",
            label: "PACE-1",
            ordinal: 1,
            attention: "review",
            output: {
              weakness: "The scene reads rushed.",
              missingForNextLevel: "Needs more escalation through the turn.",
            },
          },
        ],
      })

      const report = buildCorpusRecreationReview([pocDir], "2026-05-09T00:00:00.000Z")
      const html = renderCorpusRecreationReviewHtml(report)

      expect(html).toContain("Reference shape")
      expect(html).toContain("private structural digest")
      expect(html).toContain("Make the bell matter.")
      expect(html).toContain("{thread:thread-bell}")
      expect(html).toContain("{payoff:payoff-bell-rings}")
      expect(html).toContain("scene prose below advisory floor")
      expect(html).toContain("World fact must change the available choices.")
      expect(html).toContain("commercialPacing")
      expect(html).toContain("The scene reads rushed.")
      expect(html).toContain("structural similarity as source leakage")
      expect(html).toContain("Run Provenance")
      expect(html).toContain("run-poc-1")
      expect(html).toContain("Thread Map")
      expect(html).toContain("Thread Context Preview")
      expect(html).toContain("Character Context Preview")
      expect(html).toContain("char-mara")
      expect(html).toContain("trust witnesses")
      expect(html).toContain("Character Context Issues")
      expect(html).toContain("missing requiredCharacterIds")
      expect(html).toContain("Writer Context Used")
      expect(html).toContain("materiality-v1 + thread-context-v1")
      expect(html).toContain("thread-context-v1")
      expect(html).toContain("thread-bell")
      expect(html).toContain("payoff:payoff-bell-rings")
      expect(html).toContain("obl-1 thread=thread-bell promise=debt-bell payoff=payoff-bell-rings")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("renders multiple POC runs as scene-aligned comparison columns", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-review-"))
    try {
      const baseline = join(root, "baseline")
      const materiality = join(root, "materiality")
      writeReviewFixture(baseline, {
        variant: "baseline",
        prose: "The bell rang in the distance, but she kept moving.",
        label: "WFACT-1",
        ordinal: 1,
        note: "The bell is present but does not alter the choice.",
      })
      writeReviewFixture(materiality, {
        variant: "materiality-v1",
        prose: "The bell rang and sealed the road behind her, forcing her to enter.",
        label: "WFACT-2",
        ordinal: 2,
        note: "The bell changes the available route.",
      })

      const report = buildCorpusRecreationReview([baseline, materiality], "2026-05-09T00:00:00.000Z")
      const html = renderCorpusRecreationReviewHtml(report)

      expect(html).toContain("Side-By-Side Variant Comparison")
      expect(html).toContain("baseline - baseline")
      expect(html).toContain("materiality-v1 - materiality")
      expect(html).toContain("The bell is present but does not alter the choice.")
      expect(html).toContain("The bell changes the available route.")
      expect(html).toContain("Reference shape")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeReviewFixture(path: string, opts: {
  variant: string
  prose: string
  label: string
  ordinal: number
  note: string
}): void {
  writeJson(join(path, "packet.json"), {
    generatedAt: "2026-05-09T00:00:00.000Z",
    sourceReference: { book: "crystal_shard", chapterLabel: "1" },
    diagnosticConfig: { plannerVariant: opts.variant },
    target: {
      targetWords: 1000,
      sceneCount: 1,
      sceneBlueprints: [
        {
          referenceSceneOrdinal: 0,
          targetWords: 1000,
          targetBeatCount: 4,
          polarity: "-",
          micePrimaryThread: "M",
          beatKindCounts: { action: 2 },
          boundarySignalCounts: { scene_start: 1 },
          gapSizeCounts: { large: 1 },
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
        referenceSceneOrdinal: 0,
        targetWords: 1000,
        structuralRole: "Open the problem.",
        goal: "Reach the gate.",
        opposition: "The gate rejects her.",
        turningPoint: "The bell rings.",
        crisisChoice: "Enter or retreat?",
        choiceAlternatives: ["enter", "retreat"],
        outcome: "She enters.",
        consequence: "The city marks her.",
      },
    ],
    obligations: [
      {
        obligationId: "obl-1",
        sceneId: "analog-sc01",
        sourceId: "world-bell",
        threadId: "thread-bell",
        requirementText: "Make the bell matter.",
      },
    ],
  })
  writeJson(join(path, "plan-comparison.json"), {
    valuePolarity: { exactMatches: 1, expected: ["-"], ratio: 1 },
    miceThread: { exactMatches: 1, expected: ["M"], ratio: 1 },
    beatHintShape: { actualTotal: 4, expectedTotal: 4, ratio: 1 },
    sceneContract: { scenes: [{ sceneId: "analog-sc01", issues: [] }] },
    issues: [],
  })
  writeJson(join(path, "chapter.json"), {
    chapterTitle: "Test",
    scenes: [{ sceneId: "analog-sc01", prose: opts.prose }],
  })
  writeJson(join(path, "chapter-comparison.json"), {
    wordCount: { target: 1000, actual: 10, ratio: 0.01 },
    sceneWordCounts: [{ sceneId: "analog-sc01", target: 1000, actual: 10, meetsMinimum: false }],
    sourceBoundary: { forbiddenTermsPresent: [] },
    issues: [],
    warnings: [],
  })
  writeJson(join(path, "semantic-review/semantic-review.json"), {
    results: [
      {
        sceneId: "analog-sc01",
        dimension: "worldFactPressure",
        label: opts.label,
        ordinal: opts.ordinal,
        confidence: 0.8,
        missingForNextLevel: opts.note,
      },
    ],
  })
  writeJson(join(path, "prose-quality-live/prose-review.json"), {
    results: [
      {
        sceneId: "analog-sc01",
        dimension: "dramatization",
        label: opts.ordinal <= 1 ? "DRAMA-1" : "DRAMA-2",
        ordinal: opts.ordinal,
        attention: opts.ordinal <= 1 ? "review" : "skip",
        output: {
          weakness: opts.note,
          missingForNextLevel: opts.note,
        },
      },
    ],
  })
}
