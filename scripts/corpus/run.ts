#!/usr/bin/env bun
/**
 * Corpus pipeline orchestrator. Runs stages of the pipeline against a bundle.
 *
 * Usage:
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage scenes
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage beats-prepare
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage beats-merge --results-dir /tmp/beat-results
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage briefs-prepare
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage briefs-merge --results-dir /tmp/brief-results
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage verify
 *   bun scripts/corpus/run.ts --novel salvatore-icewind-dale --stage list
 */

import { $ } from "bun"
import { existsSync } from "fs"
import { join } from "path"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

async function main() {
  const novel = argValue("--novel")
  const stage = argValue("--stage")
  if (!novel || !stage) {
    console.error("Usage: bun scripts/corpus/run.ts --novel <key> --stage <stage>")
    console.error("Stages: scenes, beats-prepare, beats-merge, briefs-prepare, briefs-merge, verify, list")
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

    default:
      console.error(`Unknown stage: ${stage}`)
      process.exit(1)
  }
}

await main()
