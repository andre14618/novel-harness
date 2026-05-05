/**
 * Phase 7 ApprovalPolicy replay report CLI.
 *
 * Usage:
 *   bun scripts/approval-policy-replay-report.ts
 *   bun scripts/approval-policy-replay-report.ts --fixture /tmp/replay-rows.json
 *   bun scripts/approval-policy-replay-report.ts --frozen-fixture /tmp/cases.json --candidate-policy /tmp/policy.json
 *   bun scripts/approval-policy-replay-report.ts --generator lint-to-prose-edit --generator-fixture /tmp/generator-cases.json --candidate-policy /tmp/policy.json
 *   bun scripts/approval-policy-replay-report.ts --generator editorial-beat-coverage --generator-fixture /tmp/beat-cases.json --candidate-policy /tmp/policy.json
 *   bun scripts/approval-policy-replay-report.ts --generator artifact-patch-envelope --generator-fixture /tmp/artifact-cases.json --candidate-policy /tmp/policy.json
 *   bun scripts/approval-policy-replay-report.ts --novel <novelId> --format markdown
 *   bun scripts/approval-policy-replay-report.ts --check --tier assisted
 */

import {
  buildPolicyReplayReport,
  policyPromotionThresholdsForTier,
  renderPolicyReplayMarkdown,
  replayCandidatePolicy,
  replayProposalGenerator,
  type FrozenPolicyReplayCase,
  type FrozenProposalGeneratorReplayCase,
  type PolicyPromotionTier,
  type PolicyReplayReport,
  type PolicyReplayRow,
  type ProposalGeneratorReplayResult,
} from "../src/canon/approval-policy-replay"
import type { ApprovalPolicy } from "../src/canon/approval-policy"
import { buildArtifactPatchEnvelope } from "../src/canon/proposal-envelope"
import {
  buildProseEditEnvelopesFromLintIssues,
  type BuildLintProseEditEnvelopesArgs,
} from "../src/canon/lint-to-prose-edit"
import {
  runEditorialBeatCoverageCheck,
  type BeatCoverageLlmOutput,
  type RunEditorialBeatCoverageArgs,
} from "../src/canon/editorial-beat-coverage"
import { listPolicyReplayRows } from "../src/db/approval-policy-replay"
import { readFile } from "node:fs/promises"

type ReplayGeneratorName = "lint-to-prose-edit" | "editorial-beat-coverage" | "artifact-patch-envelope"
type ArtifactPatchGeneratorInput = Parameters<typeof buildArtifactPatchEnvelope>[0]
type LintGeneratorInput = BuildLintProseEditEnvelopesArgs
type EditorialBeatCoverageGeneratorInput =
  Omit<RunEditorialBeatCoverageArgs, "callLLM" | "now"> & {
    now?: string | Date
    llmOutput: BeatCoverageLlmOutput
  }

