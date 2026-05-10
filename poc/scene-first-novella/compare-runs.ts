/**
 * Compare two scene-first novella POC artifacts.
 *
 * Reads review-summary.json from a baseline and variant run dir and writes a
 * compact markdown evidence report. This is POC-only: it does not inspect or
 * mutate production runtime state.
 *
 * Usage:
 *   bun poc/scene-first-novella/compare-runs.ts \
 *     --baseline poc/scene-first-novella/output/poc-scene-first-1778423752 \
 *     --variant poc/scene-first-novella/output/<new-run-id> \
 *     --out poc/scene-first-novella/output/<new-run-id>/comparison.md
 */

import { writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

interface Args {
  baselineDir: string
  variantDir: string
  outPath: string
}

interface ReviewSummary {
  runId: string
  profile: string | null
  fixturePath: string | null
  chaptersRendered: number
  chaptersRequested: number | null
  reviewStats: {
    totalScenes: number
    coreContractFieldScenes: number
    choiceAlternativeScenes: number
    sceneIds: number
    beatIds: number
    obligationIds: number
    sourceIds: number
    characterIds: number
    threadIds: number
    promiseIds: number
    payoffIds: number
    proseWords: number
    targetWords: number
  }
  diagnosticStats: {
    endpointJudged: number
    endpointErrors: number
    endpointScores: number[]
    sceneDramaturgyJudged: number
    sceneDramaturgyErrors: number
    sceneValueShiftAverage: number | null
    conflictVisibleScenes: number
    decisionOrRevelationScenes: number
    characterAgencyJudged: number
    characterAgencyErrors: number
    characterAgencyAverage: number | null
  }
  findings: string[]
}

interface Comparison {
  baseline: ReviewSummary
  variant: ReviewSummary
  deltas: {
    wordRatio: number | null
    wordRatioDelta: number | null
    totalScenesDelta: number
    obligationsPerSceneDelta: number | null
    chapterOneEndpointDelta: number | null
  }
  hypothesisVerdicts: string[]
  promotionVerdict: string
}

function parseArgs(argv: string[]): Args {
  let baselineDir: string | null = null
  let variantDir: string | null = null
  let outPath: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--baseline") { baselineDir = argv[++i] ?? null; continue }
    if (a === "--variant") { variantDir = argv[++i] ?? null; continue }
    if (a === "--out") { outPath = argv[++i] ?? null; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!baselineDir) throw new Error("--baseline <run-dir> is required")
  if (!variantDir) throw new Error("--variant <run-dir> is required")
  return {
    baselineDir,
    variantDir,
    outPath: outPath ?? join(variantDir, "comparison.md"),
  }
}

function ratio(summary: ReviewSummary): number | null {
  const target = summary.reviewStats.targetWords
  return target > 0 ? summary.reviewStats.proseWords / target : null
}

function obligationsPerScene(summary: ReviewSummary): number | null {
  const scenes = summary.reviewStats.totalScenes
  return scenes > 0 ? summary.reviewStats.obligationIds / scenes : null
}

function fmtNumber(value: number | null, digits = 2): string {
  return value === null ? "n/a" : value.toFixed(digits)
}

function fmtSigned(value: number | null, digits = 2): string {
  if (value === null) return "n/a"
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${value.toFixed(digits)}`
}

function firstEndpoint(summary: ReviewSummary): number | null {
  return typeof summary.diagnosticStats.endpointScores[0] === "number"
    ? summary.diagnosticStats.endpointScores[0]!
    : null
}

export function buildComparison(baseline: ReviewSummary, variant: ReviewSummary): Comparison {
  const baselineRatio = ratio(baseline)
  const variantRatio = ratio(variant)
  const wordRatioDelta = baselineRatio !== null && variantRatio !== null ? variantRatio - baselineRatio : null
  const baselineOps = obligationsPerScene(baseline)
  const variantOps = obligationsPerScene(variant)
  const obligationsPerSceneDelta = baselineOps !== null && variantOps !== null ? variantOps - baselineOps : null
  const chapterOneEndpointDelta = firstEndpoint(baseline) !== null && firstEndpoint(variant) !== null
    ? firstEndpoint(variant)! - firstEndpoint(baseline)!
    : null

  const sceneDrop = baseline.reviewStats.totalScenes - variant.reviewStats.totalScenes
  const ratioImprovedMaterially = wordRatioDelta !== null && wordRatioDelta <= -0.5
  const endpointNotWorse = chapterOneEndpointDelta === null || chapterOneEndpointDelta >= 0
  const obligationDensityLower = obligationsPerSceneDelta !== null && obligationsPerSceneDelta < 0

  const hypothesisVerdicts = [
    ratioImprovedMaterially && sceneDrop > 0
      ? `Supported: tighter scene count correlated with a lower word ratio (${fmtNumber(baselineRatio)} -> ${fmtNumber(variantRatio)}) across ${baseline.reviewStats.totalScenes} -> ${variant.reviewStats.totalScenes} scenes.`
      : `Not yet supported: tighter scene count did not materially reduce word ratio (${fmtNumber(baselineRatio)} -> ${fmtNumber(variantRatio)}) or scene count did not fall.`,
    obligationDensityLower
      ? `Supported: obligation density fell (${fmtNumber(baselineOps)} -> ${fmtNumber(variantOps)} obligations/scene), so the variant actually tested lower load.`
      : `Weak or unsupported: obligation density did not fall (${fmtNumber(baselineOps)} -> ${fmtNumber(variantOps)} obligations/scene).`,
    chapterOneEndpointDelta !== null && chapterOneEndpointDelta > 0
      ? `Supported: the chapter-1 endpoint improved (${firstEndpoint(baseline)} -> ${firstEndpoint(variant)}), consistent with endpoint/hook fit being a failure source.`
      : endpointNotWorse
        ? `Mixed: the chapter-1 endpoint did not regress (${firstEndpoint(baseline)} -> ${firstEndpoint(variant)}), but did not prove endpoint/hook repair.`
        : `Rejected for this variant: the chapter-1 endpoint regressed (${firstEndpoint(baseline)} -> ${firstEndpoint(variant)}).`,
  ]

  const allEndpointsStrong = variant.diagnosticStats.endpointScores.length === variant.chaptersRendered
    && variant.diagnosticStats.endpointScores.every(score => score >= 3)
  const diagnosticsComplete = variant.diagnosticStats.endpointErrors === 0
    && variant.diagnosticStats.sceneDramaturgyErrors === 0
    && variant.diagnosticStats.characterAgencyErrors === 0
  const traceabilityComplete = variant.reviewStats.sceneIds === variant.reviewStats.totalScenes
  const promotable = variantRatio !== null
    && variantRatio <= 1.5
    && allEndpointsStrong
    && diagnosticsComplete
    && traceabilityComplete

  const promotionVerdict = promotable
    ? "Candidate for a production change packet: variant hit <=1.5x word ratio, all endpoints scored 3, diagnostics were complete, and scene IDs were preserved."
    : ratioImprovedMaterially && endpointNotWorse
      ? "Needs another POC loop before promotion: direction improved, but the artifact has not reached the production-default evidence bar."
      : "Rejected or inconclusive for promotion: do not promote this hypothesis without another POC loop."

  return {
    baseline,
    variant,
    deltas: {
      wordRatio: variantRatio,
      wordRatioDelta,
      totalScenesDelta: variant.reviewStats.totalScenes - baseline.reviewStats.totalScenes,
      obligationsPerSceneDelta,
      chapterOneEndpointDelta,
    },
    hypothesisVerdicts,
    promotionVerdict,
  }
}

export function renderComparisonMarkdown(comparison: Comparison): string {
  const { baseline, variant, deltas } = comparison
  const baselineRatio = ratio(baseline)
  const variantRatio = ratio(variant)
  const baselineOps = obligationsPerScene(baseline)
  const variantOps = obligationsPerScene(variant)
  return [
    `# Scene-First POC Comparison: ${basename(baseline.runId)} -> ${basename(variant.runId)}`,
    "",
    "## Hypotheses",
    "",
    "1. Word overshoot is mainly a planner-scope problem: too many scene contracts and too much obligation load ask the writer for more story than the chapter target can hold.",
    "2. The chapter-1 endpoint miss comes from endpoint/hook mismatch: the baseline asks the chapter to reveal the transfer, set up the third path, and make a decision, but the prose only lands near a clue.",
    "3. A tighter chapter split with explicit max scene count should improve ratio without losing traceability.",
    "",
    "## Metrics",
    "",
    "| Metric | Baseline | Variant | Delta |",
    "| --- | ---: | ---: | ---: |",
    `| Word ratio | ${fmtNumber(baselineRatio)} | ${fmtNumber(variantRatio)} | ${fmtSigned(deltas.wordRatioDelta)} |`,
    `| Prose / target words | ${baseline.reviewStats.proseWords}/${baseline.reviewStats.targetWords} | ${variant.reviewStats.proseWords}/${variant.reviewStats.targetWords} | ${variant.reviewStats.proseWords - baseline.reviewStats.proseWords} words |`,
    `| Scene contracts | ${baseline.reviewStats.totalScenes} | ${variant.reviewStats.totalScenes} | ${fmtSigned(deltas.totalScenesDelta, 0)} |`,
    `| Obligations / scene | ${fmtNumber(baselineOps)} | ${fmtNumber(variantOps)} | ${fmtSigned(deltas.obligationsPerSceneDelta)} |`,
    `| Chapter-1 endpoint score | ${firstEndpoint(baseline) ?? "n/a"} | ${firstEndpoint(variant) ?? "n/a"} | ${fmtSigned(deltas.chapterOneEndpointDelta, 0)} |`,
    `| Endpoint scores | ${baseline.diagnosticStats.endpointScores.join(", ")} | ${variant.diagnosticStats.endpointScores.join(", ")} |  |`,
    `| Scene diagnostics judged | ${baseline.diagnosticStats.sceneDramaturgyJudged}/${baseline.reviewStats.totalScenes} | ${variant.diagnosticStats.sceneDramaturgyJudged}/${variant.reviewStats.totalScenes} |  |`,
    `| Character agency judged | ${baseline.diagnosticStats.characterAgencyJudged}/${baseline.reviewStats.totalScenes} | ${variant.diagnosticStats.characterAgencyJudged}/${variant.reviewStats.totalScenes} |  |`,
    `| Scene IDs | ${baseline.reviewStats.sceneIds}/${baseline.reviewStats.totalScenes} | ${variant.reviewStats.sceneIds}/${variant.reviewStats.totalScenes} |  |`,
    "",
    "## Findings",
    "",
    ...comparison.hypothesisVerdicts.map(line => `- ${line}`),
    `- Promotion verdict: ${comparison.promotionVerdict}`,
    "",
    "## Artifact Links",
    "",
    `- Baseline: \`${baseline.runId}\` (${baseline.fixturePath ?? "unknown fixture"})`,
    `- Variant: \`${variant.runId}\` (${variant.fixturePath ?? "unknown fixture"})`,
    "",
  ].join("\n")
}

async function loadSummary(runDir: string): Promise<ReviewSummary> {
  const file = Bun.file(join(runDir, "review-summary.json"))
  if (!await file.exists()) throw new Error(`missing review-summary.json in ${runDir}`)
  return await file.json()
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const baseline = await loadSummary(args.baselineDir)
  const variant = await loadSummary(args.variantDir)
  const comparison = buildComparison(baseline, variant)
  await writeFile(args.outPath, renderComparisonMarkdown(comparison), "utf8")
  console.log(`wrote ${args.outPath}`)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
