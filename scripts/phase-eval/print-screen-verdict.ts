/**
 * Phase-eval screen verdict — implements the G1-G4 screen from
 * `docs/designs/phase-variant-comparison.md` (R5) for a selected
 * control/test variant pair.
 *
 * Reads the summary.json produced by `probe-planning-scenes.ts` + the
 * per-variant `outlines.json` files, validates each outline against
 * `chapterScenePlanSchema`, applies the charter's ordered predicate table,
 * emits a verdict, and exits 0 (SCREEN-PASS) or 1 (SCREEN-FAIL).
 *
 * Charter R5 gates (per docs/designs/phase-variant-comparison.md §G):
 *   G1 (rich-facts directional uptake):
 *       test_facts_median ≥ 1.5 × control_facts_median  AND
 *       test_facts_median ≥ 8
 *   G2 (knowledge-changes directional uptake):
 *       test_know_median ≥ 1.5 × control_know_median  AND
 *       test_know_median ≥ 3
 *   G3 (scene-count directional uptake):
 *       test_total_scenes ≥ 1.10 × control_total_scenes
 *   G4 (structural validity):
 *       test variant's planning phase produced N chapter outlines, all
 *       parsing against chapterScenePlanSchema. N defaults to the seed's
 *       chapterCount (charter spec is 5; flexible per seed).
 *
 * Verdict order (first match wins, exhaustive):
 *   1. NOT G4                 → SCREEN-FAIL (broken)
 *   2. NOT (G1 AND G2 AND G3) → SCREEN-FAIL (non-compliant)
 *   3. G1 AND G2 AND G3 AND G4 → SCREEN-PASS
 *
 * Exit code: 0 for SCREEN-PASS, 1 for any SCREEN-FAIL.
 *
 * Control-variant metrics are reported for context (the charter records
 * both for re-thresholding) but the verdict is purely "did test meet its
 * own riders?" Defaults remain control=default, test=loud for backward
 * compatibility with the original R5 probe.
 *
 * Usage:
 *   bun scripts/phase-eval/print-screen-verdict.ts \
 *     --summary=<path-to-summary.json> \
 *     [--control=<variant-id>]        default: default
 *     [--test=<variant-id>]           default: loud
 *     [--metric-set=<name>]           planning-scenes | state-mapper
 *     [--persist]                    persist a row to phase_eval_runs
 *     [--exp-id=<n>]                 link the row to a tuning_experiments id
 *     [--note='...']                 free-text operator note
 *
 * Persistence is OFF by default — without --persist this script behaves
 * exactly as before (stdout + exit code only). With --persist, after
 * computing the verdict, an append-only row is INSERTed into
 * phase_eval_runs (see sql/033_phase_eval_runs.sql). See
 * docs/designs/eval-testing-module-v1.md (R6).
 */

import { readFileSync, existsSync } from "node:fs"
import { dirname, join, isAbsolute, basename } from "node:path"
import { createHash } from "node:crypto"
import { chapterScenePlanSchema } from "../../src/agents/planning-scenes/schema"
import { validateBeatObligationCoverage } from "../../src/harness/beat-obligations"

type MetricSet = "planning-scenes" | "state-mapper"

interface VariantBlock {
  id: string
  promptFile: string
  novelId?: string
  outlinesPath: string
}

interface Summary {
  seed: string
  runTag: string
  conceptSnapshotId: string
  promptEnv?: string
  variantDir: string
  variants: VariantBlock[]
}

type ParsedOutline = ReturnType<typeof chapterScenePlanSchema.parse>

interface VariantData {
  id: string
  ok: boolean
  reason?: string
  outlines: ParsedOutline[]
}

interface Args {
  summaryPath: string
  controlId: string
  testId: string
  metricSet?: MetricSet
  persist: boolean
  expId?: number
  note?: string
}

