#!/usr/bin/env bun
/**
 * Build a static operator review page for corpus recreation POC artifacts.
 *
 * Review-only: reads ignored local output artifacts, writes one HTML file, and
 * does not call an LLM, mutate plans, create proposals, or add blockers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  buildRunManifest,
  existingArtifactRefs,
  manifestPathForSidecar,
  parentManifestForPocDir,
  readRunManifestIfExists,
  type RunManifest,
  writeRunManifest,
} from "./run-manifest"
import type { CorpusThreadMapReport } from "./corpus-recreation-thread-map"
import type { CorpusThreadContextReport } from "./corpus-recreation-thread-context"
import { corpusRecreationVariantLabel } from "./corpus-recreation-variant"

interface Args {
  pocDirs: string[]
  output: string | null
}

interface ReviewReport {
  generatedAt: string
  runs: ReviewRun[]
}

interface ReviewRun {
  pocDir: string
  sourceBook: string
  chapterLabel: string
  plannerVariant: string
  writerContextMode: string
  variantLabel: string
  generatedAt: string
  target: any
  plan: any
  planComparison: any
  chapter: any | null
  chapterComparison: any | null
  semanticReview: any | null
  proseQualityReview: any | null
  runManifest: RunManifest | null
  threadMap: CorpusThreadMapReport | null
  threadContext: CorpusThreadContextReport | null
  writerContext: any | null
  scenes: ReviewScene[]
}

interface ReviewScene {
  sceneId: string
  sceneIndex: number
  referenceShape: any | null
  planScene: any
  obligations: any[]
  planContract: any | null
  prose: string
  sceneWordCount: any | null
  semanticResults: any[]
  proseQualityResults: any[]
}

export function buildCorpusRecreationReview(
  pocDirs: string[],
  generatedAt = new Date().toISOString(),
): ReviewReport {
  if (pocDirs.length === 0) throw new Error("at least one --poc-dir or positional POC directory is required")
  return {
    generatedAt,
    runs: pocDirs.map(readReviewRun),
  }
}

export function renderCorpusRecreationReviewHtml(report: ReviewReport): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Corpus Recreation Review</title>
  <style>${CSS}</style>
</head>
<body>
  <main>
    <header class="page-header">
      <div>
        <h1>Corpus Recreation Review</h1>
        <p class="muted">Generated ${escapeHtml(report.generatedAt)}. Static local artifact; no LLM calls, mutations, proposal creation, or promotion decisions.</p>
      </div>
      <div class="legend">
        <span><strong>Reference shape</strong> = reconstructed structural signals</span>
        <span><strong>Plan contract</strong> = generated scene obligations</span>
        <span><strong>Prose</strong> = generated chapter output</span>
        <span><strong>Review</strong> = deterministic warnings + semantic findings</span>
      </div>
    </header>
    ${report.runs.length > 1 ? renderComparison(report.runs) : ""}
    ${report.runs.map(renderRun).join("\n")}
  </main>
</body>
</html>
`
}

function readReviewRun(pocDir: string): ReviewRun {
  const resolved = resolve(process.cwd(), pocDir)
  const packet = readJson(join(resolved, "packet.json"))
  const plan = readJson(join(resolved, "plan.json"))
  const planComparison = readOptionalJson(join(resolved, "plan-comparison.json")) ?? {}
  const chapter = readOptionalJson(join(resolved, "chapter.json"))
  const chapterComparison = readOptionalJson(join(resolved, "chapter-comparison.json"))
  const semanticReview = readFirstOptionalJson([
    join(resolved, "semantic-review", "semantic-review.json"),
    join(resolved, "semantic-review-live", "semantic-review.json"),
  ])
  const proseQualityReview = readOptionalJson(join(resolved, "prose-quality-live", "prose-review.json"))
  const runManifest = readRunManifestIfExists(join(resolved, "run-manifest.json"))
  const threadMap = readOptionalJson(join(resolved, "thread-map.json")) as CorpusThreadMapReport | null
  const threadContext = readOptionalJson(join(resolved, "thread-context.json")) as CorpusThreadContextReport | null
  const writerContext = readOptionalJson(join(resolved, "writer-context.json"))
  const target = packet.target ?? {}
  const diagnosticConfig = packet.diagnosticConfig ?? {}
  const sourceReference = packet.sourceReference ?? {}
  const targetBlueprints = Array.isArray(target.sceneBlueprints) ? target.sceneBlueprints : []
  const planScenes = Array.isArray(plan.scenes) ? plan.scenes : []
  const obligations = Array.isArray(plan.obligations) ? plan.obligations : []
  const chapterScenes = Array.isArray(chapter?.scenes) ? chapter.scenes : []
  const semanticResults = Array.isArray(semanticReview?.results) ? semanticReview.results : []
  const proseQualityResults = Array.isArray(proseQualityReview?.results) ? proseQualityReview.results : []
  const contractScenes = Array.isArray(planComparison.sceneContract?.scenes) ? planComparison.sceneContract.scenes : []
  const sceneWordCounts = Array.isArray(chapterComparison?.sceneWordCounts) ? chapterComparison.sceneWordCounts : []

  const scenes = planScenes.map((scene: any, sceneIndex: number) => {
    const referenceOrdinal = Number(scene.referenceSceneOrdinal ?? sceneIndex)
    return {
      sceneId: String(scene.sceneId ?? `scene-${sceneIndex + 1}`),
      sceneIndex,
      referenceShape: targetBlueprints.find((row: any) => Number(row.referenceSceneOrdinal) === referenceOrdinal) ?? targetBlueprints[sceneIndex] ?? null,
      planScene: scene,
      obligations: obligations.filter((row: any) => row?.sceneId === scene.sceneId),
      planContract: contractScenes.find((row: any) => row?.sceneId === scene.sceneId) ?? null,
      prose: String(chapterScenes.find((row: any) => row?.sceneId === scene.sceneId)?.prose ?? ""),
      sceneWordCount: sceneWordCounts.find((row: any) => row?.sceneId === scene.sceneId) ?? null,
      semanticResults: semanticResults.filter((row: any) => row?.sceneId === scene.sceneId),
      proseQualityResults: proseQualityResults.filter((row: any) => row?.sceneId === scene.sceneId),
    }
  })

  return {
    pocDir: resolved,
    sourceBook: String(sourceReference.book ?? ""),
    chapterLabel: String(sourceReference.chapterLabel ?? target.chapterLabel ?? ""),
    plannerVariant: String(diagnosticConfig.plannerVariant ?? "baseline"),
    writerContextMode: String(diagnosticConfig.writerContextMode ?? "baseline"),
    variantLabel: corpusRecreationVariantLabel(diagnosticConfig),
    generatedAt: String(packet.generatedAt ?? ""),
    target,
    plan,
    planComparison,
    chapter,
    chapterComparison,
    semanticReview,
    proseQualityReview,
    runManifest,
    threadMap,
    threadContext,
    writerContext,
    scenes,
  }
}

function renderComparison(runs: ReviewRun[]): string {
  const keys = comparisonSceneKeys(runs)
  return `<section class="comparison">
    <div class="run-heading">
      <div>
        <h2>Side-By-Side Variant Comparison</h2>
        <p class="muted">Scene-index aligned comparison for choosing which plan/prose variant is stronger. This section is display-only.</p>
      </div>
      <div class="badges">
        ${badge("runs", String(runs.length))}
        ${badge("scenes", String(keys.length))}
      </div>
    </div>
    ${keys.map(key => renderComparisonScene(key, runs)).join("\n")}
  </section>`
}

function comparisonSceneKeys(runs: ReviewRun[]): string[] {
  const keys = new Set<string>()
  for (const run of runs) {
    for (const scene of run.scenes) {
      keys.add(comparisonSceneKey(run, scene.sceneIndex))
    }
  }
  return [...keys].sort(compareSceneKeys)
}

function comparisonSceneKey(run: ReviewRun, sceneIndex: number): string {
  return `${run.sourceBook}\t${run.chapterLabel}\t${sceneIndex}`
}

function compareSceneKeys(a: string, b: string): number {
  const [aBook = "", aChapter = "", aScene = "0"] = a.split("\t")
  const [bBook = "", bChapter = "", bScene = "0"] = b.split("\t")
  return aBook.localeCompare(bBook)
    || compareMaybeNumber(aChapter, bChapter)
    || Number(aScene) - Number(bScene)
}

function compareMaybeNumber(a: string, b: string): number {
  const aNumber = Number(a)
  const bNumber = Number(b)
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber
  return a.localeCompare(b)
}

function renderComparisonScene(key: string, runs: ReviewRun[]): string {
  const [book = "", chapterLabel = "", sceneIndexRaw = "0"] = key.split("\t")
  const sceneIndex = Number(sceneIndexRaw)
  const firstScene = runs
    .map(run => run.scenes.find(scene => comparisonSceneKey(run, scene.sceneIndex) === key))
    .find((scene): scene is ReviewScene => Boolean(scene))
  return `<section class="comparison-scene">
    <div class="scene-header">
      <h3>${escapeHtml(book || "unknown")} chapter ${escapeHtml(chapterLabel || "?")} scene ${sceneIndex + 1}</h3>
      <div class="badges">${firstScene ? badge("reference beats", numberOrDash(firstScene.referenceShape?.targetBeatCount)) : ""}</div>
    </div>
    ${firstScene ? `<div class="comparison-reference">${renderReferenceShapeBrief(firstScene.referenceShape)}</div>` : ""}
    <div class="comparison-grid">
      ${runs.map(run => renderComparisonCard(run, run.scenes.find(scene => comparisonSceneKey(run, scene.sceneIndex) === key) ?? null)).join("\n")}
    </div>
  </section>`
}

function renderComparisonCard(run: ReviewRun, scene: ReviewScene | null): string {
  if (!scene) {
    return `<article class="comparison-card">
      <h4>${escapeHtml(runLabel(run))}</h4>
      <p class="muted">No aligned scene in this run.</p>
    </article>`
  }
  const lows = scene.semanticResults.filter(result => Number(result.ordinal ?? 0) <= 1)
  const proseAttention = scene.proseQualityResults.filter(isProseAttention)
  return `<article class="comparison-card">
    <div class="comparison-card-header">
      <h4>${escapeHtml(runLabel(run))}</h4>
      <div class="badges">
        ${scene.sceneWordCount ? badge("words", `${scene.sceneWordCount.actual}/${scene.sceneWordCount.target}`, scene.sceneWordCount.meetsMinimum === false ? "warn" : "ok") : ""}
        ${badge("lows", String(lows.length), lows.length ? "warn" : "ok")}
        ${badge("prose review", String(proseAttention.length), proseAttention.length ? "warn" : "ok")}
      </div>
    </div>
    <div class="compare-block">
      <h5>Plan</h5>
      ${metric("Role", scene.planScene.structuralRole)}
      ${metric("Choice", scene.planScene.crisisChoice)}
      ${metric("Outcome", scene.planScene.outcome)}
      ${metric("Consequence", scene.planScene.consequence)}
      ${listBlock("Obligations", scene.obligations.map(formatObligation))}
      ${listBlock("Contract Issues", arrayOfStrings(scene.planContract?.issues))}
    </div>
    <div class="compare-block prose-compare">
      <h5>Prose</h5>
      ${scene.prose ? renderParagraphs(scene.prose) : `<p class="muted">No prose found.</p>`}
    </div>
    <div class="compare-block">
      <h5>AI Pre-Review</h5>
      ${renderProseQuality(scene)}
    </div>
    <div class="compare-block">
      <h5>Semantic Review</h5>
      ${renderReview(scene)}
    </div>
  </article>`
}

function renderReferenceShapeBrief(shape: any | null): string {
  if (!shape) return `<p class="muted">No reference shape found.</p>`
  return `<div class="brief-grid">
    ${metric("Target Words", numberOrDash(shape.targetWords))}
    ${metric("Annotation Beats", numberOrDash(shape.targetBeatCount))}
    ${metric("Polarity", String(shape.polarity ?? "unknown"))}
    ${metric("MICE", String(shape.micePrimaryThread ?? "unknown"))}
    ${metric("Beat Kinds", compactCounts(shape.beatKindCounts))}
    ${metric("Gaps", compactCounts(shape.gapSizeCounts))}
  </div>`
}

function runLabel(run: ReviewRun): string {
  const dir = run.pocDir.split(/[\\/]/u).filter(Boolean).at(-1) ?? run.variantLabel
  return `${run.variantLabel} - ${dir}`
}

function renderRun(run: ReviewRun): string {
  const semanticLowCount = run.scenes.reduce(
    (sum, scene) => sum + scene.semanticResults.filter(result => Number(result.ordinal ?? 0) <= 1).length,
    0,
  )
  const proseReviewCount = run.scenes.reduce(
    (sum, scene) => sum + scene.proseQualityResults.filter(isProseAttention).length,
    0,
  )
  return `<section class="run">
    <div class="run-heading">
      <div>
        <h2>${escapeHtml(run.sourceBook || "unknown")} chapter ${escapeHtml(run.chapterLabel || "?")}</h2>
        <p class="muted">${escapeHtml(run.pocDir)}</p>
      </div>
      <div class="badges">
        ${badge("variant", run.variantLabel)}
        ${run.runManifest ? badge("run", shortRunId(run.runManifest.runId)) : badge("run", "missing", "warn")}
        ${run.threadMap ? badge("thread map", `${run.threadMap.rowCount} rows`, run.threadMap.issueCount > 0 ? "warn" : "ok") : badge("thread map", "missing", "warn")}
        ${run.threadContext ? badge("thread context", `${run.threadContext.contextCount} scenes`, run.threadContext.issueCount > 0 ? "warn" : "ok") : badge("thread context", "missing", "warn")}
        ${badge("target", `${numberOrDash(run.target?.targetWords)} words`)}
        ${badge("scenes", `${run.scenes.length}/${numberOrDash(run.target?.sceneCount)}`)}
        ${badge("semantic lows", String(semanticLowCount), semanticLowCount > 0 ? "warn" : "ok")}
        ${badge("prose review", String(proseReviewCount), proseReviewCount > 0 ? "warn" : "ok")}
      </div>
    </div>
    ${renderRunSummary(run)}
    ${renderRunProvenance(run)}
    <section class="method-note">
      <h3>What Was Reconstructed From Existing Novel Analysis</h3>
      <p>Only structural signals are used here: scene count, scene word size, annotation beat count, value polarity, MICE/thread cadence, beat kind counts, boundary-signal counts, gap-size counts, and optional private structural summaries when the reference was generated with summaries. This page is for review; it does not treat structural similarity as source leakage.</p>
    </section>
    ${run.scenes.map(scene => renderScene(scene)).join("\n")}
  </section>`
}

function renderRunProvenance(run: ReviewRun): string {
  return `<section class="provenance-grid">
    <article>
      <h3>Run Provenance</h3>
      ${run.runManifest ? renderManifest(run.runManifest) : `<p class="muted">No run-manifest.json found in this POC directory.</p>`}
    </article>
    <article>
      <h3>Thread Map</h3>
      ${run.threadMap ? renderThreadMap(run.threadMap) : `<p class="muted">No thread-map.json found. Run diagnostics:corpus-recreation-thread-map for this POC directory to add deterministic thread movement evidence.</p>`}
    </article>
    <article>
      <h3>Thread Context Preview</h3>
      ${run.threadContext ? renderThreadContext(run.threadContext) : `<p class="muted">No thread-context.json found. Run diagnostics:corpus-recreation-thread-context for this POC directory to preview compact scene writer context.</p>`}
    </article>
    <article>
      <h3>Writer Context Used</h3>
      ${run.writerContext ? renderWriterContext(run.writerContext) : `<p class="muted">No writer-context.json found. This run either used baseline writer context or predates the opt-in writer-context evidence artifact.</p>`}
    </article>
  </section>`
}

function renderManifest(manifest: RunManifest): string {
  return `${metric("Run ID", manifest.runId)}
    ${metric("Root Run", manifest.rootRunId)}
    ${metric("Parent Run", manifest.parentRunId ?? "none")}
    ${metric("Phase", manifest.phase)}
    ${metric("Variant", manifest.variantId)}
    ${metric("Command", `${manifest.command.name} ${manifest.command.argv.join(" ")}`.trim())}
    ${metric("Inputs", String(manifest.inputs.length))}
    ${metric("Outputs", String(manifest.outputs.length))}`
}

function renderThreadMap(threadMap: CorpusThreadMapReport): string {
  const scenes = Array.isArray(threadMap.scenes) ? threadMap.scenes : []
  const impacts = Array.isArray(threadMap.impacts) ? threadMap.impacts : []
  const issues = Array.isArray(threadMap.issues) ? threadMap.issues : []
  return `<div class="thread-map">
    ${metric("Rows", numberOrDash(threadMap.rowCount))}
    ${metric("Issues", numberOrDash(threadMap.issueCount))}
    <div class="mini-table-wrap">
      <table class="mini-table">
        <thead><tr><th>Scene</th><th>Threads</th><th>Promises</th><th>Payoffs</th><th>Issues</th></tr></thead>
        <tbody>
          ${scenes.map(scene => `<tr>
            <td>${escapeHtml(scene.sceneId)}</td>
            <td>${escapeHtml(scene.threadIds.join(", ") || "none")}</td>
            <td>${escapeHtml(scene.promiseIds.join(", ") || "none")}</td>
            <td>${escapeHtml(scene.payoffIds.join(", ") || "none")}</td>
            <td>${escapeHtml(String(scene.issueCount))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${impacts.length ? `<details><summary>Impact Preview (${impacts.length})</summary>${unorderedList(impacts.map(impact => `${impact.refKind}:${impact.ref} -> scenes ${impact.affectedSceneIds.join(", ") || "none"}`))}</details>` : ""}
    ${issues.length ? `<details><summary>Thread Issues (${issues.length})</summary>${unorderedList(issues.map(issue => `${issue.code} ${issue.ref}: ${issue.detail}`))}</details>` : ""}
  </div>`
}

function renderThreadContext(threadContext: CorpusThreadContextReport): string {
  const contexts = Array.isArray(threadContext.contexts) ? threadContext.contexts : []
  return `<div class="thread-context">
    ${metric("Packets", numberOrDash(threadContext.contextCount))}
    ${metric("Issues", numberOrDash(threadContext.issueCount))}
    <div class="mini-table-wrap">
      <table class="mini-table">
        <thead><tr><th>Scene</th><th>Threads</th><th>Promises</th><th>Payoffs</th><th>Prior</th><th>Future</th></tr></thead>
        <tbody>
          ${contexts.map(context => `<tr>
            <td>${escapeHtml(context.sceneId)}</td>
            <td>${escapeHtml(context.activeThreadIds.join(", ") || "none")}</td>
            <td>${escapeHtml(context.activePromiseIds.join(", ") || "none")}</td>
            <td>${escapeHtml(context.activePayoffIds.join(", ") || "none")}</td>
            <td>${escapeHtml(String(context.priorMovements.length))}</td>
            <td>${escapeHtml(String(context.futureImpactPreview.length))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <details><summary>Context Responsibilities</summary>
      ${unorderedList(contexts.flatMap(context => context.currentResponsibilities.map(item => `${context.sceneId}: ${item}`)))}
    </details>
  </div>`
}

function renderWriterContext(writerContext: any): string {
  const contexts = Array.isArray(writerContext?.contexts) ? writerContext.contexts : []
  return `<div class="thread-context">
    ${metric("Mode", String(writerContext?.mode ?? "unknown"))}
    ${metric("Packets", numberOrDash(writerContext?.sceneCount ?? contexts.length))}
    <div class="mini-table-wrap">
      <table class="mini-table">
        <thead><tr><th>Scene</th><th>Threads</th><th>Promises</th><th>Payoffs</th><th>Responsibilities</th><th>Future</th></tr></thead>
        <tbody>
          ${contexts.map((context: any) => `<tr>
            <td>${escapeHtml(String(context.sceneId ?? ""))}</td>
            <td>${escapeHtml((context.activeThreads ?? []).map((row: any) => row.threadId).filter(Boolean).join(", ") || "none")}</td>
            <td>${escapeHtml((context.activePromises ?? []).map((row: any) => row.promiseId).filter(Boolean).join(", ") || "none")}</td>
            <td>${escapeHtml((context.activePayoffs ?? []).map((row: any) => row.payoffId).filter(Boolean).join(", ") || "none")}</td>
            <td>${escapeHtml(String((context.currentResponsibilities ?? []).length))}</td>
            <td>${escapeHtml(String((context.futureImpactPreview ?? []).length))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <details><summary>Prompt Responsibilities</summary>
      ${unorderedList(contexts.flatMap((context: any) => (context.currentResponsibilities ?? []).map((item: any) => `${context.sceneId}: ${item.obligationId} ${item.requirementText}`)))}
    </details>
  </div>`
}

function renderRunSummary(run: ReviewRun): string {
  const planIssues = arrayOfStrings(run.planComparison?.issues)
  const chapterIssues = arrayOfStrings(run.chapterComparison?.issues)
  const chapterWarnings = arrayOfStrings(run.chapterComparison?.warnings)
  const forbidden = arrayOfStrings(run.chapterComparison?.sourceBoundary?.forbiddenTermsPresent)
  const wordCount = run.chapterComparison?.wordCount
  return `<section class="summary-grid">
    <div>
      <h3>Plan Fit</h3>
      ${metric("Polarity", sequenceFit(run.planComparison?.valuePolarity))}
      ${metric("MICE", sequenceFit(run.planComparison?.miceThread))}
      ${metric("Beat Hints", beatHintFit(run.planComparison?.beatHintShape))}
      ${listBlock("Plan Issues", planIssues)}
    </div>
    <div>
      <h3>Chapter Fit</h3>
      ${metric("Words", wordCount ? `${wordCount.actual}/${wordCount.target} (${formatNumber(wordCount.ratio)})` : "not written")}
      ${metric("Source Terms", forbidden.length ? forbidden.join(", ") : "none")}
      ${listBlock("Chapter Issues", chapterIssues)}
      ${listBlock("Warnings", chapterWarnings)}
    </div>
  </section>`
}

function renderScene(scene: ReviewScene): string {
  const lows = scene.semanticResults.filter(result => Number(result.ordinal ?? 0) <= 1)
  const proseAttention = scene.proseQualityResults.filter(isProseAttention)
  return `<section class="scene">
    <div class="scene-header">
      <h3>Scene ${scene.sceneIndex + 1}: ${escapeHtml(scene.sceneId)}</h3>
      <div class="badges">
        ${scene.sceneWordCount ? badge("words", `${scene.sceneWordCount.actual}/${scene.sceneWordCount.target}`, scene.sceneWordCount.meetsMinimum === false ? "warn" : "ok") : ""}
        ${badge("semantic", lows.length ? `${lows.length} low` : `${scene.semanticResults.length} reviewed`, lows.length ? "warn" : "ok")}
        ${badge("prose", proseAttention.length ? `${proseAttention.length} review` : `${scene.proseQualityResults.length} reviewed`, proseAttention.length ? "warn" : "ok")}
      </div>
    </div>
    <div class="scene-grid">
      <article>
        <h4>Reference Shape</h4>
        ${renderReferenceShape(scene.referenceShape)}
      </article>
      <article>
        <h4>Plan Contract</h4>
        ${renderPlanContract(scene)}
      </article>
      <article class="prose-column">
        <h4>Prose</h4>
        ${scene.prose ? renderParagraphs(scene.prose) : `<p class="muted">No chapter prose found for this scene.</p>`}
      </article>
      <article>
        <h4>Review</h4>
        ${renderProseQuality(scene)}
        ${renderReview(scene)}
      </article>
    </div>
  </section>`
}

function renderReferenceShape(shape: any | null): string {
  if (!shape) return `<p class="muted">No reference shape found.</p>`
  const beatHints = Array.isArray(shape.beatPurposeHints) ? shape.beatPurposeHints : []
  return `${metric("Target Words", numberOrDash(shape.targetWords))}
    ${metric("Annotation Beats", numberOrDash(shape.targetBeatCount))}
    ${metric("Polarity", String(shape.polarity ?? "unknown"))}
    ${metric("MICE", String(shape.micePrimaryThread ?? "unknown"))}
    ${metric("Beat Kinds", compactCounts(shape.beatKindCounts))}
    ${metric("Boundaries", compactCounts(shape.boundarySignalCounts))}
    ${metric("Gaps", compactCounts(shape.gapSizeCounts))}
    ${shape.sourceStructuralDigest ? `<details><summary>Private structural digest</summary><p>${escapeHtml(shape.sourceStructuralDigest)}</p></details>` : ""}
    ${beatHints.length ? `<details><summary>Beat purpose hints (${beatHints.length})</summary>${orderedList(beatHints)}</details>` : ""}`
}

function renderPlanContract(scene: ReviewScene): string {
  const plan = scene.planScene
  const contractIssues = arrayOfStrings(scene.planContract?.issues)
  return `${metric("Role", plan.structuralRole)}
    ${metric("Goal", plan.goal)}
    ${metric("Opposition", plan.opposition)}
    ${metric("Turn", plan.turningPoint)}
    ${metric("Choice", plan.crisisChoice)}
    ${listBlock("Alternatives", arrayOfStrings(plan.choiceAlternatives))}
    ${metric("Outcome", plan.outcome)}
    ${metric("Consequence", plan.consequence)}
    ${listBlock("Obligations", scene.obligations.map(formatObligation))}
    ${listBlock("Contract Issues", contractIssues)}`
}

function renderReview(scene: ReviewScene): string {
  if (scene.semanticResults.length === 0) {
    return `<p class="muted">No semantic review found for this scene.</p>`
  }
  return scene.semanticResults
    .map(result => {
      const low = Number(result.ordinal ?? 0) <= 1
      return `<div class="finding ${low ? "low" : ""}">
        <div class="finding-title">
          <span>${escapeHtml(String(result.dimension ?? ""))}</span>
          ${badge(String(result.label ?? "unknown"), formatNumber(result.confidence), low ? "warn" : "ok")}
        </div>
        ${result.missingForNextLevel ? `<p>${escapeHtml(String(result.missingForNextLevel))}</p>` : `<p class="muted">No missing-for-next-level note.</p>`}
      </div>`
    })
    .join("\n")
}

function renderProseQuality(scene: ReviewScene): string {
  if (scene.proseQualityResults.length === 0) {
    return `<p class="muted">No AI prose pre-review found for this scene.</p>`
  }
  return `<div class="prose-quality">
    ${scene.proseQualityResults.map(result => {
      const review = isProseAttention(result)
      return `<div class="finding ${review ? "low" : ""}">
        <div class="finding-title">
          <span>${escapeHtml(String(result.dimension ?? ""))}</span>
          ${badge(String(result.label ?? "unknown"), String(result.attention ?? "skip"), review ? "warn" : "ok")}
        </div>
        ${result.output?.weakness ? `<p>${escapeHtml(String(result.output.weakness))}</p>` : ""}
        ${result.output?.missingForNextLevel ? `<p class="muted">${escapeHtml(String(result.output.missingForNextLevel))}</p>` : ""}
      </div>`
    }).join("\n")}
  </div>`
}

function isProseAttention(result: any): boolean {
  return result?.attention === "review" || Number(result?.ordinal ?? 0) <= 1
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const pocDirs: string[] = []
  let output: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--poc-dir") {
      const value = argv[index + 1]
      if (!value) throw new Error("--poc-dir requires a path")
      pocDirs.push(value)
      index += 1
    } else if (arg === "--output") {
      const value = argv[index + 1]
      if (!value) throw new Error("--output requires a path")
      output = value
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown arg: ${arg}`)
    } else {
      pocDirs.push(arg)
    }
  }
  return { pocDirs, output }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-review.ts --poc-dir <dir> [--poc-dir <dir> ...]
  bun scripts/evals/corpus-recreation-review.ts <dir> --output output/review.html
`)
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"))
}

function readOptionalJson(path: string): any | null {
  if (!existsSync(path)) return null
  return readJson(path)
}

function readFirstOptionalJson(paths: string[]): any | null {
  for (const path of paths) {
    const value = readOptionalJson(path)
    if (value != null) return value
  }
  return null
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function defaultOutputPath(pocDirs: string[]): string {
  if (pocDirs.length === 1) return join(pocDirs[0]!, "review.html")
  return "output/corpus-recreation-poc/review.html"
}

function metric(label: string, value: unknown): string {
  return `<dl class="metric"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value ?? "none"))}</dd></dl>`
}

function listBlock(label: string, values: string[]): string {
  if (values.length === 0) return metric(label, "none")
  return `<div class="list-block"><div class="list-label">${escapeHtml(label)}</div>${unorderedList(values)}</div>`
}

function orderedList(values: unknown[]): string {
  return `<ol>${values.map(value => `<li>${escapeHtml(String(value))}</li>`).join("")}</ol>`
}

function unorderedList(values: unknown[]): string {
  return `<ul>${values.map(value => `<li>${escapeHtml(String(value))}</li>`).join("")}</ul>`
}

function renderParagraphs(prose: string): string {
  return prose
    .split(/\n{2,}/u)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n")
}

function badge(label: string, value: string, kind = ""): string {
  return `<span class="badge ${escapeAttr(kind)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></span>`
}

function formatObligation(obligation: any): string {
  const pieces = [
    obligation.obligationId,
    obligation.sourceId ? `[${obligation.sourceId}]` : "",
    obligation.threadId ? `{thread:${obligation.threadId}}` : "",
    obligation.promiseId ? `{promise:${obligation.promiseId}}` : "",
    obligation.payoffId ? `{payoff:${obligation.payoffId}}` : "",
    obligation.requirementText,
    obligation.materialityTest ? `Materiality: ${obligation.materialityTest}` : "",
  ].filter(Boolean)
  return pieces.join(" ")
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(row => String(row)) : []
}

function sequenceFit(value: any): string {
  if (!value) return "not available"
  return `${numberOrDash(value.exactMatches)}/${Array.isArray(value.expected) ? value.expected.length : "?"} (${formatNumber(value.ratio)})`
}

function beatHintFit(value: any): string {
  if (!value) return "not available"
  return `${numberOrDash(value.actualTotal)}/${numberOrDash(value.expectedTotal)} (${formatNumber(value.ratio)})`
}

function compactCounts(value: unknown): string {
  if (!value || typeof value !== "object") return "none"
  const entries = Object.entries(value as Record<string, unknown>)
    .sort((a, b) => Number(b[1] ?? 0) - Number(a[1] ?? 0) || a[0].localeCompare(b[0]))
  return entries.length ? entries.map(([key, count]) => `${key}:${count}`).join(", ") : "none"
}

function numberOrDash(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-"
}

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "-"
}

function shortRunId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 7)}...${value.slice(-6)}` : value
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function escapeAttr(value: string): string {
  return value.replace(/[^a-z0-9_-]/giu, "")
}

const CSS = `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f3ee;
  color: #1e2428;
}
body { margin: 0; }
main { max-width: 1780px; margin: 0 auto; padding: 28px; }
h1, h2, h3, h4 { margin: 0; letter-spacing: 0; }
h5 { margin: 0 0 8px; font-size: 13px; letter-spacing: 0; text-transform: uppercase; color: #596166; }
p { line-height: 1.58; }
.page-header, .run-heading, .scene-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}
.page-header { margin-bottom: 26px; }
.legend, .badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.legend span, .badge {
  border: 1px solid #cfc6ba;
  background: #fffdf9;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
}
.badge { display: inline-flex; gap: 6px; align-items: center; }
.badge.ok { border-color: #8ab39a; background: #edf7ef; }
.badge.warn { border-color: #d4a044; background: #fff5d7; }
.muted { color: #697176; }
.run { margin: 0 0 28px; }
.summary-grid, .scene-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.summary-grid, .provenance-grid { margin: 18px 0; }
.provenance-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.7fr) minmax(360px, 1fr) minmax(360px, 1fr);
  gap: 12px;
}
.summary-grid > div, .provenance-grid article, .method-note, .scene article, .comparison-card, .comparison-reference {
  border: 1px solid #d8d0c5;
  background: #fffdf9;
  border-radius: 8px;
  padding: 14px;
}
.method-note { margin-bottom: 18px; }
.comparison {
  margin: 0 0 34px;
  border-bottom: 2px solid #d8d0c5;
  padding-bottom: 24px;
}
.comparison-scene { margin: 18px 0 28px; }
.comparison-reference { margin: 10px 0; }
.comparison-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 12px;
  align-items: start;
}
.comparison-card-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}
.compare-block {
  border-top: 1px solid #e4ddd5;
  padding-top: 12px;
  margin-top: 12px;
}
.compare-block:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.prose-compare {
  max-height: 430px;
  overflow: auto;
}
.brief-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 4px 12px;
}
.mini-table-wrap { overflow-x: auto; }
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.mini-table th, .mini-table td {
  border-top: 1px solid #e4ddd5;
  padding: 7px 6px;
  text-align: left;
  vertical-align: top;
}
.mini-table th {
  color: #596166;
  font-size: 12px;
  text-transform: uppercase;
}
.scene { margin: 18px 0 28px; }
.scene-grid {
  grid-template-columns: minmax(220px, 0.9fr) minmax(300px, 1.05fr) minmax(420px, 1.45fr) minmax(260px, 0.9fr);
  margin-top: 10px;
}
.prose-column { max-height: 760px; overflow: auto; }
.metric {
  margin: 10px 0;
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 8px;
}
.metric dt, .list-label { color: #596166; font-weight: 700; font-size: 12px; text-transform: uppercase; }
.metric dd { margin: 0; overflow-wrap: anywhere; }
ul, ol { padding-left: 20px; }
li { margin: 6px 0; }
details { margin: 12px 0; }
summary { cursor: pointer; font-weight: 700; color: #344047; }
.finding { border-top: 1px solid #e4ddd5; padding-top: 10px; margin-top: 10px; }
.finding:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.finding.low { border-left: 4px solid #c47d28; padding-left: 10px; }
.finding-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
@media (max-width: 1100px) {
  main { padding: 18px; }
  .page-header, .run-heading, .scene-header, .comparison-card-header { display: block; }
  .summary-grid, .provenance-grid, .scene-grid, .comparison-grid { grid-template-columns: 1fr; }
}
`

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildCorpusRecreationReview(args.pocDirs)
    const output = args.output ?? defaultOutputPath(args.pocDirs)
    writeOutput(output, renderCorpusRecreationReviewHtml(report))
    writeManifest(output, args, report)
    console.log(`wrote ${resolve(process.cwd(), output)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function writeManifest(output: string, args: Args, report: ReviewReport): void {
  const parentManifests = args.pocDirs
    .map(dir => parentManifestForPocDir(dir))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
  writeRunManifest(manifestPathForSidecar(output), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-review",
    variantId: report.runs.length > 1 ? "comparison" : report.runs[0]?.variantLabel ?? "review",
    parentRunId: parentManifests.length === 1 ? parentManifests[0]!.runId : null,
    rootRunId: parentManifests.length === 1 ? parentManifests[0]!.rootRunId : null,
    command: {
      name: "diagnostics:corpus-recreation-review",
      argv: process.argv.slice(2),
    },
    inputs: reviewInputRefs(args.pocDirs),
    outputs: existingArtifactRefs([{ path: output, role: "review-html" }]),
    relatedRunIds: parentManifests.map(manifest => manifest.runId),
    discriminator: report.runs.map(run => run.variantLabel).join("-vs-") || "review",
    metadata: {
      pocDirs: args.pocDirs,
      runCount: report.runs.length,
      sceneCount: report.runs.reduce((sum, run) => sum + run.scenes.length, 0),
    },
  }))
}

function reviewInputRefs(pocDirs: string[]) {
  return pocDirs.flatMap(dir => {
    const resolved = resolve(dir)
    return existingArtifactRefs([
      { path: join(resolved, "run-manifest.json"), role: "parent-run-manifest" },
      { path: join(resolved, "packet.json"), role: "packet" },
      { path: join(resolved, "plan.json"), role: "plan" },
      { path: join(resolved, "plan-comparison.json"), role: "plan-comparison" },
      { path: join(resolved, "chapter.json"), role: "chapter-json" },
      { path: join(resolved, "chapter-comparison.json"), role: "chapter-comparison" },
      { path: join(resolved, "thread-map.json"), role: "thread-map-json" },
      { path: join(resolved, "thread-context.json"), role: "thread-context-json" },
      { path: join(resolved, "writer-context.json"), role: "writer-context-json" },
      { path: join(resolved, "semantic-review", "semantic-review.json"), role: "semantic-review-json" },
      { path: join(resolved, "semantic-review-live", "semantic-review.json"), role: "semantic-review-json" },
      { path: join(resolved, "prose-quality-live", "prose-review.json"), role: "prose-review-json" },
    ])
  })
}
