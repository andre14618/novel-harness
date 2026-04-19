/**
 * Allowlist loader for `scripts/lint/invariants-check.ts`.
 *
 * Reads `.claude/invariants-allowlist.yaml` and returns the active entries.
 * Contract:
 *   - Fail-CLOSED on missing file (return [] + emit single warning). The
 *     checker will then run with zero exceptions.
 *   - Rejects entries with `expires` in the past (print offending entry,
 *     exit 1). Renewing requires editing the YAML + re-justifying reason.
 *   - Returns the raw entries; callers decide how to honor them.
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { parse as parseYaml } from "yaml"

export interface AllowlistEntry {
  invariant: string
  file: string
  line: number
  reason: string
  added?: string
  expires: string
  owner?: string
}

const DEFAULT_PATH = ".claude/invariants-allowlist.yaml"

export function loadAllowlist(path: string = DEFAULT_PATH): AllowlistEntry[] {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) {
    console.warn(
      `invariants-allowlist: file not found at ${path} — running fail-closed with zero exceptions.`,
    )
    return []
  }
  const raw = readFileSync(abs, "utf8")
  const parsed = parseYaml(raw)
  if (parsed == null) return []
  // Accept either a top-level list OR an object with `entries: [...]`.
  let doc: unknown[]
  if (Array.isArray(parsed)) {
    doc = parsed
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    doc = (parsed as { entries: unknown[] }).entries
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { entries?: unknown }).entries == null
  ) {
    // Object with no `entries` key, or `entries: null` — treat as empty.
    return []
  } else {
    console.error(
      `invariants-allowlist: expected a YAML list or { entries: [...] } at top level of ${path}; got ${typeof parsed}.`,
    )
    process.exit(1)
  }
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const entries: AllowlistEntry[] = []
  for (const [idx, item] of doc.entries()) {
    if (item == null || typeof item !== "object") {
      console.error(`invariants-allowlist: entry #${idx} is not an object.`)
      process.exit(1)
    }
    const e = item as Partial<AllowlistEntry>
    const missing: string[] = []
    for (const k of ["invariant", "file", "line", "reason", "expires"] as const) {
      if (e[k] == null) missing.push(k)
    }
    if (missing.length > 0) {
      console.error(
        `invariants-allowlist: entry #${idx} missing required field(s): ${missing.join(", ")}.`,
      )
      process.exit(1)
    }
    const exp = new Date(String(e.expires))
    if (Number.isNaN(exp.getTime())) {
      console.error(
        `invariants-allowlist: entry #${idx} has unparseable expires=${e.expires}. Use YYYY-MM-DD.`,
      )
      process.exit(1)
    }
    if (exp.getTime() < today.getTime()) {
      console.error(
        `invariants-allowlist: entry #${idx} EXPIRED on ${e.expires}.\n` +
          `  invariant: ${e.invariant}\n  file: ${e.file}:${e.line}\n` +
          `  Renew by editing the YAML with a fresh 30-day expiry + updated reason, or remove the entry.`,
      )
      process.exit(1)
    }
    entries.push({
      invariant: String(e.invariant),
      file: String(e.file),
      line: Number(e.line),
      reason: String(e.reason),
      added: e.added ? String(e.added) : undefined,
      expires: String(e.expires),
      owner: e.owner ? String(e.owner) : undefined,
    })
  }
  return entries
}

/**
 * Returns true if a (invariant, file, line) tuple is allowlisted.
 * Line match is approximate — within ±5 of any entry for the same
 * (invariant, file) pair.
 */
export function isAllowlisted(
  entries: AllowlistEntry[],
  invariant: string,
  file: string,
  line: number,
): AllowlistEntry | undefined {
  return entries.find(
    (e) =>
      e.invariant === invariant &&
      e.file === file &&
      Math.abs(e.line - line) <= 5,
  )
}