interface VariantMetrics {
  facts_median: number
  knowledge_median: number
  state_median: number
  total_scenes: number
  total_payoff_links: number
  total_obligations: number
  must_establish: number
  must_pay_off: number
  must_transfer_knowledge: number
  must_show_state_change: number
  must_not_reveal: number
  allowed_new_entities: number
  total_state_items: number
  orphan_facts: number
  orphan_knowledge: number
  orphan_state: number
  total_orphans: number
  overloaded_entries: number
  // Exact-ID coverage metrics (Phase 5+).
  missing_source_ids: number
  unknown_source_ids: number
  duplicate_source_ids: number
  source_kind_mismatches: number
  character_id_mismatches: number
  // Pattern 3 chapter-edge kind diagnostics (P3a opener / P3b closer).
  // Counts of chapters whose first/last scene entry had each kind. Diagnostic
  // only — not used as a G-gate today; surfaces whether a plotter
  // variant recovered the corpus-validated closer rule (~41% action /
  // ~35% interiority / NEVER pure description).
  chapters_total: number
  opener_action: number
  opener_dialogue: number
  opener_interiority: number
  opener_description: number
  closer_action: number
  closer_dialogue: number
  closer_interiority: number
  closer_description: number
}

interface MapperHealthMetrics {
  available: boolean
  reason?: string
  calls: number
  json_retried_calls: number
  json_failed_calls: number
  zod_failed_calls: number
  failed_calls: number
  max_completion_tokens: number
  max_tokens_cap: number
  hit_completion_cap: boolean
}

function valueAfter(arg: string, prefix: string): string | undefined {
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined
}

function usage(): string {
  return "usage: bun print-screen-verdict.ts --summary=<path-to-summary.json> [--control=<variant-id>] [--test=<variant-id>] [--metric-set=planning-scenes|state-mapper] [--persist] [--exp-id=<n>] [--note='...']"
}

