import { readFile } from "node:fs/promises"

interface DocWeightRule {
  path: string
  maxLines: number
  hint: string
}

const rules: DocWeightRule[] = [
  {
    path: "docs/current-state.md",
    maxLines: 180,
    hint:
      "Keep only live truth here; move active detail to docs/reference/ and history to docs/archive/.",
  },
  {
    path: "docs/decisions.md",
    maxLines: 250,
    hint: "Keep this as an index; put full rationale in docs/decisions/LNNN-*.md.",
  },
  {
    path: "docs/sessions/lane-queue.md",
    maxLines: 220,
    hint: "Keep only active/next work; move detailed completed history to session records or archive snapshots.",
  },
  {
    path: "docs/todo.md",
    maxLines: 150,
    hint: "Keep only actionable backlog items; move historical or parked work to archive/features docs.",
  },
  {
    path: "AGENTS.md",
    maxLines: 120,
    hint: "Keep agent instructions short and link to deeper context.",
  },
  {
    path: "CLAUDE.md",
    maxLines: 180,
    hint: "Keep Claude instructions durable; move live status and detailed rationale into linked docs.",
  },
]

export async function checkDocWeight(
  docRules: readonly DocWeightRule[] = rules,
): Promise<Array<{ path: string; lines: number; maxLines: number; hint: string }>> {
  const failures: Array<{ path: string; lines: number; maxLines: number; hint: string }> = []
  for (const rule of docRules) {
    const content = await readFile(rule.path, "utf8")
    const lines = content.endsWith("\n")
      ? content.slice(0, -1).split("\n").length
      : content.split("\n").length
    if (lines > rule.maxLines) {
      failures.push({ path: rule.path, lines, maxLines: rule.maxLines, hint: rule.hint })
    }
  }
  return failures
}

if (import.meta.main) {
  const failures = await checkDocWeight()
  if (failures.length === 0) {
    console.log("doc weight ok")
  } else {
    for (const failure of failures) {
      console.error(
        `${failure.path}: ${failure.lines} lines exceeds ${failure.maxLines}. ${failure.hint}`,
      )
    }
    process.exitCode = 1
  }
}
