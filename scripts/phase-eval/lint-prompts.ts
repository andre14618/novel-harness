/**
 * Prompt-change lint for phase-eval variants.
 *
 * Codex review (2026-05-01) Do-Now item 4: surface the three classes of
 * prompt-change drift that have caused silent regressions in the past.
 *
 * Three checks:
 *
 *   A) DEFAULT-DRIFT (ERROR): every `scripts/phase-eval/variants/<role>/
 *      default.md` MUST be byte-equal to the corresponding live prompt
 *      under `src/agents/<role>/<system>.md`. The "default" variant is
 *      the experimental control — if it drifts, every A/B/C run that
 *      cites it as baseline is comparing against the wrong prompt.
 *
 *   B) NEG-PRIME (WARN): explicit X-OR-Y prohibitions that enumerate
 *      the forbidden tokens in scare quotes. The 2026-04-20 Salvatore
 *      blocklist A/B (memory: feedback_priming_suppression_ab) showed
 *      that REMOVING such warnings doubled absolute fire rate (+10.5
 *      pts worse) — so we don't auto-strip them, but new ones added
 *      to a prompt should be A/B'd before shipping. The lint emits
 *      a warning surface; developers triage.
 *
 *   C) STALENESS (WARN): variant prompt's last-touched commit is
 *      older than the corresponding live prompt by >= STALE_DAYS.
 *      Heuristic only — variant intent may legitimately diverge —
 *      but a 60-day-old variant tested against a live prompt that
 *      moved last week is usually a stale experiment, not a clean A/B.
 *
 * Usage:
 *   bun scripts/phase-eval/lint-prompts.ts        # report + exit 1 if ERROR
 *   bun scripts/phase-eval/lint-prompts.ts --warn-only  # never exit non-zero
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs"
import { join, resolve, relative } from "node:path"
import { execSync } from "node:child_process"

// Variant directory name -> live prompt file path (repo-relative).
// Add an entry here when introducing a new variant role; the lint
// will skip roles not in this map (with a single info-level note).
export const ROLE_TO_LIVE_PROMPT: Record<string, string> = {
  "planning-scenes": "src/agents/planning-scenes/scene-expansion-system.md",
  "planning-plotter": "src/agents/planning-plotter/chapter-outline-system.md",
  "planning-state-mapper": "src/agents/planning-state-mapper/state-mapper-system.md",
}

const STALE_DAYS = 30

export interface Finding {
  kind: "ERROR" | "WARN" | "INFO"
  check: "default-drift" | "neg-prime" | "staleness" | "config"
  file: string
  line?: number
  message: string
}

export function checkDefaultDrift(repoRoot: string): Finding[] {
  const findings: Finding[] = []
  const variantsDir = join(repoRoot, "scripts/phase-eval/variants")
  if (!existsSync(variantsDir)) return findings

  for (const role of readdirSync(variantsDir)) {
    const roleDir = join(variantsDir, role)
    if (!statSync(roleDir).isDirectory()) continue

    const livePath = ROLE_TO_LIVE_PROMPT[role]
    if (!livePath) {
      findings.push({
        kind: "INFO",
        check: "config",
        file: relative(repoRoot, roleDir),
        message: `variant role "${role}" has no live-prompt mapping in ROLE_TO_LIVE_PROMPT — drift check skipped`,
      })
      continue
    }

    const defaultPath = join(roleDir, "default.md")
    if (!existsSync(defaultPath)) continue  // role may not have a default

    const livePathAbs = join(repoRoot, livePath)
    if (!existsSync(livePathAbs)) {
      findings.push({
        kind: "ERROR",
        check: "config",
        file: relative(repoRoot, defaultPath),
        message: `live prompt at ${livePath} does not exist (mapping in ROLE_TO_LIVE_PROMPT is stale)`,
      })
      continue
    }

    const liveSrc = readFileSync(livePathAbs, "utf8")
    const defaultSrc = readFileSync(defaultPath, "utf8")
    if (liveSrc !== defaultSrc) {
      findings.push({
        kind: "ERROR",
        check: "default-drift",
        file: relative(repoRoot, defaultPath),
        message: `default.md drifts from live prompt at ${livePath} — re-sync (cp ${livePath} ${relative(repoRoot, defaultPath)}) or rename if intentional baseline`,
      })
    }
  }
  return findings
}

// Negative-priming pattern: a prohibition trigger ("NEVER", "Do not",
// "Avoid"...) followed by a verb of production (use/say/write/emit...),
// then within ~100 chars a list of >=2 quoted strings joined by
// `or`/`,`/`/`. The trigger+verb gate keeps us from flagging GOOD-
// example lists (e.g. "characters like 'Kael Voss', 'Senna Dray'")
// or illustrative parentheticals like "(refuse, reveal, sacrifice)".
//
// Examples that fire (correctly):
//   NEVER use filter words: "realized", "noticed"
//   Do not pair a verb with: "softly", "loudly"
//   avoid saying "rich" or "wealthy"
const NEG_PRIME_RE =
  /\b(?:NEVER|do not|don'?t|must not|avoid|forbidden|stop)\s+(?:use|say|write|include|emit|output|pair|hedge|open|add|put|give|insert|begin|start|nest|repeat|contain|combine)\b[^.\n]{0,100}["'][^"'\n]+["']\s*(?:or|,|\/)\s*["'][^"'\n]+["']/gi

export function checkNegPriming(repoRoot: string): Finding[] {
  const findings: Finding[] = []
  const targets: string[] = []

  // Live prompts.
  const agentsDir = join(repoRoot, "src/agents")
  if (existsSync(agentsDir)) {
    for (const role of readdirSync(agentsDir)) {
      const roleDir = join(agentsDir, role)
      if (!statSync(roleDir).isDirectory()) continue
      for (const f of readdirSync(roleDir)) {
        if (f.endsWith(".md")) targets.push(join(roleDir, f))
      }
    }
  }

  // Variant prompts.
  const variantsDir = join(repoRoot, "scripts/phase-eval/variants")
  if (existsSync(variantsDir)) {
    for (const role of readdirSync(variantsDir)) {
      const roleDir = join(variantsDir, role)
      if (!statSync(roleDir).isDirectory()) continue
      for (const f of readdirSync(roleDir)) {
        if (f.endsWith(".md")) targets.push(join(roleDir, f))
      }
    }
  }

  for (const path of targets) {
    const src = readFileSync(path, "utf8")
    const lines = src.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      // Reset regex lastIndex per-line (RE has /g flag).
      NEG_PRIME_RE.lastIndex = 0
      if (NEG_PRIME_RE.test(line)) {
        findings.push({
          kind: "WARN",
          check: "neg-prime",
          file: relative(repoRoot, path),
          line: i + 1,
          message: `explicit X-OR-Y prohibition in scare quotes — primes the forbidden tokens (per memory feedback_priming_suppression_ab, A/B before adding new ones): ${line.trim().slice(0, 120)}`,
        })
      }
    }
  }
  return findings
}

function lastCommitISO(repoRoot: string, fileRel: string): string | null {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${fileRel}"`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

export function checkVariantStaleness(repoRoot: string, maxDays = STALE_DAYS): Finding[] {
  const findings: Finding[] = []
  const variantsDir = join(repoRoot, "scripts/phase-eval/variants")
  if (!existsSync(variantsDir)) return findings

  for (const role of readdirSync(variantsDir)) {
    const roleDir = join(variantsDir, role)
    if (!statSync(roleDir).isDirectory()) continue

    const livePath = ROLE_TO_LIVE_PROMPT[role]
    if (!livePath) continue
    const liveCommitISO = lastCommitISO(repoRoot, livePath)
    if (!liveCommitISO) continue
    const liveTime = new Date(liveCommitISO).getTime()

    for (const f of readdirSync(roleDir)) {
      if (!f.endsWith(".md")) continue
      if (f === "default.md") continue  // covered by drift check
      const variantRel = relative(repoRoot, join(roleDir, f))
      const variantCommitISO = lastCommitISO(repoRoot, variantRel)
      if (!variantCommitISO) continue  // un-tracked file: nothing to compare against
      const variantTime = new Date(variantCommitISO).getTime()
      const ageDays = (liveTime - variantTime) / (1000 * 60 * 60 * 24)
      if (ageDays >= maxDays) {
        findings.push({
          kind: "WARN",
          check: "staleness",
          file: variantRel,
          message: `variant prompt last touched ${variantCommitISO.slice(0, 10)}, but live prompt at ${livePath} moved ${liveCommitISO.slice(0, 10)} (${Math.round(ageDays)} days newer) — variant may not reflect intended delta from current production`,
        })
      }
    }
  }
  return findings
}

export function runAllChecks(repoRoot: string): Finding[] {
  return [
    ...checkDefaultDrift(repoRoot),
    ...checkNegPriming(repoRoot),
    ...checkVariantStaleness(repoRoot),
  ]
}

export function repoRootFromHere(): string {
  // scripts/phase-eval/lint-prompts.ts → repo root is two levels up.
  return resolve(import.meta.dir, "..", "..")
}

if (import.meta.main) {
  const warnOnly = process.argv.includes("--warn-only")
  const root = repoRootFromHere()
  const findings = runAllChecks(root)

  const errors = findings.filter(f => f.kind === "ERROR")
  const warns = findings.filter(f => f.kind === "WARN")
  const infos = findings.filter(f => f.kind === "INFO")

  for (const f of [...errors, ...warns, ...infos]) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file
    console.log(`[${f.kind}] [${f.check}] ${loc} — ${f.message}`)
  }

  console.log("")
  console.log(
    `Summary: ${errors.length} error(s), ${warns.length} warning(s), ${infos.length} info note(s).`
  )

  if (errors.length > 0 && !warnOnly) {
    process.exit(1)
  }
}