function parseArgs(argv: string[]): Args {
  const summaryPath = argv.map(a => valueAfter(a, "--summary=")).find((v): v is string => v !== undefined)
  if (!summaryPath) {
    console.error(usage())
    process.exit(2)
  }

  const controlId = argv.map(a => valueAfter(a, "--control=")).find((v): v is string => v !== undefined) ?? "default"
  const testId = argv.map(a => valueAfter(a, "--test=")).find((v): v is string => v !== undefined) ?? "loud"
  if (controlId === testId) {
    console.error(`--control and --test must differ, got: ${controlId}`)
    process.exit(2)
  }

  const metricSetRaw = argv.map(a => valueAfter(a, "--metric-set=")).find((v): v is string => v !== undefined)
  const metricSet = metricSetRaw as MetricSet | undefined
  if (metricSetRaw !== undefined && metricSetRaw !== "planning-scenes" && metricSetRaw !== "state-mapper") {
    console.error(`--metric-set must be planning-scenes or state-mapper, got: ${metricSetRaw}`)
    process.exit(2)
  }

  const expIdRaw = argv.map(a => valueAfter(a, "--exp-id=")).find((v): v is string => v !== undefined)
  const expId = expIdRaw === undefined ? undefined : Number(expIdRaw)
  if (expIdRaw !== undefined && !Number.isFinite(expId)) {
    console.error(`--exp-id must be an integer, got: ${expIdRaw}`)
    process.exit(2)
  }

  return {
    summaryPath,
    controlId,
    testId,
    metricSet,
    persist: argv.includes("--persist"),
    expId,
    note: argv.map(a => valueAfter(a, "--note=")).find((v): v is string => v !== undefined),
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function fmt(n: number, places = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(places)
}

function inferMetricSet(summary: Summary): MetricSet {
  return summary.promptEnv === "PLANNING_STATE_MAPPER_PROMPT_OVERRIDE" ? "state-mapper" : "planning-scenes"
}

function countSceneObligations(outlines: ParsedOutline[]): Omit<VariantMetrics,
  "facts_median" | "knowledge_median" | "state_median" | "total_scenes" | "total_payoff_links" |
  "total_state_items" | "orphan_facts" | "orphan_knowledge" | "orphan_state" | "total_orphans" | "overloaded_entries" |
  "missing_source_ids" | "unknown_source_ids" | "duplicate_source_ids" | "source_kind_mismatches" | "character_id_mismatches"
> {
  const counts = {
    total_obligations: 0,
    must_establish: 0,
    must_pay_off: 0,
    must_transfer_knowledge: 0,
    must_show_state_change: 0,
    must_not_reveal: 0,
    allowed_new_entities: 0,
  }
  for (const outline of outlines) {
    for (const scene of outline.scenes) {
      const obligations = scene.obligations
      counts.must_establish += obligations.mustEstablish.length
      counts.must_pay_off += obligations.mustPayOff.length
      counts.must_transfer_knowledge += obligations.mustTransferKnowledge.length
      counts.must_show_state_change += obligations.mustShowStateChange.length
      counts.must_not_reveal += obligations.mustNotReveal.length
      counts.allowed_new_entities += obligations.allowedNewEntities.length
    }
  }
  counts.total_obligations = counts.must_establish + counts.must_pay_off + counts.must_transfer_knowledge + counts.must_show_state_change + counts.must_not_reveal
  return counts
}

function computeVariantMetrics(data: VariantData): VariantMetrics {
  if (!data.ok) {
    return {
      facts_median: 0,
      knowledge_median: 0,
      state_median: 0,
      total_scenes: 0,
      total_payoff_links: 0,
      total_obligations: 0,
      must_establish: 0,
      must_pay_off: 0,
      must_transfer_knowledge: 0,
      must_show_state_change: 0,
      must_not_reveal: 0,
      allowed_new_entities: 0,
      total_state_items: 0,
      orphan_facts: 0,
      orphan_knowledge: 0,
      orphan_state: 0,
      total_orphans: 0,
      overloaded_entries: 0,
      missing_source_ids: 0,
      unknown_source_ids: 0,
      duplicate_source_ids: 0,
      source_kind_mismatches: 0,
      character_id_mismatches: 0,
      chapters_total: 0,
      opener_action: 0,
      opener_dialogue: 0,
      opener_interiority: 0,
      opener_description: 0,
      closer_action: 0,
      closer_dialogue: 0,
      closer_interiority: 0,
      closer_description: 0,
    }
  }

  const facts = data.outlines.map(o => o.establishedFacts.length)
  const knowledge = data.outlines.map(o => o.knowledgeChanges.length)
  const state = data.outlines.map(o => o.characterStateChanges.length)
  const sceneCounts = data.outlines.map(o => o.scenes.length)
  const totalPayoffLinks = sum(data.outlines.map(o => sum(o.scenes.map(s => s.requiredPayoffs.length))))
  const obligationCounts = countSceneObligations(data.outlines)
  const coverage = data.outlines.map(o => validateBeatObligationCoverage(o))
  const orphanFacts = sum(coverage.map(c => c.summary.orphanFacts))
  const orphanKnowledge = sum(coverage.map(c => c.summary.orphanKnowledgeChanges))
  const orphanState = sum(coverage.map(c => c.summary.orphanStateChanges))
  const totalStateItems = sum(facts) + sum(knowledge) + sum(state)

  // Pattern 3 chapter-edge kind diagnostics — count first/last scene kind
  // across chapters. Entries with no kind field default to "action" per
  // sceneBeatSchema.kind default; that matches how the writer prompt
  // resolves it.
  const kindAt = (entries: typeof data.outlines[number]["scenes"], idx: number) =>
    entries[idx]?.kind ?? "action"
  const opener_action = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, 0) === "action").length
  const opener_dialogue = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, 0) === "dialogue").length
  const opener_interiority = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, 0) === "interiority").length
  const opener_description = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, 0) === "description").length
  const closer_action = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, o.scenes.length - 1) === "action").length
  const closer_dialogue = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, o.scenes.length - 1) === "dialogue").length
  const closer_interiority = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, o.scenes.length - 1) === "interiority").length
  const closer_description = data.outlines.filter(o => o.scenes.length > 0 && kindAt(o.scenes, o.scenes.length - 1) === "description").length

  return {
    facts_median: median(facts),
    knowledge_median: median(knowledge),
    state_median: median(state),
    total_scenes: sum(sceneCounts),
    total_payoff_links: totalPayoffLinks,
    ...obligationCounts,
    total_state_items: totalStateItems,
    orphan_facts: orphanFacts,
    orphan_knowledge: orphanKnowledge,
    orphan_state: orphanState,
    total_orphans: orphanFacts + orphanKnowledge + orphanState,
    overloaded_entries: sum(coverage.map(c => c.summary.overloadedBeats)),
    missing_source_ids: sum(coverage.map(c => c.summary.missingSourceIds)),
    unknown_source_ids: sum(coverage.map(c => c.summary.unknownObligationSourceIds)),
    duplicate_source_ids: sum(coverage.map(c => c.summary.duplicateSourceIds)),
    source_kind_mismatches: sum(coverage.map(c => c.summary.sourceKindMismatches)),
    character_id_mismatches: sum(coverage.map(c => c.summary.characterIdMismatches)),
    chapters_total: data.outlines.length,
    opener_action,
    opener_dialogue,
    opener_interiority,
    opener_description,
    closer_action,
    closer_dialogue,
    closer_interiority,
    closer_description,
  }
}

