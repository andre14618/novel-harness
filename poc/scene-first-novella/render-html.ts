/**
 * Scene-first novella POC — static HTML review page.
 *
 * Reads chapter-N.{md,scene-contracts.json,trace.json,diagnostics.json}
 * from poc/scene-first-novella/output/<runId>/ and emits a single
 * index.html under the same dir. Vanilla TS template literal — no
 * React, no build step, no Playwright. Open the file with a browser.
 *
 * The page is operator review surface, not production UI. Style is
 * intentionally minimal; substance is the side-by-side per-scene
 * layout: planner contract + obligations + prose span + post-hoc
 * diagnostics + traceability IDs.
 *
 * Usage:
 *   bun poc/scene-first-novella/render-html.ts \
 *     --run-dir poc/scene-first-novella/output/poc-scene-first-<ts>
 */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"

interface Args { runDir: string }

function parseArgs(argv: string[]): Args {
  let runDir: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--run-dir") { runDir = argv[++i] ?? null; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!runDir) throw new Error("--run-dir <path> is required")
  return { runDir }
}

interface ChapterBundle {
  chapterNumber: number
  prose: string
  contracts: any
  trace: any | null
  diagnostics: any | null
}

interface ReviewStats {
  totalScenes: number
  anyContractFieldScenes: number
  coreContractFieldScenes: number
  choiceAlternativeScenes: number
  choiceAlternativeCount: number
  sceneContractPayloadChars: number
  sceneIds: number
  beatIds: number
  obligationIds: number
  sourceIds: number
  characterIds: number
  threadIds: number
  promiseIds: number
  payoffIds: number
  obligationTypeCounts: ObligationTypeCounts
  proseWords: number
  targetWords: number
}

interface ObligationTypeCounts {
  mustEstablish: number
  mustPayOff: number
  mustTransferKnowledge: number
  mustShowStateChange: number
  mustNotReveal: number
  allowedNewEntities: number
  loadBearing: number
}

