/**
 * Charter discovery + frontmatter parsing.
 *
 * Charters live in docs/charters/*.md. The YAML frontmatter block (between
 * two `---` fences) declares status/kind/experiment-family/etc. This module
 * enumerates charters and exposes their metadata for the UI charter browser.
 */

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const CHARTERS_DIR = join(process.cwd(), "docs", "charters")

export interface CharterMeta {
  slug: string
  title: string
  status: string | null
  kind: string | null
  experimentFamily: string | null
  proposedBy: string | null
  proposedDate: string | null
  adversaryVerdict: string | null
  supersedes: string | null
  supersededBy: string | null
  extras: Record<string, string>
}

export interface CharterFull extends CharterMeta {
  body: string
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw }
  const end = raw.indexOf("\n---", 3)
  if (end < 0) return { meta: {}, body: raw }
  const yaml = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\n/, "")
  const meta: Record<string, string> = {}
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[m[1]] = val
  }
  return { meta, body }
}

function extractTitle(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : fallback
}

function toMeta(slug: string, raw: string): CharterFull {
  const { meta, body } = parseFrontmatter(raw)
  const knownKeys = new Set([
    "status", "kind", "experiment-family", "proposed-by",
    "proposed-date", "adversary-verdict", "supersedes", "superseded-by",
  ])
  const extras: Record<string, string> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (!knownKeys.has(k)) extras[k] = v
  }
  return {
    slug,
    title: extractTitle(body, slug),
    status: meta["status"] ?? null,
    kind: meta["kind"] ?? null,
    experimentFamily: meta["experiment-family"] ?? null,
    proposedBy: meta["proposed-by"] ?? null,
    proposedDate: meta["proposed-date"] ?? null,
    adversaryVerdict: meta["adversary-verdict"] ?? null,
    supersedes: meta["supersedes"] ?? null,
    supersededBy: meta["superseded-by"] ?? null,
    extras,
    body,
  }
}

export async function listCharters(): Promise<CharterMeta[]> {
  const entries = await readdir(CHARTERS_DIR)
  const files = entries.filter(f => f.endsWith(".md"))
  const out: CharterMeta[] = []
  for (const f of files) {
    const slug = f.replace(/\.md$/, "")
    const raw = await readFile(join(CHARTERS_DIR, f), "utf8")
    const { body, ...meta } = toMeta(slug, raw)
    out.push(meta)
  }
  out.sort((a, b) => {
    const ad = a.proposedDate ?? ""
    const bd = b.proposedDate ?? ""
    if (ad !== bd) return bd.localeCompare(ad)
    return a.slug.localeCompare(b.slug)
  })
  return out
}

export async function getCharter(slug: string): Promise<CharterFull | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return null
  try {
    const raw = await readFile(join(CHARTERS_DIR, `${slug}.md`), "utf8")
    return toMeta(slug, raw)
  } catch {
    return null
  }
}