function emptyMapperHealth(reason: string): MapperHealthMetrics {
  return {
    available: false,
    reason,
    calls: 0,
    json_retried_calls: 0,
    json_failed_calls: 0,
    zod_failed_calls: 0,
    failed_calls: 0,
    max_completion_tokens: 0,
    max_tokens_cap: 0,
    hit_completion_cap: false,
  }
}

async function loadMapperHealth(v: VariantBlock): Promise<MapperHealthMetrics> {
  if (!v.novelId) return emptyMapperHealth("summary variant has no novelId")
  try {
    const { default: db } = await import("../../src/db/connection")
    const rows = await db<Array<{
      completion_tokens: number | null
      max_tokens: number | null
      json_extraction_success: boolean | null
      json_extraction_retried: boolean | null
      zod_validation_success: boolean | null
      failed: boolean | null
    }>>`
      SELECT completion_tokens, max_tokens, json_extraction_success,
             json_extraction_retried, zod_validation_success, failed
      FROM llm_calls
      WHERE novel_id = ${v.novelId}
        AND agent = 'planning-state-mapper'
      ORDER BY timestamp, id
    `
    if (rows.length === 0) return emptyMapperHealth(`no planning-state-mapper llm_calls for ${v.novelId}`)
    const maxCompletion = Math.max(0, ...rows.map(row => Number(row.completion_tokens ?? 0)))
    const maxCap = Math.max(0, ...rows.map(row => Number(row.max_tokens ?? 0)))
    return {
      available: true,
      calls: rows.length,
      json_retried_calls: rows.filter(row => row.json_extraction_retried === true).length,
      json_failed_calls: rows.filter(row => row.json_extraction_success === false).length,
      zod_failed_calls: rows.filter(row => row.zod_validation_success === false).length,
      failed_calls: rows.filter(row => row.failed === true).length,
      max_completion_tokens: maxCompletion,
      max_tokens_cap: maxCap,
      hit_completion_cap: maxCap > 0 && maxCompletion >= maxCap,
    }
  } catch (err: any) {
    return emptyMapperHealth(err?.message ?? String(err))
  }
}

function mapperHealthPass(health: MapperHealthMetrics): boolean {
  return health.available
    && health.json_retried_calls === 0
    && health.json_failed_calls === 0
    && health.zod_failed_calls === 0
    && health.failed_calls === 0
    && !health.hit_completion_cap
}

/** Resolve the per-variant outlines.json path. Path-portable across
 *  cross-machine probes — relative paths anchor on the summary file's
 *  directory; absolute paths are tried as-is then fall back to the
 *  summaryDir + variant subdir layout for legacy summaries. */
function resolveOutlinesPath(summaryDir: string, v: VariantBlock): string | null {
  if (isAbsolute(v.outlinesPath)) {
    if (existsSync(v.outlinesPath)) return v.outlinesPath
    const local = join(summaryDir, v.id, basename(v.outlinesPath))
    return existsSync(local) ? local : null
  }
  const local = join(summaryDir, v.outlinesPath)
  return existsSync(local) ? local : null
}