interface DiagnosticStats {
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

interface RuntimeStats {
  traceEvents: number
  llmCalls: number
  writerCalls: number
  writerExpansionEvents: number
}

interface ReviewSummary {
  runId: string
  profile: string | null
  fixturePath: string | null
  chaptersRendered: number
  chaptersRequested: number | null
  reviewStats: ReviewStats
  diagnosticStats: DiagnosticStats
  runtimeStats: RuntimeStats
  findings: string[]
}

async function loadChapter(runDir: string, ch: number): Promise<ChapterBundle | null> {
  const proseFile = Bun.file(join(runDir, `chapter-${ch}.md`))
  const contractFile = Bun.file(join(runDir, `chapter-${ch}.scene-contracts.json`))
  if (!await proseFile.exists() || !await contractFile.exists()) return null
  const prose = await proseFile.text()
  const contracts = await contractFile.json()
  const traceFile = Bun.file(join(runDir, `chapter-${ch}.trace.json`))
  const diagFile = Bun.file(join(runDir, `chapter-${ch}.diagnostics.json`))
  const trace = await traceFile.exists() ? await traceFile.json() : null
  const diagnostics = await diagFile.exists() ? await diagFile.json() : null
  return { chapterNumber: ch, prose, contracts, trace, diagnostics }
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function paragraphs(prose: string): string {
  // Strip the markdown header block first, then convert to <p> blocks.
  const stripped = prose.replace(/^# Chapter [^\n]*\n\n(?:\*[^\n]*\n)+\n/m, "")
  return stripped
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${htmlEscape(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n")
}

function markdownWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function headerWordCount(prose: string): number | null {
  const match = prose.match(/^\*Word count:\s*(\d+)\s*\(target\s*\d+\)\*/m)
  return match ? Number.parseInt(match[1]!, 10) : null
}

export function proseWordCount(ch: ChapterBundle): number {
  return ch.contracts.proseWordCount ?? headerWordCount(ch.prose) ?? markdownWordCount(ch.prose)
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null
}

function payloadChars(value: unknown): number {
  if (typeof value === "string") return value.length
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + (typeof item === "string" ? item.length : 0), 0)
  }
  return 0
}

function sceneContractPayloadChars(scene: any): number {
  const c = scene?.contract ?? {}
  return payloadChars(scene?.povPersonalStake)
    + payloadChars(c.goal)
    + payloadChars(c.opposition)
    + payloadChars(c.turningPoint)
    + payloadChars(c.crisisChoice)
    + payloadChars(c.choiceAlternatives)
    + payloadChars(c.outcome)
    + payloadChars(c.consequence)
    + payloadChars(c.valueIn)
    + payloadChars(c.valueOut)
}

function countIds(value: unknown, stats: ReviewStats): void {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) countIds(item, stats)
    return
  }
  const object = value as Record<string, unknown>
  if (typeof object.obligationId === "string" && object.obligationId) stats.obligationIds++
  if (typeof object.sourceId === "string" && object.sourceId) stats.sourceIds++
  if (typeof object.characterId === "string" && object.characterId) stats.characterIds++
  if (typeof object.threadId === "string" && object.threadId) stats.threadIds++
  if (typeof object.promiseId === "string" && object.promiseId) stats.promiseIds++
  if (typeof object.payoffId === "string" && object.payoffId) stats.payoffIds++
  for (const child of Object.values(object)) countIds(child, stats)
}

function emptyObligationTypeCounts(): ObligationTypeCounts {
  return {
    mustEstablish: 0,
    mustPayOff: 0,
    mustTransferKnowledge: 0,
    mustShowStateChange: 0,
    mustNotReveal: 0,
    allowedNewEntities: 0,
    loadBearing: 0,
  }
}

function addArrayCount(counts: ObligationTypeCounts, key: keyof Omit<ObligationTypeCounts, "loadBearing">, value: unknown): void {
  const count = Array.isArray(value) ? value.length : 0
  counts[key] += count
  if (key !== "allowedNewEntities") counts.loadBearing += count
}

function countObligationTypes(scene: any, counts: ObligationTypeCounts): void {
  const obligations = scene?.obligations ?? {}
  addArrayCount(counts, "mustEstablish", obligations.mustEstablish)
  addArrayCount(counts, "mustPayOff", obligations.mustPayOff)
  addArrayCount(counts, "mustTransferKnowledge", obligations.mustTransferKnowledge)
  addArrayCount(counts, "mustShowStateChange", obligations.mustShowStateChange)
  addArrayCount(counts, "mustNotReveal", obligations.mustNotReveal)
  addArrayCount(counts, "allowedNewEntities", obligations.allowedNewEntities)
}

export function computeReviewStats(chapters: ChapterBundle[]): ReviewStats {
  const stats: ReviewStats = {
    totalScenes: 0,
    anyContractFieldScenes: 0,
    coreContractFieldScenes: 0,
    choiceAlternativeScenes: 0,
    choiceAlternativeCount: 0,
    sceneContractPayloadChars: 0,
    sceneIds: 0,
    beatIds: 0,
    obligationIds: 0,
    sourceIds: 0,
    characterIds: 0,
    threadIds: 0,
    promiseIds: 0,
    payoffIds: 0,
    obligationTypeCounts: emptyObligationTypeCounts(),
    proseWords: 0,
    targetWords: 0,
  }
  for (const ch of chapters) {
    stats.proseWords += proseWordCount(ch)
    stats.targetWords += Number(ch.contracts.targetWords ?? 0)
    for (const scene of ch.contracts.scenes ?? []) {
      stats.totalScenes++
      if (scene.sceneId) stats.sceneIds++
      if (scene.beatId) stats.beatIds++
      const c = scene.contract ?? {}
      const hasGoal = nonEmpty(c.goal)
      const hasOpposition = nonEmpty(c.opposition)
      const hasTurningPoint = nonEmpty(c.turningPoint)
      const hasOutcome = nonEmpty(c.outcome)
      const hasConsequence = nonEmpty(c.consequence)
      const hasValueIn = nonEmpty(c.valueIn)
      const hasValueOut = nonEmpty(c.valueOut)
      const hasStake = nonEmpty(scene.povPersonalStake)
      const hasCrisisChoice = nonEmpty(c.crisisChoice)
      const hasAlternatives = Array.isArray(c.choiceAlternatives) && c.choiceAlternatives.length >= 2
      stats.choiceAlternativeCount += Array.isArray(c.choiceAlternatives) ? c.choiceAlternatives.length : 0
      stats.sceneContractPayloadChars += sceneContractPayloadChars(scene)
      if (
        hasGoal || hasOpposition || hasTurningPoint || hasOutcome || hasConsequence ||
        hasValueIn || hasValueOut || hasStake || hasCrisisChoice || hasAlternatives
      ) {
        stats.anyContractFieldScenes++
      }
      if (
        hasGoal && hasOpposition && hasTurningPoint && hasOutcome && hasConsequence &&
        hasValueIn && hasValueOut && hasStake
      ) {
        stats.coreContractFieldScenes++
      }
      if (hasAlternatives) stats.choiceAlternativeScenes++
      countObligationTypes(scene, stats.obligationTypeCounts)
      countIds(scene, stats)
    }
  }
  return stats
}

export function computeDiagnosticStats(chapters: ChapterBundle[]): DiagnosticStats {
  const endpointScores: number[] = []
  let endpointErrors = 0
  let sceneDramaturgyJudged = 0
  let sceneDramaturgyErrors = 0
  let sceneValueShiftTotal = 0
  let conflictVisibleScenes = 0
  let decisionOrRevelationScenes = 0
  let characterAgencyJudged = 0
  let characterAgencyErrors = 0
  let characterAgencyTotal = 0

  for (const ch of chapters) {
    if (typeof ch.diagnostics?.endpointLanding?.arrived === "number") {
      endpointScores.push(ch.diagnostics.endpointLanding.arrived)
    }
    if (ch.diagnostics?.endpointLandingError) endpointErrors++

    for (const scene of ch.diagnostics?.scenes ?? []) {
      if (typeof scene.sceneDramaturgy?.value_shift === "number") {
        sceneDramaturgyJudged++
        sceneValueShiftTotal += scene.sceneDramaturgy.value_shift
        if (scene.sceneDramaturgy.conflict_visible === true) conflictVisibleScenes++
        if (scene.sceneDramaturgy.decision_or_revelation === true) decisionOrRevelationScenes++
      }
      if (scene.sceneDramaturgyError) sceneDramaturgyErrors++

      if (typeof scene.characterAgency?.agency === "number") {
        characterAgencyJudged++
        characterAgencyTotal += scene.characterAgency.agency
      }
      if (scene.characterAgencyError) characterAgencyErrors++
    }
  }

  return {
    endpointJudged: endpointScores.length,
    endpointErrors,
    endpointScores,
    sceneDramaturgyJudged,
    sceneDramaturgyErrors,
    sceneValueShiftAverage: sceneDramaturgyJudged > 0 ? round(sceneValueShiftTotal / sceneDramaturgyJudged) : null,
    conflictVisibleScenes,
    decisionOrRevelationScenes,
    characterAgencyJudged,
    characterAgencyErrors,
    characterAgencyAverage: characterAgencyJudged > 0 ? round(characterAgencyTotal / characterAgencyJudged) : null,
  }
}

export function computeRuntimeStats(chapters: ChapterBundle[]): RuntimeStats {
  let traceEvents = 0
  let llmCalls = 0
  let writerCalls = 0
  let writerExpansionEvents = 0

  for (const ch of chapters) {
    const events = Array.isArray(ch.trace?.events) ? ch.trace.events : []
    const calls = Array.isArray(ch.trace?.llmCalls) ? ch.trace.llmCalls : []
    traceEvents += typeof ch.trace?.counts?.events === "number" ? ch.trace.counts.events : events.length
    llmCalls += typeof ch.trace?.counts?.llmCalls === "number" ? ch.trace.counts.llmCalls : calls.length
    writerCalls += typeof ch.trace?.counts?.writerCalls === "number"
      ? ch.trace.counts.writerCalls
      : calls.filter((c: any) => c?.agent === "beat-writer").length
    writerExpansionEvents += events.filter((e: any) => e?.eventType === "writer-expansion").length
  }

  return { traceEvents, llmCalls, writerCalls, writerExpansionEvents }
}

function round(value: number): number {
  return Number(value.toFixed(2))
}

function formatRatio(value: number | null): string {
  return value == null ? "n/a" : `x${value.toFixed(2)}`
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`
}

function obligationsPerScene(stats: ReviewStats): number | null {
  return stats.totalScenes > 0 ? stats.obligationTypeCounts.loadBearing / stats.totalScenes : null
}

export function buildReviewSummary(runId: string, runSummary: any | null, chapters: ChapterBundle[]): ReviewSummary {
  const reviewStats = computeReviewStats(chapters)
  const diagnosticStats = computeDiagnosticStats(chapters)
  const runtimeStats = computeRuntimeStats(chapters)
  const wordRatio = reviewStats.targetWords > 0 ? reviewStats.proseWords / reviewStats.targetWords : null
  const obligationDensity = obligationsPerScene(reviewStats)
  const otc = reviewStats.obligationTypeCounts
  const chaptersRequested = typeof runSummary?.chaptersRequested === "number" ? runSummary.chaptersRequested : null
  const overrides = runSummary?.pipelineOverrides && typeof runSummary.pipelineOverrides === "object"
    ? Object.entries(runSummary.pipelineOverrides).map(([k, v]) => `${k}=${String(v)}`).join(", ")
    : "per-novel POC overrides recorded in seed.json"

  const findings = [
    `Artifact scope: ${runSummary?.profile ?? "unknown profile"} rendered ${chapters.length}/${chaptersRequested ?? chapters.length} chapters with ${reviewStats.totalScenes} scene contracts.`,
    `Word-count finding (L102): prose totals ${reviewStats.proseWords}/${reviewStats.targetWords} target words (${formatRatio(wordRatio)}). Treat this as a planner-scope scene/chapter-load finding before trying writer numeric forcing.`,
    `Scene-contract coverage: core fields on ${reviewStats.coreContractFieldScenes}/${reviewStats.totalScenes} scenes; choice alternatives on ${reviewStats.choiceAlternativeScenes}/${reviewStats.totalScenes} scenes (${reviewStats.choiceAlternativeCount} total); scene-contract payload ${reviewStats.sceneContractPayloadChars} chars; scene IDs on ${reviewStats.sceneIds}/${reviewStats.totalScenes}; legacy beat IDs on ${reviewStats.beatIds}/${reviewStats.totalScenes}.`,
    `Traceability surfaced in contracts: ${plural(reviewStats.obligationIds, "obligation ID")}, ${plural(reviewStats.sourceIds, "source ID")}, ${plural(reviewStats.characterIds, "character ID")}, ${plural(reviewStats.threadIds, "thread ID")}, ${plural(reviewStats.promiseIds, "promise ID")}, ${plural(reviewStats.payoffIds, "payoff ID")}.`,
    `Obligation load: ${otc.loadBearing} load-bearing obligations (${obligationDensity == null ? "n/a" : obligationDensity.toFixed(2)} per scene): establish ${otc.mustEstablish}, pay off ${otc.mustPayOff}, transfer knowledge ${otc.mustTransferKnowledge}, state change ${otc.mustShowStateChange}, not reveal ${otc.mustNotReveal}; allowed-new-entity hints ${otc.allowedNewEntities}.`,
    `Runtime trace: ${runtimeStats.traceEvents} trace events, ${runtimeStats.llmCalls} LLM calls, ${runtimeStats.writerCalls} writer calls, ${runtimeStats.writerExpansionEvents} writer-expansion events.`,
    `Post-hoc diagnostics: endpoint scores ${diagnosticStats.endpointScores.join(", ") || "none"} (${diagnosticStats.endpointJudged}/${chapters.length} chapters, ${diagnosticStats.endpointErrors} errors); scene dramaturgy ${diagnosticStats.sceneDramaturgyJudged}/${reviewStats.totalScenes} judged with ${diagnosticStats.sceneDramaturgyErrors} errors; character agency ${diagnosticStats.characterAgencyJudged}/${reviewStats.totalScenes} judged with ${diagnosticStats.characterAgencyErrors} errors.`,
    `Runtime posture: production defaults stayed untouched; the POC used ${overrides}.`,
  ]

  return {
    runId,
    profile: runSummary?.profile ?? null,
    fixturePath: runSummary?.fixturePath ?? null,
    chaptersRendered: chapters.length,
    chaptersRequested,
    reviewStats,
    diagnosticStats,
    runtimeStats,
    findings,
  }
}

export function buildFindingsMarkdown(summary: ReviewSummary): string {
  return [
    `# Scene-First Novella POC Findings: ${summary.runId}`,
    "",
    ...summary.findings.map(line => `- ${line}`),
    "",
    "Reader review starts with `index.html`; machine-readable aggregates are in `review-summary.json`.",
    "",
  ].join("\n")
}

