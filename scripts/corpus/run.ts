#!/usr/bin/env bun
/**
 * Corpus pipeline orchestrator. Runs stages of the pipeline against a bundle.
 *
 * Stages 1-5 (existing — corpus pipeline up through verify):
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage scenes
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage beats-prepare
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage beats-merge --results-dir /tmp/beat-results
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage briefs-prepare
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage briefs-merge --results-dir /tmp/brief-results
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage verify
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage list
 *
 * Stage 6 — structural-decomposition (R7 charter, end-to-end per book):
 *   bun scripts/corpus/run.ts --novel <key> --book <book> --stage structure-extract
 *   bun scripts/corpus/run.ts --novel <key> --book <book> --stage structure-sample [--dim <dim>] [--n 50]
 *   bun scripts/corpus/run.ts --novel <key> --book <book> --stage structure-judge [--dim <dim>] [--judge-model pro|flash]
 *   bun scripts/corpus/run.ts --novel <key> --book <book> --stage structure-calibrate [--dim <dim>]
 *   bun scripts/corpus/run.ts --novel <key> --book <book> --stage structure-all [--dim <dim>] [--judge-model pro|flash] [--n 50]
 *
 * Stage 6 substages compose the existing scripts (extract-structure.ts, extract-mice.ts,
 * extract-character-arcs.ts, extract-mckee-gap.ts, sample-for-adjudication.ts, llm-judge.ts,
 * compute-calibration.ts) with no-overwrite stamping per `_run-stamp.ts`.
 *
 * Default dim list: value-charge, promise, character-arcs, mice, mckee-gap.
 * Use --dim <single> to scope to one dim (e.g. for the cheapest-counterfactual experiment
 * recommended in `docs/designs/decomposed-extractor-sonnet-anchor-v1.md`).
 */

import { $ } from "bun"
import { existsSync } from "fs"
import { join } from "path"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

const ALL_STRUCTURE_DIMS = [
  "value-charge",
  "promise",
  "character-arcs",
  "mice",
  "mckee-gap",
] as const

type StructureDim = typeof ALL_STRUCTURE_DIMS[number]

function dimsFromArgs(): StructureDim[] {
  const dim = argValue("--dim")
  if (!dim || dim === "all") return [...ALL_STRUCTURE_DIMS]
  if (!ALL_STRUCTURE_DIMS.includes(dim as StructureDim)) {
    console.error(`Unknown --dim ${dim}. Valid: ${ALL_STRUCTURE_DIMS.join(", ")}, or "all".`)
    process.exit(1)
  }
  return [dim as StructureDim]
}

async function structureExtract(novel: string, book: string, dims: StructureDim[]) {
  // Maps dim → script. extract-structure.ts handles BOTH value-charge AND promise
  // in a single invocation (legacy R7 design); the other three have their own scripts.
  const ranStructure = new Set<string>()
  for (const dim of dims) {
    if (dim === "value-charge" || dim === "promise") {
      // Run once for this batch — extract-structure handles both.
      if (ranStructure.has("structure")) continue
      ranStructure.add("structure")
      const skipPromise = !dims.includes("promise") ? ["--skip-promise"] : []
      const skipVC = !dims.includes("value-charge") ? ["--skip-value-charge"] : []
      console.log(`\n[structure-extract] extract-structure.ts (value-charge + promise)`)
      await $`bun scripts/corpus/extract-structure.ts --novel ${novel} --book ${book} ${skipPromise} ${skipVC}`.cwd(REPO_ROOT)
    } else if (dim === "character-arcs") {
      console.log(`\n[structure-extract] extract-character-arcs.ts`)
      await $`bun scripts/corpus/extract-character-arcs.ts --novel ${novel} --book ${book}`.cwd(REPO_ROOT)
    } else if (dim === "mice") {
      console.log(`\n[structure-extract] extract-mice.ts`)
      await $`bun scripts/corpus/extract-mice.ts --novel ${novel} --book ${book}`.cwd(REPO_ROOT)
    } else if (dim === "mckee-gap") {
      console.log(`\n[structure-extract] extract-mckee-gap.ts`)
      await $`bun scripts/corpus/extract-mckee-gap.ts --novel ${novel} --book ${book}`.cwd(REPO_ROOT)
    }
  }
}

async function structureSample(novel: string, book: string, dims: StructureDim[]) {
  const n = argValue("--n") ?? "50"
  const seed = argValue("--seed") ?? "42"
  for (const dim of dims) {
    console.log(`\n[structure-sample] dim=${dim} n=${n}`)
    await $`bun scripts/corpus/sample-for-adjudication.ts --novel ${novel} --book ${book} --dim ${dim} --n ${n} --seed ${seed}`.cwd(REPO_ROOT)
  }
}

async function structureJudge(novel: string, book: string, dims: StructureDim[]) {
  const judgeModel = argValue("--judge-model") ?? "pro"
  if (judgeModel !== "pro" && judgeModel !== "flash") {
    console.error(`--judge-model must be "pro" or "flash". Got: ${judgeModel}`)
    process.exit(1)
  }
  for (const dim of dims) {
    console.log(`\n[structure-judge] dim=${dim} judge=${judgeModel}`)
    await $`bun scripts/corpus/llm-judge.ts --novel=${novel} --book=${book} --dim=${dim} --judge-model=${judgeModel}`.cwd(REPO_ROOT)
  }
}