function loadVariantData(summaryDir: string, v: VariantBlock, expectedChapters: number): VariantData {
  const path = resolveOutlinesPath(summaryDir, v)
  if (!path) {
    return { id: v.id, ok: false, reason: `outlines.json not found (tried abs=${v.outlinesPath} and ${join(summaryDir, v.id, "outlines.json")})`, outlines: [] }
  }
  let blob: any
  try {
    blob = JSON.parse(readFileSync(path, "utf-8"))
  } catch (e: any) {
    return { id: v.id, ok: false, reason: `JSON parse error in ${path}: ${e?.message ?? e}`, outlines: [] }
  }
  const raw = (blob.outlines ?? []) as unknown[]
  if (raw.length !== expectedChapters) {
    return {
      id: v.id,
      ok: false,
      reason: `expected ${expectedChapters} chapter outlines, got ${raw.length}`,
      outlines: [],
    }
  }
  const parsed: ParsedOutline[] = []
  for (let i = 0; i < raw.length; i++) {
    const result = chapterScenePlanSchema.safeParse(raw[i])
    if (!result.success) {
      return {
        id: v.id,
        ok: false,
        reason: `chapter ${i + 1} fails chapterScenePlanSchema: ${result.error.issues.slice(0, 3).map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
        outlines: [],
      }
    }
    parsed.push(result.data)
  }
  return { id: v.id, ok: true, outlines: parsed }
}

/**
 * Compute a short SHA256 of the test variant's prompt file bytes. Persisted
 * to summary_json.prompt_hash so list-runs.ts can fold it into the family
 * key (L53). Returns "—" when the file is missing — old summaries that
 * pointed at deleted variant prompts shouldn't poison persistence.
 */
function computePromptHash(summaryDir: string, v: VariantBlock): string {
  const path = isAbsolute(v.promptFile) ? v.promptFile : join(summaryDir, v.promptFile)
  if (!existsSync(path)) {
    // Try relative-to-cwd fallback for legacy summaries that store cwd-relative paths.
    if (!existsSync(v.promptFile)) return "—"
    return createHash("sha256").update(readFileSync(v.promptFile)).digest("hex").slice(0, 8)
  }
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 8)
}

function readSeedChapterCount(seedName: string, charterDefault: number): number {
  // Anchor seed lookups on the project root; charter R5 specifies 5 chapters.
  const seedPath = join(import.meta.dir, "..", "..", "src", "seeds", `${seedName}.json`)
  if (!existsSync(seedPath)) {
    console.error(`[verdict] WARN: seed file not found at ${seedPath}; falling back to charter default ${charterDefault}`)
    return charterDefault
  }
  try {
    const seed = JSON.parse(readFileSync(seedPath, "utf-8"))
    const n = Number(seed?.chapterCount)
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`[verdict] WARN: seed.chapterCount missing or invalid; falling back to charter default ${charterDefault}`)
      return charterDefault
    }
    return n
  } catch (e: any) {
    console.error(`[verdict] WARN: could not parse seed file ${seedPath}: ${e?.message ?? e}; falling back to charter default ${charterDefault}`)
    return charterDefault
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const summaryPath = args.summaryPath
  if (!existsSync(summaryPath)) {
    console.error(`summary not found: ${summaryPath}`)
    process.exit(2)
  }

  const summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as Summary
  const summaryDir = dirname(summaryPath)
  const metricSet = args.metricSet ?? inferMetricSet(summary)

  const expectedChapters = readSeedChapterCount(summary.seed, 5)
  console.log(`Phase-eval screen — seed=${summary.seed} run=${summary.runTag}`)
  console.log(`Concept snapshot: ${summary.conceptSnapshotId}`)
  console.log(`Metric set: ${metricSet}`)
  if (summary.promptEnv) console.log(`Prompt env: ${summary.promptEnv}`)
  console.log(`Expected chapters per variant: ${expectedChapters} (from src/seeds/${summary.seed}.json)`)
  console.log(`Variants: ${summary.variants.map(v => v.id).join(", ")}`)
  console.log(`Comparison: control=${args.controlId} test=${args.testId}`)
  console.log(metricSet === "state-mapper"
    ? "Signal provenance: LLMs produce concept artifacts, skeletons, fixed scene entries, and mapper obligations; this script applies deterministic file/SQL gates over those artifacts and llm_calls telemetry."
    : "Signal provenance: LLMs produce concept artifacts and planning outlines; this script applies deterministic file gates over those artifacts.")
  console.log()

  const controlV = summary.variants.find(v => v.id === args.controlId)
  const testV = summary.variants.find(v => v.id === args.testId)
  if (!controlV || !testV) {
    const missing = [!controlV && args.controlId, !testV && args.testId].filter(Boolean).join(", ")
    console.error(`SCREEN-FAIL (broken): summary.json missing selected variant(s): ${missing} (available: ${summary.variants.map(v => v.id).join(", ")})`)
    process.exit(1)
  }

  const control = loadVariantData(summaryDir, controlV, expectedChapters)
  const test = loadVariantData(summaryDir, testV, expectedChapters)

  // ── Compute metrics ─────────────────────────────────────────────────
  const controlMetrics = computeVariantMetrics(control)
  const testMetrics = computeVariantMetrics(test)
  const controlHealth = metricSet === "state-mapper" ? await loadMapperHealth(controlV) : null
  const testHealth = metricSet === "state-mapper" ? await loadMapperHealth(testV) : null

  const m = {
    control_facts_median: controlMetrics.facts_median,
    test_facts_median: testMetrics.facts_median,
    control_know_median: controlMetrics.knowledge_median,
    test_know_median: testMetrics.knowledge_median,
    control_total_scenes: controlMetrics.total_scenes,
    test_total_scenes: testMetrics.total_scenes,
    control: controlMetrics,
    test: testMetrics,
  }

  // ── Apply gates ─────────────────────────────────────────────────────
  // G4 first because it's the predicate-1 gate.
  const G4 = test.ok
  const mapperStateFloor = Math.max(expectedChapters, 0.75 * controlMetrics.total_state_items)
  // Planning-scenes keeps the historical R5 directional gates. State-mapper
  // screens focus on writer-visible coverage and avoiding empty-state wins.
  // G1 for state-mapper is now exact-ID coverage: missing/unknown/duplicate
  // source IDs, sourceKind mismatches, and character-ID mismatches must all
  // be zero. Text/fuzzy overlap is not part of this verdict path.
  const G1 = metricSet === "planning-scenes"
    ? m.test_facts_median >= 1.5 * m.control_facts_median && m.test_facts_median >= 8
    : (testMetrics.missing_source_ids === 0
        && testMetrics.unknown_source_ids === 0
        && testMetrics.duplicate_source_ids === 0
        && testMetrics.source_kind_mismatches === 0
        && testMetrics.character_id_mismatches === 0)
  const G2 = metricSet === "planning-scenes"
    ? m.test_know_median >= 1.5 * m.control_know_median && m.test_know_median >= 3
    : testMetrics.overloaded_entries === 0
  const G3 = metricSet === "planning-scenes"
    ? m.test_total_scenes >= 1.10 * m.control_total_scenes
    : testMetrics.total_state_items >= mapperStateFloor
  const G5 = metricSet === "planning-scenes" ? true : mapperHealthPass(testHealth!)

  // ── Print metrics ───────────────────────────────────────────────────
  console.log("Metrics (deterministic counts from parsed LLM-produced outlines):")
  for (const [id, data, metrics] of [[args.controlId, control, controlMetrics], [args.testId, test, testMetrics]] as const) {
    const idCoverage = metricSet === "state-mapper"
      ? `  missing_source_ids=${metrics.missing_source_ids}  unknown_source_ids=${metrics.unknown_source_ids}  duplicate_source_ids=${metrics.duplicate_source_ids}  source_kind_mismatches=${metrics.source_kind_mismatches}  characterId_mismatches=${metrics.character_id_mismatches}`
      : ""
    console.log(`  ${id}: facts_median=${fmt(metrics.facts_median)}  know_median=${fmt(metrics.knowledge_median)}  state_median=${fmt(metrics.state_median)}  total_scenes=${metrics.total_scenes}  payoffs=${metrics.total_payoff_links}  obligations=${metrics.total_obligations}  orphans=${metrics.total_orphans}  overloaded=${metrics.overloaded_entries}${idCoverage}  status=${data.ok ? "ok" : `BROKEN (${data.reason})`}`)
    if (metrics.chapters_total > 0) {
      console.log(`        opener kinds: action=${metrics.opener_action}/dialogue=${metrics.opener_dialogue}/interiority=${metrics.opener_interiority}/description=${metrics.opener_description}  closer kinds: action=${metrics.closer_action}/dialogue=${metrics.closer_dialogue}/interiority=${metrics.closer_interiority}/description=${metrics.closer_description} (P3 diagnostic, of ${metrics.chapters_total} chapters)`)
    }
  }
  if (metricSet === "state-mapper") {
    console.log()
    console.log("Mapper health (SQL telemetry from llm_calls; deterministic health predicates):")
    for (const [id, health] of [[args.controlId, controlHealth!], [args.testId, testHealth!]] as const) {
      if (!health.available) {
        console.log(`  ${id}: unavailable (${health.reason})`)
      } else {
        console.log(`  ${id}: calls=${health.calls} json_retried=${health.json_retried_calls} json_failed=${health.json_failed_calls} zod_failed=${health.zod_failed_calls} failed=${health.failed_calls} max_completion=${health.max_completion_tokens}/${health.max_tokens_cap}`)
      }
    }
  }
  console.log()
  console.log("Gate evaluation (all gates are deterministic checks; no judge LLM is called here):")
  if (metricSet === "planning-scenes") {
    console.log(`  G1 rich-facts [code]:        ${args.testId}_facts_median (${fmt(m.test_facts_median)}) ≥ 1.5 × ${args.controlId}_facts_median (${fmt(1.5 * m.control_facts_median)}) AND ≥ 8       → ${G1 ? "PASS" : "FAIL"}`)
    console.log(`  G2 knowledge-changes [code]: ${args.testId}_know_median (${fmt(m.test_know_median)}) ≥ 1.5 × ${args.controlId}_know_median (${fmt(1.5 * m.control_know_median)}) AND ≥ 3        → ${G2 ? "PASS" : "FAIL"}`)
    console.log(`  G3 scene-count [code]:       ${args.testId}_total_scenes (${m.test_total_scenes}) ≥ 1.10 × ${args.controlId}_total_scenes (${fmt(1.10 * m.control_total_scenes)})                                  → ${G3 ? "PASS" : "FAIL"}`)
  } else {
    console.log(`  G1 exact-id coverage [code]: ${args.testId} missing_source_ids=${testMetrics.missing_source_ids}, unknown_source_ids=${testMetrics.unknown_source_ids}, duplicate_source_ids=${testMetrics.duplicate_source_ids}, source_kind_mismatches=${testMetrics.source_kind_mismatches}, characterId_mismatches=${testMetrics.character_id_mismatches} (all = 0 required; text/fuzzy overlap is not evaluated) → ${G1 ? "PASS" : "FAIL"}`)
    console.log(`  G2 no-overload [code]:       ${args.testId}_overloaded_entries (${testMetrics.overloaded_entries}) = 0                                                            → ${G2 ? "PASS" : "FAIL"}`)
    console.log(`  G3 state-retention [code]:   ${args.testId}_state_items (${testMetrics.total_state_items}) ≥ max(${expectedChapters}, 0.75 × ${args.controlId}_state_items=${fmt(0.75 * controlMetrics.total_state_items)}) → ${G3 ? "PASS" : "FAIL"}`)
  }
  console.log(`  G4 structural [code]:        ${args.testId} planning complete + ${expectedChapters} outlines parse                                                                  → ${G4 ? "PASS" : "FAIL"}`)
  if (metricSet === "state-mapper") {
    const h = testHealth!
    console.log(`  G5 mapper-health [SQL+code]: telemetry available + no retries/failures/cap-hit (${h.available ? `json_retried=${h.json_retried_calls}, failed=${h.failed_calls}, cap=${h.hit_completion_cap}` : h.reason}) → ${G5 ? "PASS" : "FAIL"}`)
  }
  console.log()

  // ── Apply ordered predicate table (charter §G) ──────────────────────
  let verdict: string
  let exitCode: number
  let baseVerdictKind: "fail-broken" | "fail-noncompliant" | "single-pass"
  if (!G4) {
    verdict = `SCREEN-FAIL (broken) — ${args.testId} variant did not produce ${expectedChapters} parseable chapter outlines${test.reason ? `: ${test.reason}` : ""}`
    exitCode = 1
    baseVerdictKind = "fail-broken"
  } else if (!(G1 && G2 && G3 && G5)) {
    const failed = [!G1 && "G1", !G2 && "G2", !G3 && "G3", !G5 && "G5"].filter(Boolean).join(", ")
    verdict = `SCREEN-FAIL (non-compliant) — ${args.testId} ${metricSet} variant ran but failed: ${failed}`
    exitCode = 1
    baseVerdictKind = "fail-noncompliant"
  } else {
    // Don't emit the bare "SCREEN-PASS" label yet — promotion eligibility
    // gets checked below. Emit either SCREEN-PASS-SUGGESTIVE (one run) or
    // PROMOTION-PASS (this + at least one prior consecutive pass for the
    // same probe + commit + seed).
    verdict = `SCREEN-PASS-SUGGESTIVE — ${args.testId} ${metricSet} variant cleared ${metricSet === "state-mapper" ? "G1, G2, G3, G4, G5" : "G1, G2, G3, G4"} (single-run; promotion requires 2+ consecutive passes — see promotion check below)`
    exitCode = 0
    baseVerdictKind = "single-pass"
  }

  // ── Promotion eligibility check ──────────────────────────────────────
  // For planning-scenes, single-run G1/G2 SCREEN-PASS is not promotion-
  // grade because medians swing 2-3 across reruns of the same prompt
  // (exp #311 r1/r2/r3). Require at least one prior SCREEN-PASS-SUGGESTIVE
  // / PROMOTION-PASS row for the same (probe, test_variant, commit, seed)
  // combination. State-mapper noise profile is separate (no observed flap
  // data yet); the promotion check still runs but the threshold may need
  // recalibration when state-mapper noise data exists.
  let promotionUpgrade = false
  if (baseVerdictKind === "single-pass") {
    try {
      const { checkPromotionEligibility } = await import("./promotion-check")
      const decision = await checkPromotionEligibility({
        probeName: "phase-variant-comparison",
        testVariant: args.testId,
        gitCommit: (await import("./persist-run")).currentGitCommit(),
        seed: summary.seed,
      })
      if (decision.eligible) {
        verdict = `PROMOTION-PASS — ${args.testId} ${metricSet} variant cleared ${metricSet === "state-mapper" ? "G1-G5" : "G1-G4"} on this run AND ${decision.priorPassCount} prior consecutive pass(es) at the same (probe, variant, commit, seed). Eligible for promotion.`
        promotionUpgrade = true
      }
    } catch (err) {
      // Promotion check failure must not mask the base verdict. Log and
      // proceed with SCREEN-PASS-SUGGESTIVE.
      console.error(`[verdict] WARN: promotion eligibility check failed: ${(err as Error).message}`)
    }
  }

  console.log(`Verdict: ${verdict}`)
  if (baseVerdictKind === "single-pass" && !promotionUpgrade && metricSet === "planning-scenes") {
    console.log(`Promotion gate: SCREEN-PASS-SUGGESTIVE — n=10 single-run G1/G2 medians swing 2-3 across reruns of the same prompt (exp #311). PROMOTION-PASS requires 2+ consecutive passes for the same (probe, variant, commit, seed). Re-run this probe to upgrade. See list-runs.ts for run history.`)
  }
  console.log(`Exit: ${exitCode}`)

  // R6 persistence (optional, OFF by default). After verdict + metrics
  // are computed and printed, INSERT a single row into phase_eval_runs
  // mirroring the augmented summary + verdict line. See
  // docs/designs/eval-testing-module-v1.md §5.
  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("./persist-run")
    // L53: compute prompt_hash for the test variant's prompt file so the
    // family-key calculation in list-runs can discriminate reruns whose
    // prompt bytes differ from prior runs at the same commit.
    const promptHash = computePromptHash(summaryDir, testV)
    const augmentedSummary = {
      ...summary,
      control_variant: args.controlId,
      test_variant: args.testId,
      metric_set: metricSet,
      g_metrics: m,
      mapper_health: metricSet === "state-mapper" ? { control: controlHealth, test: testHealth } : undefined,
      gates: metricSet === "state-mapper" ? { G1, G2, G3, G4, G5 } : { G1, G2, G3, G4 },
      expected_chapters: expectedChapters,
      prompt_hash: promptHash,
    }
    try {
      const runId = await persistPhaseEvalRun({
        probeName: "phase-variant-comparison",
        gitCommit: currentGitCommit(),
        experimentId: args.expId ?? null,
        seedsUsed: [summary.seed],
        variantLabels: summary.variants.map(v => v.id),
        summaryJson: augmentedSummary,
        verdict,
        notes: args.note ?? null,
      })
      console.log(`Persisted as phase_eval_runs.id=${runId}`)
    } catch (err) {
      // Persistence failure must NOT mask the verdict. Print + exit
      // with the verdict's own exit code; the operator can re-persist
      // later with the same summary file if needed.
      console.error(`[verdict] WARN: --persist failed: ${(err as Error).message}`)
    }
  }

  process.exit(exitCode)
}

main().catch(err => {
  console.error("[verdict] fatal:", err)
  process.exit(1)
})