function badge(label: string, value: unknown, scoreLike?: boolean): string {
  if (value == null) return ""
  let cls = "badge"
  if (scoreLike && typeof value === "number") {
    cls += value >= 3 ? " badge-good" : value >= 2 ? " badge-mid" : value >= 1 ? " badge-low" : " badge-bad"
  } else if (typeof value === "boolean") {
    cls += value ? " badge-good" : " badge-bad"
  }
  return `<span class="${cls}"><span class="badge-label">${htmlEscape(label)}:</span> ${htmlEscape(String(value))}</span>`
}

function obligationList(items: any[], label: string): string {
  if (!items || items.length === 0) return ""
  const li = items.map(o => {
    const text = o?.text ?? "(no text)"
    const ids: string[] = []
    if (o?.obligationId) ids.push(`obl:${o.obligationId}`)
    if (o?.sourceId) ids.push(`src:${o.sourceId}`)
    if (o?.threadId) ids.push(`thread:${o.threadId}`)
    if (o?.promiseId) ids.push(`promise:${o.promiseId}`)
    if (o?.payoffId) ids.push(`payoff:${o.payoffId}`)
    if (o?.characterId) ids.push(`char:${o.characterId}`)
    const idLine = ids.length > 0 ? `<div class="muted small">${htmlEscape(ids.join(" · "))}</div>` : ""
    return `<li>${htmlEscape(text)}${idLine}</li>`
  }).join("")
  return `<div class="oblig-block"><div class="oblig-label">${htmlEscape(label)}</div><ul>${li}</ul></div>`
}