export interface Args {
  novelId?: string
  since?: string
  fixture?: string
  frozenFixture?: string
  generatorFixture?: string
  generator?: ReplayGeneratorName
  candidatePolicy?: string
  tier: PolicyPromotionTier
  limit: number
  format: "json" | "markdown"
  check: boolean
  minRows?: number
  minAutoPrecision?: number
  maxCanonAutoApproveRate?: number
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  const map: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.match(/^--([^=]+)=(.*)$/)
    if (eq) {
      map[eq[1]!] = eq[2]!
      continue
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${arg}`)
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      map[key] = next
      i++
    } else {
      map[key] = true
    }
  }

  const format = map.format ?? "markdown"
  if (format !== "json" && format !== "markdown") {
    throw new Error(`--format must be json or markdown, got: ${String(format)}`)
  }

  const frozenFixture = stringOpt(map["frozen-fixture"] ?? map.frozenFixture)
  const generatorFixture = stringOpt(map["generator-fixture"] ?? map.generatorFixture)
  const generator = parseGeneratorName(map.generator)
  const tier = parsePromotionTier(map.tier)
  const candidatePolicy = stringOpt(map["candidate-policy"] ?? map.candidatePolicy)
  if (generatorFixture && !generator) {
    throw new Error(`--generator-fixture requires --generator`)
  }
  if (generator && !generatorFixture) {
    throw new Error(`--generator requires --generator-fixture`)
  }
  if ((frozenFixture || generatorFixture) && !candidatePolicy) {
    throw new Error(`--candidate-policy is required with --frozen-fixture or --generator-fixture`)
  }
  if (candidatePolicy && !frozenFixture && !generatorFixture) {
    throw new Error(`--candidate-policy requires --frozen-fixture or --generator-fixture`)
  }

  const fixture = stringOpt(map.fixture)
  const fixtureModes = [fixture, frozenFixture, generatorFixture].filter(Boolean)
  if (fixtureModes.length > 1) {
    throw new Error(`--fixture, --frozen-fixture, and --generator-fixture are mutually exclusive`)
  }

  return {
    novelId: stringOpt(map.novel ?? map.novelId),
    since: stringOpt(map.since),
    fixture,
    frozenFixture,
    generatorFixture,
    generator,
    candidatePolicy,
    tier,
    limit: numberOpt(map.limit, 500),
    format,
    check: map.check === true || map.check === "true",
    minRows: optionalNumber(map["min-rows"] ?? map.minRows),
    minAutoPrecision: optionalNumber(map["min-auto-precision"] ?? map.minAutoPrecision),
    maxCanonAutoApproveRate: optionalNumber(map["max-canon-auto-approve-rate"] ?? map.maxCanonAutoApproveRate),
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: Args
  let report: PolicyReplayReport
  let generatorReplay: ProposalGeneratorReplayResult | undefined
  try {
    args = parseArgs(argv)

    const tierThresholds = policyPromotionThresholdsForTier(args.tier)
    const thresholds = {
      minRows: args.minRows ?? tierThresholds.minRows,
      minAutoPrecision: args.minAutoPrecision ?? tierThresholds.minAutoPrecision,
      maxCanonAutoApproveRate: args.maxCanonAutoApproveRate ?? tierThresholds.maxCanonAutoApproveRate,
    }

    if (args.frozenFixture && args.candidatePolicy) {
      const [cases, policy] = await Promise.all([
        loadFrozenCases(args.frozenFixture),
        loadCandidatePolicy(args.candidatePolicy),
      ])
      report = replayCandidatePolicy(cases, policy, { thresholds }).report
    } else if (args.generatorFixture && args.generator && args.candidatePolicy) {
      const [cases, policy] = await Promise.all([
        loadGeneratorCases(args.generatorFixture, args.generator),
        loadCandidatePolicy(args.candidatePolicy),
      ])
      generatorReplay = await replayProposalGenerator(
        cases,
        policy,
        (input) => runReplayGenerator(args.generator!, input),
        { thresholds },
      )
      report = generatorReplay.report
    } else {
      const rows = args.fixture
        ? await loadFixtureRows(args.fixture)
        : await listPolicyReplayRows({
            novelId: args.novelId,
            since: args.since,
            limit: args.limit,
          })
      report = buildPolicyReplayReport(rows, { thresholds })
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 2
  }

  if (args.format === "json") {
    const output = generatorReplay
      ? {
          ...report,
          generatorReplay: {
            policyVersion: generatorReplay.policyVersion,
            caseCount: generatorReplay.caseCount,
            generatedEnvelopeCount: generatorReplay.generatedEnvelopeCount,
            matchedEnvelopeCount: generatorReplay.matchedEnvelopeCount,
            missingExpected: generatorReplay.missingExpected,
            unexpectedGenerated: generatorReplay.unexpectedGenerated,
          },
        }
      : report
    console.log(JSON.stringify(output, null, 2))
  } else {
    console.log(renderPolicyReplayMarkdown(report))
    if (generatorReplay) {
      console.log("")
      console.log("## Generator Replay")
      console.log(`Cases: ${generatorReplay.caseCount}`)
      console.log(`Generated envelopes: ${generatorReplay.generatedEnvelopeCount}`)
      console.log(`Matched envelopes: ${generatorReplay.matchedEnvelopeCount}`)
      console.log(`Missing expected: ${generatorReplay.missingExpected.length}`)
      console.log(`Unexpected generated: ${generatorReplay.unexpectedGenerated.length}`)
    }
  }

  const generatorDrifted = generatorReplay
    ? generatorReplay.missingExpected.length > 0 || generatorReplay.unexpectedGenerated.length > 0
    : false
  return args.check && (!report.promotion.pass || generatorDrifted) ? 1 : 0
}

async function loadFixtureRows(fixturePath: string): Promise<PolicyReplayRow[]> {
  const raw = await readFile(fixturePath, "utf8")
  const parsed = JSON.parse(raw)
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray(parsed.rows)
      ? parsed.rows
      : null
  if (rows === null) {
    throw new Error(`--fixture must point to a JSON array or { rows: [...] }, got: ${typeof parsed}`)
  }
  return rows as PolicyReplayRow[]
}

async function loadFrozenCases(fixturePath: string): Promise<FrozenPolicyReplayCase[]> {
  const raw = await readFile(fixturePath, "utf8")
  const parsed = JSON.parse(raw)
  const cases = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray(parsed.cases)
      ? parsed.cases
      : null
  if (cases === null) {
    throw new Error(`--frozen-fixture must point to a JSON array or { cases: [...] }, got: ${typeof parsed}`)
  }
  return cases as FrozenPolicyReplayCase[]
}

async function loadGeneratorCases(
  fixturePath: string,
  generator: ReplayGeneratorName,
): Promise<Array<FrozenProposalGeneratorReplayCase<
  ArtifactPatchGeneratorInput | LintGeneratorInput | EditorialBeatCoverageGeneratorInput
>>> {
  const raw = await readFile(fixturePath, "utf8")
  const parsed = JSON.parse(raw)
  const fixtureGenerator = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as { generator?: unknown }).generator
    : undefined
  if (fixtureGenerator !== undefined && fixtureGenerator !== generator) {
    throw new Error(`--generator (${generator}) does not match fixture generator (${String(fixtureGenerator)})`)
  }
  const cases = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray(parsed.cases)
      ? parsed.cases
      : null
  if (cases === null) {
    throw new Error(`--generator-fixture must point to a JSON array or { cases: [...] }, got: ${typeof parsed}`)
  }
  return cases.map((replayCase) => {
    if (typeof replayCase !== "object" || replayCase === null || Array.isArray(replayCase)) {
      throw new Error(`--generator-fixture cases must be objects`)
    }
    const c = replayCase as FrozenProposalGeneratorReplayCase<
      (ArtifactPatchGeneratorInput | LintGeneratorInput | EditorialBeatCoverageGeneratorInput) & { now?: string | Date }
    >
    return {
      ...c,
      input: {
        ...c.input,
        now: c.input.now instanceof Date
          ? c.input.now
          : typeof c.input.now === "string"
            ? new Date(c.input.now)
            : undefined,
      },
    } satisfies FrozenProposalGeneratorReplayCase<BuildLintProseEditEnvelopesArgs>
  })
}

async function runReplayGenerator(
  generator: ReplayGeneratorName,
  input: ArtifactPatchGeneratorInput | LintGeneratorInput | EditorialBeatCoverageGeneratorInput,
) {
  if (generator === "artifact-patch-envelope") {
    return [buildArtifactPatchEnvelope(input as ArtifactPatchGeneratorInput)]
  }
  if (generator === "lint-to-prose-edit") {
    return buildProseEditEnvelopesFromLintIssues(input as LintGeneratorInput)
  }

  const editorialInput = input as EditorialBeatCoverageGeneratorInput
  const result = await runEditorialBeatCoverageCheck({
    ...editorialInput,
    now: editorialInput.now instanceof Date
      ? editorialInput.now
      : typeof editorialInput.now === "string"
        ? new Date(editorialInput.now)
        : undefined,
    callLLM: async () => editorialInput.llmOutput,
  })
  return result.envelopes
}

async function loadCandidatePolicy(policyPath: string): Promise<ApprovalPolicy> {
  const raw = await readFile(policyPath, "utf8")
  const parsed = JSON.parse(raw)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`--candidate-policy must point to a JSON object`)
  }
  const policy = parsed as Partial<ApprovalPolicy>
  if (typeof policy.version !== "string" || policy.version.length === 0) {
    throw new Error(`--candidate-policy requires a non-empty string version`)
  }
  if (policy.mode !== "manual" && policy.mode !== "assisted" && policy.mode !== "autonomous" && policy.mode !== "eval") {
    throw new Error(`--candidate-policy mode must be manual, assisted, autonomous, or eval`)
  }
  if (
    policy.autoApproveRiskCeiling !== undefined &&
    policy.autoApproveRiskCeiling !== "mechanical" &&
    policy.autoApproveRiskCeiling !== "low" &&
    policy.autoApproveRiskCeiling !== "medium" &&
    policy.autoApproveRiskCeiling !== "high"
  ) {
    throw new Error(`--candidate-policy autoApproveRiskCeiling must be mechanical, low, medium, or high`)
  }
  if (policy.manualKinds !== undefined) {
    const validKinds = new Set(["artifact_patch", "canon_update", "prose_edit", "editorial_flag"])
    if (!Array.isArray(policy.manualKinds) || policy.manualKinds.some((kind) => !validKinds.has(kind))) {
      throw new Error(`--candidate-policy manualKinds must be an array of proposal envelope kinds`)
    }
  }
  return policy as ApprovalPolicy
}

function parseGeneratorName(value: string | true | undefined): ReplayGeneratorName | undefined {
  if (value === undefined) return undefined
  if (value === true) throw new Error(`--generator requires a value`)
  if (value !== "lint-to-prose-edit" && value !== "editorial-beat-coverage" && value !== "artifact-patch-envelope") {
    throw new Error(`--generator must be artifact-patch-envelope, lint-to-prose-edit, or editorial-beat-coverage, got: ${value}`)
  }
  return value
}

function parsePromotionTier(value: string | true | undefined): PolicyPromotionTier {
  if (value === undefined) return "dev"
  if (value === true) throw new Error(`--tier requires a value`)
  if (value !== "dev" && value !== "assisted" && value !== "autonomous") {
    throw new Error(`--tier must be dev, assisted, or autonomous, got: ${value}`)
  }
  return value
}

function stringOpt(value: string | true | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalNumber(value: string | true | undefined): number | undefined {
  if (value === undefined || value === true) return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`expected number, got: ${value}`)
  return n
}

function numberOpt(value: string | true | undefined, fallback: number): number {
  const n = optionalNumber(value)
  if (n === undefined) return fallback
  if (n <= 0) throw new Error(`expected positive number, got: ${value}`)
  return Math.floor(n)
}

if (import.meta.main) {
  process.exitCode = await main()
}
