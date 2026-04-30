/**
 * Run-stamp utilities for the corpus structural-analysis pipeline.
 *
 * Convention (per memory `feedback_no_overwrite_runs.md`, 2026-04-29):
 *   <base>.<stamp>[.<variant>].<ext>
 *   stamp = `YYYYMMDDTHHMMSS` UTC
 *   variant = optional sub-tag, e.g. `pro`, `flash`, `sonnet`
 *
 * Examples:
 *   promises.20260429T2138.json
 *   promises.20260429T2138.pro.json
 *   value-charge.20260429T1539.jsonl
 *   promise-gold.20260429T2150.jsonl
 *   promise-gold.20260429T2150.flash.jsonl
 *
 * Output files are immutable: re-running an experiment writes a NEW
 * stamped file. The latest-stamp glob is the way to find "current".
 *
 * Legacy un-stamped paths (`promises.json`, `promise-gold.jsonl`, …) are
 * preserved as a read-only fallback so existing tooling and analysis
 * docs that reference them keep working until migration completes.
 */

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const STAMP_RE = /^(\d{8}T\d{6})$/

/** UTC `YYYYMMDDTHHMMSS` stamp for the current moment (or a passed Date). */
export function nowStamp(d: Date = new Date()): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0")
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0")
  const da = d.getUTCDate().toString().padStart(2, "0")
  const h = d.getUTCHours().toString().padStart(2, "0")
  const mi = d.getUTCMinutes().toString().padStart(2, "0")
  const s = d.getUTCSeconds().toString().padStart(2, "0")
  return `${y}${mo}${da}T${h}${mi}${s}`
}

export interface StampedFile {
  path: string
  stamp: string
  variant: string | null
}

/** Find files matching `<base>.<stamp>[.<variant>].<ext>` in `dir`. Returns
 *  sorted DESC by stamp (latest first). When `variant` is null, only files
 *  with NO variant match. When `variant` is a string, only that exact
 *  variant matches. */
export function findStamped(opts: {
  dir: string
  base: string
  variant?: string | null
  ext: string
}): StampedFile[] {
  const { dir, base, ext } = opts
  const wantVariant = opts.variant ?? null
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return [] }
  const out: StampedFile[] = []
  for (const f of entries) {
    if (!f.startsWith(`${base}.`) || !f.endsWith(`.${ext}`)) continue
    const middle = f.slice(base.length + 1, f.length - ext.length - 1)
    const dot = middle.indexOf(".")
    let stamp: string
    let variant: string | null
    if (dot === -1) { stamp = middle; variant = null }
    else { stamp = middle.slice(0, dot); variant = middle.slice(dot + 1) }
    if (!STAMP_RE.test(stamp)) continue
    if (wantVariant !== variant) continue
    out.push({ path: join(dir, f), stamp, variant })
  }
  out.sort((a, b) => b.stamp.localeCompare(a.stamp))
  return out
}

export function findLatestStamped(opts: {
  dir: string
  base: string
  variant?: string | null
  ext: string
}): StampedFile | null {
  return findStamped(opts)[0] ?? null
}

/** Resolve a stamped input file with legacy fallback.
 *  - If a stamped match exists, return the latest one with `source: "stamped"`.
 *  - Else if the legacy un-stamped path `<base>[.<variant>].<ext>` exists,
 *    return it with `source: "legacy"` and `stamp: null`.
 *  - Else null.
 *
 *  Use `requireStamp: true` to disable the legacy fallback (strict mode). */
export function resolveLatestInput(opts: {
  dir: string
  base: string
  variant?: string | null
  ext: string
  requireStamp?: boolean
}): { path: string; stamp: string | null; source: "stamped" | "legacy" } | null {
  const latest = findLatestStamped(opts)
  if (latest) return { path: latest.path, stamp: latest.stamp, source: "stamped" }
  if (opts.requireStamp) return null
  const variant = opts.variant ?? null
  const legacyName = variant === null ? `${opts.base}.${opts.ext}` : `${opts.base}.${variant}.${opts.ext}`
  const legacyPath = join(opts.dir, legacyName)
  if (existsSync(legacyPath)) return { path: legacyPath, stamp: null, source: "legacy" }
  return null
}

/** Resolve a stamped input by an explicit stamp.
 *  Useful when a downstream script wants to pin against a specific run.
 *  Returns null if no matching file exists. */
export function resolveExactStamp(opts: {
  dir: string
  base: string
  variant?: string | null
  ext: string
  stamp: string
}): { path: string; stamp: string; variant: string | null } | null {
  const variant = opts.variant ?? null
  const filename = variant === null
    ? `${opts.base}.${opts.stamp}.${opts.ext}`
    : `${opts.base}.${opts.stamp}.${variant}.${opts.ext}`
  const path = join(opts.dir, filename)
  return existsSync(path) ? { path, stamp: opts.stamp, variant } : null
}

/** Build a stamped output path. */
export function stampedPath(opts: {
  dir: string
  base: string
  stamp: string
  variant?: string | null
  ext: string
}): string {
  const variant = opts.variant ?? null
  const filename = variant === null
    ? `${opts.base}.${opts.stamp}.${opts.ext}`
    : `${opts.base}.${opts.stamp}.${variant}.${opts.ext}`
  return join(opts.dir, filename)
}