function renderContractFields(c: any): string {
  const fields: Array<[string, unknown]> = [
    ["goal", c?.goal], ["opposition", c?.opposition], ["turning point", c?.turningPoint],
    ["crisis choice", c?.crisisChoice],
    ["alternatives", (c?.choiceAlternatives ?? []).join(" | ") || null],
    ["outcome", c?.outcome], ["consequence", c?.consequence],
    ["value in→out", c?.valueIn || c?.valueOut ? `${c?.valueIn ?? "?"} → ${c?.valueOut ?? "?"}` : null],
    ["target words", c?.targetWords],
  ]
  const filled = fields.filter(([, v]) => v != null && v !== "")
  if (filled.length === 0) return `<div class="muted">(planner authored no scene-contract fields for this scene)</div>`
  return filled.map(([k, v]) => `<div class="kv"><span class="k">${htmlEscape(k)}</span><span class="v">${htmlEscape(String(v))}</span></div>`).join("")
}

function diagnosticsForScene(diag: any | null, sceneIndex: number): { dramaturgy: any | null; agency: any | null } {
  if (!diag?.scenes) return { dramaturgy: null, agency: null }
  const row = diag.scenes.find((s: any) => s.sceneIndex === sceneIndex)
  return {
    dramaturgy: row?.sceneDramaturgy ?? null,
    agency: row?.characterAgency ?? null,
  }
}

