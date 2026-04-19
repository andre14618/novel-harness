/**
 * scripts/lib/codex-preamble.ts — generator for docs/codex-preamble.md
 *
 * Produces a compact, regeneratable preamble for Codex review calls.
 * Discipline per Codex thread `ac9d7f955daf2511d` Q3:
 *   - pointers + timestamps + 2-3 load-bearing facts
 *   - NOT a narrative mini-doc
 *   - regenerated on every Codex call (cheap enough) so staleness
 *     doesn't anchor the reviewer
 *   - hard cap <=200 lines; this script enforces it
 *
 * Usage:
 *   bun scripts/lib/codex-preamble.ts                # prints to stdout
 *   bun scripts/lib/codex-preamble.ts --emit         # writes docs/codex-preamble.md
 *
 * Sections:
 *   1. Timestamp + repo HEAD commit
 *   2. Open experiments (top N, one-line each)
 *   3. Recently closed experiments (last N days, titles only)
 *   4. Recent architectural decisions (last 7 days, titles pulled from decisions.md)
 *   5. Pattern watch-list (names + first-line descriptions from docs/patterns/)
 *   6. Repo-specific failure classes to watch for
 *   7. What this preamble OMITS (discipline line)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const EMIT = process.argv.includes("--emit")
const REPO_ROOT = resolve(import.meta.dir, "../..")
const OUT_PATH = resolve(REPO_ROOT, "docs/codex-preamble.md")

const DAYS_FOR_DECISIONS = 7
const MAX_OPEN_EXPS = 5
const MAX_CLOSED_EXPS = 5
const MAX_TOTAL_LINES = 200

// Repo-specific failure classes. These are stable across sessions — the list
// grows when a class-of-bug recurs across 2+ sessions and gets a pattern doc.
const FAILURE_CLASSES = [
  "Restart state — in-memory guards (`let flag = false`) must persist to DB if the guard is load-bearing across restarts",
  "Retry-path truth — every timeout/network failure must enter retry, no fast-fail branches",
  "Event-emission symmetry — if a state transition fires event E on branch A, branch B to the same state must also fire E",
  "Seam coverage — forced-flag injections must cover every recheck site (initial + settle-loop + recheck-after-revision)",
  "Replayable observability — don't use persisted trace events as 'happened after X' signals if the stream replays history on connect",
  "Target-runtime state validation — probe the target process's env/state directly; local process.env doesn't catch contamination in the orchestrator process",
  "Body-already-used — any template literal with `await X.text()` that is ALSO followed by `await X.json()` on the same Response object",
  "Fail-open coverage — matcher errors, applyAction errors, AND enrichment errors all need try/catch with fail-open semantics",
]

async function main() {
  const now = new Date().toISOString()
  const headSha = await gitHead()
  const lines: string[] = []

  lines.push(`# novel-harness Codex preamble — ${now}`)
  lines.push(``)
  lines.push(`> Regenerated preamble. Commit-pinned to \`${headSha}\`. Cite \`git show ${headSha}\` in any review response.`)
  lines.push(``)
  // Codex review a3af80e8eb4312169 Q4: runtime topology note so reviewers
  // don't conflate local shell state with target-runtime state (the
  // explicit failure class #6 also called out below).
  lines.push(`> **Runtime topology:** orchestrator + Postgres on the LXC host; local shell state may differ from target runtime. SSH/API probes are authoritative.`)
  lines.push(``)

  // ── 1. Experiments ──────────────────────────────────────────────────
  const expFetch = await fetchExperiments()
  if (!expFetch.ok) {
    // Codex review a3af80e8eb4312169 Q3/MEDIUM: surface unavailability
    // explicitly. A silent "(none)" is a false signal.
    lines.push(`## Open experiments`)
    lines.push(`- unavailable (SSH/DB fetch failed: ${truncate(expFetch.reason ?? "unknown", 100)})`)
    lines.push(``)
    lines.push(`## Recently closed (top ${MAX_CLOSED_EXPS})`)
    lines.push(`- unavailable (SSH/DB fetch failed)`)
    lines.push(``)
  } else {
    const { open, open_total, recent } = expFetch
    lines.push(`## Open experiments (${open_total})`)
    if (open_total === 0) {
      lines.push(`- none`)
    } else {
      for (const e of open.slice(0, MAX_OPEN_EXPS)) {
        lines.push(`- #${e.id} [${e.experiment_type}] ${truncate(e.description, 120)}`)
      }
      if (open_total > MAX_OPEN_EXPS) lines.push(`- …${open_total - MAX_OPEN_EXPS} more (query tuning_experiments WHERE conclusion IS NULL)`)
    }
    lines.push(``)

    lines.push(`## Recently closed (top ${MAX_CLOSED_EXPS})`)
    for (const e of recent.slice(0, MAX_CLOSED_EXPS)) {
      lines.push(`- #${e.id} [${e.experiment_type}] ${truncate(e.description, 120)}`)
    }
    lines.push(``)
  }

  // ── 2. Architectural decisions (titles from decisions.md) ───────────
  lines.push(`## Architectural decisions (last ${DAYS_FOR_DECISIONS} days)`)
  const recentDecisions = extractRecentDecisionTitles(DAYS_FOR_DECISIONS)
  if (recentDecisions.length === 0) {
    lines.push(`- none`)
  } else {
    for (const d of recentDecisions.slice(0, 10)) lines.push(`- ${d}`)
    if (recentDecisions.length > 10) lines.push(`- …${recentDecisions.length - 10} more (see docs/decisions.md)`)
  }
  lines.push(``)

  // ── 3. Pattern watch-list ───────────────────────────────────────────
  lines.push(`## Pattern watch-list (docs/patterns/)`)
  const patterns = listPatterns()
  if (patterns.length === 0) {
    lines.push(`- none`)
  } else {
    for (const p of patterns) lines.push(`- ${p.slug} — ${p.summary}`)
  }
  lines.push(``)

  // ── 4. Failure classes ──────────────────────────────────────────────
  lines.push(`## Repo-specific failure classes to look for`)
  for (let i = 0; i < FAILURE_CLASSES.length; i++) {
    lines.push(`${i + 1}. ${FAILURE_CLASSES[i]}`)
  }
  lines.push(``)

  // ── 5. OMITS discipline line ────────────────────────────────────────
  lines.push(`## What this preamble OMITS (cite repo refs on demand)`)
  lines.push(`- Full architecture narrative → \`CLAUDE.md\` + \`docs/current-state.md\` + \`/app/guide\``)
  lines.push(`- Specific bug details → commit refs + \`git show <sha>\``)
  lines.push(`- Session retrospectives → \`docs/sessions/YYYY-MM-DD-*.md\``)
  lines.push(`- Full pattern docs → \`docs/patterns/<slug>.md\``)
  lines.push(`- Full decisions rationale → \`docs/decisions.md\` (titles above, full bodies there)`)
  lines.push(``)

  // ── Line count enforcement ──────────────────────────────────────────
  if (lines.length > MAX_TOTAL_LINES) {
    console.error(`[codex-preamble] WARN: preamble is ${lines.length} lines, exceeds cap of ${MAX_TOTAL_LINES}. Shorten the sections above.`)
    process.exit(3)
  }

  const content = lines.join("\n") + "\n"
  if (EMIT) {
    writeFileSync(OUT_PATH, content)
    console.error(`[codex-preamble] Wrote ${OUT_PATH} (${lines.length} lines)`)
  } else {
    process.stdout.write(content)
  }
  process.exit(0)
}

// ── Helpers ────────────────────────────────────────────────────────────

async function gitHead(): Promise<string> {
  const r = await Bun.$`git -C ${REPO_ROOT} rev-parse --short HEAD`.quiet().nothrow()
  return r.exitCode === 0 ? r.stdout.toString().trim() : "unknown"
}

interface ExpRow { id: number; experiment_type: string; description: string; timestamp: string }
interface ExpFetch {
  ok: boolean
  reason?: string
  open: ExpRow[]
  open_total: number    // distinct from open.length — may be capped below real count
  recent: ExpRow[]
}

async function fetchExperiments(): Promise<ExpFetch> {
  // Run via SSH on LXC (Postgres is there, not on local machine).
  // Codex review a3af80e8eb4312169 LOW: separate COUNT(*) so header isn't
  // capped silently when open rows >20.
  const cmd = `cd ~/apps/novel-harness && bun -e '
    import db from "./src/db/connection"
    const open = await db\`SELECT id, experiment_type, description, timestamp FROM tuning_experiments WHERE conclusion IS NULL ORDER BY id DESC LIMIT 20\`
    const [openCount] = await db\`SELECT COUNT(*)::int AS n FROM tuning_experiments WHERE conclusion IS NULL\`
    const recent = await db\`SELECT id, experiment_type, description, timestamp FROM tuning_experiments WHERE conclusion IS NOT NULL ORDER BY timestamp DESC LIMIT 10\`
    console.log(JSON.stringify({ open, open_total: openCount.n, recent }))
    process.exit(0)
  '`
  const r = await Bun.$`ssh novel-harness-lxc ${cmd}`.quiet().nothrow()
  if (r.exitCode !== 0) {
    const reason = r.stderr.toString().slice(0, 200).trim() || `exit ${r.exitCode}`
    console.error(`[codex-preamble] warning: experiment fetch failed — ${reason}`)
    return { ok: false, reason, open: [], open_total: 0, recent: [] }
  }
  try {
    const parsed = JSON.parse(r.stdout.toString()) as Omit<ExpFetch, "ok">
    return { ok: true, ...parsed }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: false, reason, open: [], open_total: 0, recent: [] }
  }
}

function extractRecentDecisionTitles(days: number): string[] {
  const path = resolve(REPO_ROOT, "docs/decisions.md")
  if (!existsSync(path)) return []
  const content = readFileSync(path, "utf8")
  const cutoff = new Date(Date.now() - days * 24 * 3_600_000)

  // Parse entries. Format per docs/decisions.md: each entry starts with
  // `### Title` followed on the next non-blank line by `*YYYY-MM-DD · …*`.
  //
  // Codex review a3af80e8eb4312169 Q2/MEDIUM: parse into {title, date}
  // pairs and sort descending by date BEFORE the caller truncates.
  // docs/decisions.md is not fully reverse-chronological; without this
  // sort, newer entries can be dropped in favor of file-order precedence.
  const lines = content.split("\n")
  const parsed: { title: string; date: string; dateObj: Date }[] = []
  for (let i = 0; i < lines.length; i++) {
    const titleMatch = lines[i].match(/^### (.+)$/)
    if (!titleMatch) continue
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const dateMatch = lines[j].match(/^\*(\d{4}-\d{2}-\d{2})/)
      if (dateMatch) {
        const entryDate = new Date(dateMatch[1])
        if (entryDate >= cutoff) {
          parsed.push({ title: titleMatch[1], date: dateMatch[1], dateObj: entryDate })
        }
        break
      }
    }
  }
  parsed.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())
  return parsed.map(p => `${p.title} (${p.date})`)
}

interface PatternEntry { slug: string; summary: string }

function listPatterns(): PatternEntry[] {
  const dir = resolve(REPO_ROOT, "docs/patterns")
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => f.endsWith(".md") && f !== "README.md" && f !== "TEMPLATE.md")
  const out: PatternEntry[] = []
  for (const f of files) {
    const slug = f.replace(/\.md$/, "")
    const content = readFileSync(resolve(dir, f), "utf8")
    // Grab the first PROSE line after the main `# …` heading — skip
    // sub-headings (##, ###), frontmatter bars (---), blockquotes (>),
    // and empty lines. Targets the first sentence of the first real
    // paragraph so the summary is actually load-bearing.
    const headingIdx = content.search(/^# /m)
    if (headingIdx < 0) continue
    const after = content.slice(headingIdx).split("\n").slice(1).find(l => {
      const t = l.trim()
      return t.length > 0 && !t.startsWith("#") && !t.startsWith("---") && !t.startsWith(">")
    }) ?? ""
    out.push({ slug, summary: truncate(after.replace(/^\*\*[^*]+\*\*:?\s*/, "").trim(), 100) })
  }
  return out
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim()
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean
}

await main()