async function structureCalibrate(novel: string, book: string, dims: StructureDim[]) {
  const dimArg = dims.length === ALL_STRUCTURE_DIMS.length ? "all" : dims[0]!
  console.log(`\n[structure-calibrate] dim=${dimArg}`)
  await $`bun scripts/corpus/compute-calibration.ts --novel=${novel} --book=${book} --dim=${dimArg}`.cwd(REPO_ROOT)
}

async function main() {
  const novel = argValue("--novel")
  const stage = argValue("--stage")
  if (!novel || !stage) {
    console.error("Usage: bun scripts/corpus/run.ts --novel <key> --stage <stage>")
    console.error("Stages 1-5: scenes, beats-prepare, beats-merge, briefs-prepare, briefs-merge, verify, list")
    console.error("Stage 6:    structure-extract, structure-sample, structure-judge, structure-calibrate, structure-all")
    process.exit(1)
  }

  const bundleDir = join(REPO_ROOT, "novels", novel)
  if (!existsSync(bundleDir)) {
    console.error(`Bundle not found: ${bundleDir}`)
    process.exit(1)
  }

  const py = "python3"
  const base = join(REPO_ROOT, "scripts/finetune")

  switch (stage) {
    case "scenes":
      await $`${py} ${join(base, "extract-scenes.py")} --novel ${novel}`
      break

    case "beats-prepare": {
      const promptDir = argValue("--prompt-dir") ?? `/tmp/beat-prompts-${novel}`
      const batchSize = argValue("--batch-size") ?? "5"
      await $`${py} ${join(base, "segment-beats.py")} prepare --novel ${novel} --prompt-dir ${promptDir} --batch-size ${batchSize}`
      console.log(`\nNEXT: dispatch Claude Code sub-agents to process ${promptDir}/`)
      console.log(`      Then: bun scripts/corpus/run.ts --novel ${novel} --stage beats-merge --results-dir <results-dir>`)
      break
    }

    case "beats-merge": {
      const resultsDir = argValue("--results-dir")
      if (!resultsDir) { console.error("--results-dir required"); process.exit(1) }
      await $`${py} ${join(base, "segment-beats.py")} merge --novel ${novel} --results-dir ${resultsDir}`
      break
    }

    case "briefs-prepare": {
      const promptDir = argValue("--prompt-dir") ?? `/tmp/brief-prompts-${novel}`
      const batchSize = argValue("--batch-size") ?? "10"
      await $`${py} ${join(base, "extract-briefs.py")} prepare --novel ${novel} --prompt-dir ${promptDir} --batch-size ${batchSize}`
      console.log(`\nNEXT: dispatch Claude Code sub-agents, then: briefs-merge --results-dir <results-dir>`)
      break
    }

    case "briefs-merge": {
      const resultsDir = argValue("--results-dir")
      if (!resultsDir) { console.error("--results-dir required"); process.exit(1) }
      await $`${py} ${join(base, "extract-briefs.py")} merge --novel ${novel} --results-dir ${resultsDir}`
      break
    }

    case "verify":
      await $`${py} ${join(base, "verify-pipeline.py")} --novel ${novel}`
      break

    case "list": {
      // List bundle files + stage completion status
      const files = [
        "canonical.txt (stage 1)",
        "scenes.jsonl (stage 2)",
        "beats.jsonl (stage 3)",
        "pairs.jsonl (stage 4)",
      ]
      console.log(`Bundle: ${bundleDir}`)
      for (const f of files) {
        const path = join(bundleDir, f.split(" ")[0])
        const status = existsSync(path) ? "✅ present" : "❌ missing"
        console.log(`  ${f.padEnd(30)} ${status}`)
      }
      break
    }

    case "structure-extract": {
      const book = argValue("--book")
      if (!book) { console.error("--book required for structure-* stages"); process.exit(1) }
      await structureExtract(novel, book, dimsFromArgs())
      break
    }

    case "structure-sample": {
      const book = argValue("--book")
      if (!book) { console.error("--book required for structure-* stages"); process.exit(1) }
      await structureSample(novel, book, dimsFromArgs())
      break
    }

    case "structure-judge": {
      const book = argValue("--book")
      if (!book) { console.error("--book required for structure-* stages"); process.exit(1) }
      await structureJudge(novel, book, dimsFromArgs())
      break
    }

    case "structure-calibrate": {
      const book = argValue("--book")
      if (!book) { console.error("--book required for structure-* stages"); process.exit(1) }
      await structureCalibrate(novel, book, dimsFromArgs())
      break
    }

    case "structure-all": {
      const book = argValue("--book")
      if (!book) { console.error("--book required for structure-* stages"); process.exit(1) }
      const dims = dimsFromArgs()
      console.log(`\n=== structure-all: novel=${novel} book=${book} dims=${dims.join(",")} ===`)
      await structureExtract(novel, book, dims)
      await structureSample(novel, book, dims)
      await structureJudge(novel, book, dims)
      await structureCalibrate(novel, book, dims)
      console.log(`\n=== structure-all complete — verdict in novels/${novel}/structure-calibration/ ===`)
      break
    }

    default:
      console.error(`Unknown stage: ${stage}`)
      process.exit(1)
  }
}

await main()