function renderScene(ch: ChapterBundle, scene: any, sceneIdx: number): string {
  const { dramaturgy, agency } = diagnosticsForScene(ch.diagnostics, sceneIdx)
  const sceneIdLine = scene.sceneId
    ? `<div class="ids"><code>sceneId: ${htmlEscape(scene.sceneId)}</code></div>`
    : ""
  const beatIdLine = scene.beatId
    ? `<div class="ids muted small"><code>beatId: ${htmlEscape(scene.beatId)}</code> (legacy/internal)</div>`
    : ""
  const dramHtml = dramaturgy
    ? [
        badge("value-shift", dramaturgy.value_shift, true),
        badge("conflict", dramaturgy.conflict_visible),
        badge("decision/revelation", dramaturgy.decision_or_revelation),
      ].join(" ")
    : `<span class="muted">no scene-dramaturgy verdict</span>`
  const agencyHtml = agency
    ? [
        badge("agency", agency.agency, true),
        agency.named_choice_or_action ? `<span class="muted small">choice: <em>${htmlEscape(agency.named_choice_or_action)}</em></span>` : "",
      ].join(" ")
    : `<span class="muted">no agency verdict</span>`
  const dramEvidence = dramaturgy?.evidence ? `<div class="evidence">"${htmlEscape(dramaturgy.evidence)}" <span class="muted small">— scene-dramaturgy</span></div>` : ""
  const agencyEvidence = agency?.evidence ? `<div class="evidence">"${htmlEscape(agency.evidence)}" <span class="muted small">— character-agency</span></div>` : ""

  const lifeAxes = (scene.lifeValueAxes ?? []).join(" · ") || "(none)"
  const mice = [
    scene.miceOpens?.length ? `opens ${scene.miceOpens.join(",")}` : "",
    scene.miceActive?.length ? `active ${scene.miceActive.join(",")}` : "",
    scene.miceCloses?.length ? `closes ${scene.miceCloses.join(",")}` : "",
  ].filter(Boolean).join(" / ") || "(none)"

  const obligations = [
    obligationList(scene.obligations?.mustEstablish, "must establish"),
    obligationList(scene.obligations?.mustPayOff, "must pay off"),
    obligationList(scene.obligations?.mustTransferKnowledge, "must transfer knowledge"),
    obligationList(scene.obligations?.mustShowStateChange, "must show state change"),
    obligationList(scene.obligations?.mustNotReveal, "must not reveal"),
  ].filter(Boolean).join("")

  return `<details class="scene" open>
    <summary class="scene-summary">
      <span class="scene-num">scene ${sceneIdx + 1}/${ch.contracts.scenes.length}</span>
      <span class="scene-kind muted">${htmlEscape(scene.kind ?? "")}</span>
      <span class="scene-desc">${htmlEscape(scene.description ?? "")}</span>
    </summary>
    <div class="scene-grid">
      <div class="contract-col">
        <h4>Scene contract</h4>
        ${sceneIdLine}
        ${beatIdLine}
        <div class="kv-block">${renderContractFields(scene.contract)}</div>
        <div class="muted small">life axes: ${htmlEscape(lifeAxes)} · MICE: ${htmlEscape(mice)} · valueShifted: ${htmlEscape(String(scene.valueShifted))} · gapPresent: ${htmlEscape(String(scene.gapPresent))}</div>
        ${obligations || `<div class="muted">(no obligations declared)</div>`}
        ${scene.povPersonalStake ? `<div class="pov-stake"><strong>POV personal stake:</strong> ${htmlEscape(scene.povPersonalStake)}</div>` : ""}
      </div>
      <div class="diag-col">
        <h4>Diagnostics</h4>
        <div class="diag-row">${dramHtml}</div>
        <div class="diag-row">${agencyHtml}</div>
        ${dramEvidence}
        ${agencyEvidence}
      </div>
    </div>
  </details>`
}

