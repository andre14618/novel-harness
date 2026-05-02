/**
 * Pure helpers for breaking A/B halluc-ungrounded results down by class.
 *
 * Classes are derived from input-fixture metadata that the labeled current-surface
 * panel and the L12 expanded fail-classes panel both already emit:
 *   - synthetic rows  → fixture_class (e.g. "synthetic_entity_insertion",
 *                       "title-surname", "named-institution", "named-place-realm",
 *                       "named-artifact", "generic-document-fp-control",
 *                       "synthetic_event_omission") with optional entity_class refinement
 *   - natural rows    → "natural_<gold.calibration_status>"
 *                       (TN, FN, TP, MIXED) so per-class signal in production
 *                       prose is still surfaced.
 *
 * Keeping this pure (no I/O, no LLM) lets the A/B reporter and a focused unit
 * test share the same code path.
 */

export interface AbInputRow {
  case_role?: string
  fixture_class?: string
  entity_class?: string | null
  gold?: {
    calibration_status?: string
    expected_pass?: boolean | null
  }
}

export interface AbResultRow {
  fixture_id: string
  case_role?: string
  calibration_status: "TP" | "FP" | "FN" | "TN" | "ERROR"
  fixture_class?: string
  entity_class?: string | null
  natural_gold_status?: string
}

export interface ClassCounts {
  TP: number
  FP: number
  FN: number
  TN: number
  ERROR: number
}

export interface PerClassEntry extends ClassCounts {
  class: string
  n: number
  recall_pct: number | null
  precision_pct: number | null
  f1_pct: number | null
}

const ZERO: ClassCounts = { TP: 0, FP: 0, FN: 0, TN: 0, ERROR: 0 }

function emptyCounts(): ClassCounts {
  return { ...ZERO }
}

/**
 * Resolve the class label for one row.
 *
 * Synthetic rows prefer `fixture_class`; if `entity_class` is also present
 * (e.g. expanded-class panels that refine within `synthetic_entity_insertion`)
 * the label is `<fixture_class>::<entity_class>` so subclasses do not collapse.
 *
 * Natural rows use `natural_<gold.calibration_status>`. When the natural row
 * has no calibration_status, the label falls back to `natural_unlabeled`.
 *
 * Anything else falls back to `unclassified` rather than throwing — the caller
 * can spot the class in the matrix and fix metadata upstream.
 */
export function deriveClass(row: AbInputRow): string {
  if (row.case_role === "synthetic_fixture") {
    const fixture = row.fixture_class ?? "synthetic_unknown"
    const entity = row.entity_class
    return entity && entity.trim().length > 0 ? `${fixture}::${entity}` : fixture
  }
  if (row.case_role === "current_surface_natural") {
    const status = row.gold?.calibration_status
    return status ? `natural_${status}` : "natural_unlabeled"
  }
  if (row.fixture_class) return row.fixture_class
  return "unclassified"
}

/**
 * Build per-class counts from joined (input + result) rows.
 *
 * Returns entries sorted by class name so output is deterministic.
 */
export function summarizeByClass(
  joined: Array<{ input: AbInputRow; result: AbResultRow }>,
): PerClassEntry[] {
  const buckets = new Map<string, ClassCounts>()
  for (const { input, result } of joined) {
    const cls = deriveClass(input)
    if (!buckets.has(cls)) buckets.set(cls, emptyCounts())
    const counts = buckets.get(cls)!
    counts[result.calibration_status] += 1
  }

  const entries: PerClassEntry[] = []
  for (const [cls, c] of buckets) {
    const truthFail = c.TP + c.FN
    const candidateFire = c.TP + c.FP
    const recall = truthFail > 0 ? (c.TP / truthFail) * 100 : null
    const precision = candidateFire > 0 ? (c.TP / candidateFire) * 100 : null
    const f1 =
      recall !== null && precision !== null && recall + precision > 0
        ? (2 * recall * precision) / (recall + precision)
        : null
    entries.push({
      class: cls,
      n: c.TP + c.FP + c.FN + c.TN + c.ERROR,
      TP: c.TP,
      FP: c.FP,
      FN: c.FN,
      TN: c.TN,
      ERROR: c.ERROR,
      recall_pct: recall === null ? null : Math.round(recall * 10) / 10,
      precision_pct: precision === null ? null : Math.round(precision * 10) / 10,
      f1_pct: f1 === null ? null : Math.round(f1 * 10) / 10,
    })
  }

  entries.sort((a, b) => a.class.localeCompare(b.class))
  return entries
}

function fmtNum(v: number | null): string {
  return v === null ? "n/a" : `${v.toFixed(1)}%`
}

/**
 * Render a per-class breakdown as a fixed-width markdown table.
 * Pure string transform so a unit test can pin the layout exactly.
 */
export function formatPerClassTable(entries: PerClassEntry[]): string {
  const headers = ["class", "n", "TP", "FP", "FN", "TN", "ERR", "recall", "precision", "F1"]
  const rows = entries.map(e => [
    e.class,
    String(e.n),
    String(e.TP),
    String(e.FP),
    String(e.FN),
    String(e.TN),
    String(e.ERROR),
    fmtNum(e.recall_pct),
    fmtNum(e.precision_pct),
    fmtNum(e.f1_pct),
  ])
  if (rows.length === 0) {
    return "(no rows)"
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  const sep = widths.map(w => "-".repeat(w + 2)).join("+")
  const header = "| " + headers.map((h, i) => h.padEnd(widths[i])).join(" | ") + " |"
  const out = [header, "|-" + sep + "-|"]
  for (const r of rows) {
    out.push("| " + r.map((v, i) => v.padEnd(widths[i])).join(" | ") + " |")
  }
  return out.join("\n")
}