function renderChapter(ch: ChapterBundle): string {
  const proseHtml = paragraphs(ch.prose)
  const wordCount = proseWordCount(ch)
  const mdWordCount = markdownWordCount(ch.prose)
  const target = ch.contracts.targetWords ?? 0
  const ratio = target > 0 ? (wordCount / target).toFixed(2) : "n/a"
  const ratioCls = typeof target === "number" && target > 0
    ? (Math.abs(wordCount - target) / target < 0.2 ? "badge-good" : Math.abs(wordCount - target) / target < 0.5 ? "badge-mid" : "badge-bad")
    : ""
  const endpoint = ch.diagnostics?.endpointLanding
  const endpointHtml = endpoint
    ? `${badge("endpoint arrived", endpoint.arrived, true)} <span class="muted small">— ${htmlEscape(endpoint.reasoning ?? "")}</span>`
    : `<span class="muted">no endpoint-landing verdict</span>`
  const endpointEvidence = endpoint?.evidence ? `<div class="evidence">"${htmlEscape(endpoint.evidence)}" <span class="muted small">— endpoint-landing</span></div>` : ""

  const writerCalls = ch.trace?.counts?.writerCalls ?? "?"
  const llmTotal = ch.trace?.counts?.llmCalls ?? "?"
  const eventCount = ch.trace?.counts?.events ?? "?"

  const scenesHtml = (ch.contracts.scenes ?? []).map((s: any, i: number) => renderScene(ch, s, i)).join("\n")

  return `<section class="chapter" id="chapter-${ch.chapterNumber}">
    <header class="chapter-header">
      <h2>Chapter ${ch.chapterNumber}: ${htmlEscape(ch.contracts.title ?? "(untitled)")}</h2>
      <div class="chapter-meta">
        <span class="meta-item"><strong>POV:</strong> ${htmlEscape(ch.contracts.povCharacter ?? "?")}</span>
        <span class="meta-item"><strong>Setting:</strong> ${htmlEscape(ch.contracts.setting ?? "?")}</span>
        <span class="meta-item"><strong>Prose words:</strong> ${wordCount} / ${target} <span class="badge ${ratioCls}">×${ratio}</span></span>
        ${mdWordCount !== wordCount ? `<span class="meta-item muted small">markdown file words incl. header: ${mdWordCount}</span>` : ""}
        <span class="meta-item"><strong>Writer calls:</strong> ${writerCalls}</span>
        <span class="meta-item muted small">total LLM calls: ${llmTotal} · trace events: ${eventCount}</span>
      </div>
      ${ch.contracts.purpose ? `<div class="chapter-purpose"><strong>Declared purpose:</strong> ${htmlEscape(ch.contracts.purpose)}</div>` : ""}
      <div class="chapter-endpoint">${endpointHtml}</div>
      ${endpointEvidence}
    </header>
    <div class="chapter-body">
      <div class="prose-col">
        <h3>Prose</h3>
        ${proseHtml}
      </div>
      <div class="scenes-col">
        <h3>Scenes (contracts + diagnostics)</h3>
        ${scenesHtml}
      </div>
    </div>
  </section>`
}

function renderFindingsPanel(summary: ReviewSummary): string {
  const items = summary.findings.map(line => `<li>${htmlEscape(line)}</li>`).join("")
  return `<section class="findings">
    <h2>POC Findings</h2>
    <ul>${items}</ul>
  </section>`
}

function renderHtml(runId: string, runSummary: any | null, chapters: ChapterBundle[], reviewSummary: ReviewSummary): string {
  const reviewStats = reviewSummary.reviewStats
  const wordRatio = reviewStats.targetWords > 0 ? (reviewStats.proseWords / reviewStats.targetWords).toFixed(2) : "n/a"
  const summaryRow = runSummary
    ? `<div class="run-summary">
        <span><strong>Profile:</strong> ${htmlEscape(runSummary.profile ?? "?")}</span>
        <span><strong>Fixture:</strong> <code>${htmlEscape(runSummary.fixturePath ?? "?")}</code></span>
        <span><strong>Chapters saved:</strong> ${(runSummary.chaptersSaved ?? []).length}/${runSummary.chaptersRequested}</span>
        <span><strong>Prose words:</strong> ${reviewStats.proseWords}/${reviewStats.targetWords} (×${wordRatio})</span>
        <span><strong>Contract coverage:</strong> any ${reviewStats.anyContractFieldScenes}/${reviewStats.totalScenes} · core ${reviewStats.coreContractFieldScenes}/${reviewStats.totalScenes} · choices ${reviewStats.choiceAlternativeScenes}/${reviewStats.totalScenes}</span>
        <span><strong>Contract payload:</strong> ${reviewStats.sceneContractPayloadChars} chars · ${reviewStats.choiceAlternativeCount} alternatives</span>
        <span><strong>Trace IDs:</strong> scene ${reviewStats.sceneIds}/${reviewStats.totalScenes} · obl ${reviewStats.obligationIds} · src ${reviewStats.sourceIds} · thread ${reviewStats.threadIds} · promise ${reviewStats.promiseIds}</span>
        <span><strong>Drafting:</strong> ${htmlEscape(runSummary.draftingResultKind ?? "?")}</span>
      </div>`
    : ""
  const tocItems = chapters.map(c =>
    `<li><a href="#chapter-${c.chapterNumber}">Chapter ${c.chapterNumber}: ${htmlEscape(c.contracts.title ?? "")}</a></li>`,
  ).join("")
  const chapterSections = chapters.map(renderChapter).join("\n")
  const findingsPanel = renderFindingsPanel(reviewSummary)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Scene-First Novella POC — ${htmlEscape(runId)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="data:," />
  <style>
    :root {
      --fg: #1d1d1f;
      --muted: #6b6b73;
      --bg: #fbfbfc;
      --panel: #ffffff;
      --border: #e3e3e8;
      --accent: #2f6fda;
      --good: #1f9d55;
      --mid: #b88500;
      --low: #d97706;
      --bad: #c43d3d;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 15px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
    header.page { padding: 24px 32px; border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 10; }
    header.page h1 { margin: 0 0 6px 0; font-size: 18px; font-weight: 600; }
    .run-summary { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--muted); }
    .run-summary code { font-size: 12px; }
    nav.toc { padding: 12px 32px; background: var(--panel); border-bottom: 1px solid var(--border); }
    nav.toc ol { margin: 0; padding-left: 22px; columns: 2; column-gap: 32px; }
    nav.toc a { color: var(--accent); text-decoration: none; }
    nav.toc a:hover { text-decoration: underline; }
    main { padding: 24px 32px; max-width: 1600px; margin: 0 auto; }
    section.findings { margin: 0 0 24px 0; padding: 18px 22px; background: var(--panel); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 6px; }
    section.findings h2 { margin: 0 0 8px 0; font-size: 17px; }
    section.findings ul { margin: 0; padding-left: 20px; }
    section.findings li { margin-bottom: 6px; }
    section.chapter { margin: 0 0 56px 0; padding: 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
    section.chapter h2 { margin: 0 0 6px 0; font-size: 22px; }
    .chapter-meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .chapter-purpose { margin-bottom: 6px; }
    .chapter-endpoint { margin-bottom: 14px; }
    .chapter-body { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 1100px) { .chapter-body { grid-template-columns: 1fr; } }
    .prose-col h3, .scenes-col h3 { margin: 0 0 8px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .prose-col p { margin: 0 0 12px 0; }
    details.scene { border: 1px solid var(--border); border-radius: 4px; margin-bottom: 10px; }
    details.scene > summary { cursor: pointer; padding: 10px 14px; list-style: none; display: flex; gap: 10px; align-items: baseline; }
    details.scene > summary::-webkit-details-marker { display: none; }
    .scene-num { font-weight: 600; flex: 0 0 auto; }
    .scene-kind { font-size: 12px; flex: 0 0 auto; text-transform: lowercase; }
    .scene-desc { flex: 1 1 auto; color: var(--muted); }
    .scene-grid { padding: 0 14px 14px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 800px) { .scene-grid { grid-template-columns: 1fr; } }
    .scene-grid h4 { margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .ids code { font-size: 11px; background: var(--bg); padding: 1px 4px; border-radius: 2px; }
    .kv { display: flex; gap: 8px; padding: 2px 0; font-size: 13px; }
    .kv .k { flex: 0 0 95px; color: var(--muted); }
    .kv .v { flex: 1 1 auto; }
    .kv-block { margin-bottom: 8px; }
    .oblig-block { margin: 8px 0; }
    .oblig-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 4px; }
    .oblig-block ul { margin: 0; padding-left: 20px; }
    .oblig-block li { margin-bottom: 4px; }
    .pov-stake { padding: 6px 8px; background: var(--bg); border-left: 3px solid var(--accent); margin-top: 8px; font-size: 13px; }
    .badge { display: inline-block; padding: 2px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 3px; font-size: 12px; }
    .badge-label { color: var(--muted); }
    .badge-good { background: rgba(31,157,85,0.10); border-color: rgba(31,157,85,0.30); color: var(--good); }
    .badge-mid { background: rgba(184,133,0,0.10); border-color: rgba(184,133,0,0.30); color: var(--mid); }
    .badge-low { background: rgba(217,119,6,0.10); border-color: rgba(217,119,6,0.30); color: var(--low); }
    .badge-bad { background: rgba(196,61,61,0.10); border-color: rgba(196,61,61,0.30); color: var(--bad); }
    .diag-row { margin-bottom: 6px; }
    .evidence { margin-top: 6px; padding: 6px 8px; background: var(--bg); border-left: 2px solid var(--border); font-size: 13px; font-style: italic; }
    .muted { color: var(--muted); }
    .small { font-size: 12px; }
    code { font-family: "SF Mono", Menlo, monospace; }
    footer.page { padding: 16px 32px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <header class="page">
    <h1>Scene-First Novella POC <span class="muted">— ${htmlEscape(runId)}</span></h1>
    ${summaryRow}
  </header>
  <nav class="toc">
    <ol>${tocItems}</ol>
  </nav>
  <main>
    ${findingsPanel}
    ${chapterSections}
  </main>
  <footer class="page">
    POC artifact. Diagnostics are V4 Flash post-hoc judges, not calibrated. See
    <code>docs/sessions/2026-05-10-scene-migration-plan.md</code> and
    <code>docs/research/opus-semantic-judge-plan.md</code>.
  </footer>
</body>
</html>`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const runId = args.runDir.replace(/\/$/, "").split("/").pop() ?? "poc-unknown"

  const chapters: ChapterBundle[] = []
  for (let ch = 1; ch <= 50; ch++) {
    const bundle = await loadChapter(args.runDir, ch)
    if (bundle) chapters.push(bundle)
    else if (ch > 1) break
  }
  if (chapters.length === 0) throw new Error("no chapter artifacts found in run dir")

  const summaryFile = Bun.file(join(args.runDir, "run-summary.json"))
  const runSummary = await summaryFile.exists() ? await summaryFile.json() : null

  const reviewSummary = buildReviewSummary(runId, runSummary, chapters)
  const html = renderHtml(runId, runSummary, chapters, reviewSummary)
  const outPath = join(args.runDir, "index.html")
  await writeFile(outPath, html, "utf8")
  await writeFile(join(args.runDir, "review-summary.json"), JSON.stringify(reviewSummary, null, 2), "utf8")
  await writeFile(join(args.runDir, "findings.md"), buildFindingsMarkdown(reviewSummary), "utf8")
  console.log(`✓ HTML rendered: ${outPath} (${chapters.length} chapters, ${html.length} bytes)`)
  console.log(`  wrote review summary + findings.md`)
  console.log(`  open in browser: file://${outPath.startsWith("/") ? outPath : `${process.cwd()}/${outPath}`}`)
  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
