/**
 * Unit tests for the docs-impact preflight pure helpers.
 *
 * Covers `isRuntimeFile`, `classifyStagedFiles`, `commitMessageDeclaresNoDocs`,
 * and `evaluate`. The CLI / git-shell-out path is not unit-tested — it would
 * require committing fake state and is exercised by manual smoke when wiring
 * the script into a hook.
 */

import { describe, expect, test } from "bun:test"
import {
  isRuntimeFile,
  classifyStagedFiles,
  commitMessageDeclaresNoDocs,
  evaluate,
} from "./preflight-docs-impact"

// ── isRuntimeFile ─────────────────────────────────────────────────────────

describe("isRuntimeFile", () => {
  test.each([
    "src/agents/halluc-ungrounded/index.ts",
    "src/agents/writer/adherence-checker.ts",
    "src/phases/beat-checks.ts",
    "src/lint/entity-candidates.ts",
    "src/llm.ts",
    "src/transport.ts",
    "src/models/roles.ts",
    "src/models/registry.ts",
    "src/config/pipeline.ts",
    "sql/034_llm_call_ner_prepass.sql",
  ])("classifies %s as runtime", (path) => {
    expect(isRuntimeFile(path)).toBe(true)
  })

  test.each([
    "docs/decisions.md",
    "docs/todo.md",
    "docs/current-state.md",
    "scripts/phase-eval/list-runs.ts",
    "scripts/hallucination/run-ab-events-system-panel.ts",
    "src/db/connection.ts",
    "src/harness/experiments.ts",
    "src/models/types.ts",
    "src/schemas/planning-state.ts",
    "tests/phase-parity/phase-parity.test.ts",
    "src/agents/halluc-ungrounded/index.test.ts",
    "README.md",
    "CLAUDE.md",
  ])("classifies %s as NOT runtime", (path) => {
    expect(isRuntimeFile(path)).toBe(false)
  })
})

// ── classifyStagedFiles ───────────────────────────────────────────────────

describe("classifyStagedFiles", () => {
  test("partitions runtime vs doc files", () => {
    const r = classifyStagedFiles([
      "src/agents/foo/index.ts",
      "docs/current-state.md",
      "docs/decisions.md",
      "src/db/connection.ts",
    ])
    expect(r.runtime).toEqual(["src/agents/foo/index.ts"])
    expect(r.docs).toEqual(["docs/current-state.md"])
  })

  test("empty input → empty buckets", () => {
    const r = classifyStagedFiles([])
    expect(r.runtime).toEqual([])
    expect(r.docs).toEqual([])
  })

  test("decisions.md does NOT count as a discipline-satisfying doc", () => {
    const r = classifyStagedFiles(["docs/decisions.md"])
    expect(r.docs).toEqual([])
  })
})

// ── commitMessageDeclaresNoDocs ──────────────────────────────────────────

describe("commitMessageDeclaresNoDocs", () => {
  test("matches `docs-impact: none` on its own line", () => {
    expect(commitMessageDeclaresNoDocs("Subject\n\nBody\n\ndocs-impact: none\n")).toBe(true)
  })

  test("matches case-insensitive", () => {
    expect(commitMessageDeclaresNoDocs("Subject\n\nDocs-Impact: NONE")).toBe(true)
  })

  test("tolerates trailing whitespace", () => {
    expect(commitMessageDeclaresNoDocs("Subject\n\ndocs-impact: none   \n")).toBe(true)
  })

  test("rejects when value is anything other than `none`", () => {
    expect(commitMessageDeclaresNoDocs("Subject\n\ndocs-impact: minor")).toBe(false)
  })

  test("rejects when token sits mid-line", () => {
    expect(commitMessageDeclaresNoDocs("note that docs-impact: none was added later")).toBe(false)
  })

  test("rejects empty body", () => {
    expect(commitMessageDeclaresNoDocs("")).toBe(false)
  })
})

// ── evaluate ──────────────────────────────────────────────────────────────

describe("evaluate", () => {
  test("no runtime files staged → OK regardless of docs", () => {
    const r = evaluate({ stagedFiles: ["docs/decisions.md", "scripts/foo.ts"] })
    expect(r.ok).toBe(true)
    expect(r.runtimeFiles).toEqual([])
  })

  test("runtime file co-staged with current-state.md → OK", () => {
    const r = evaluate({
      stagedFiles: ["src/agents/foo/index.ts", "docs/current-state.md"],
    })
    expect(r.ok).toBe(true)
    expect(r.runtimeFiles).toEqual(["src/agents/foo/index.ts"])
    expect(r.docFiles).toEqual(["docs/current-state.md"])
  })

  test("runtime file alone, no commit message → WARN", () => {
    const r = evaluate({ stagedFiles: ["src/agents/foo/index.ts"] })
    expect(r.ok).toBe(false)
    expect(r.runtimeFiles).toEqual(["src/agents/foo/index.ts"])
    expect(r.hasFooter).toBe(false)
  })

  test("runtime file alone, message has `docs-impact: none` → OK", () => {
    const r = evaluate({
      stagedFiles: ["src/agents/foo/index.ts"],
      commitMessage: "Subject\n\nBody\n\ndocs-impact: none\n",
    })
    expect(r.ok).toBe(true)
    expect(r.hasFooter).toBe(true)
  })

  test("runtime file alone, message has unrelated text → WARN", () => {
    const r = evaluate({
      stagedFiles: ["src/agents/foo/index.ts"],
      commitMessage: "Subject\n\nMakes a small change. Co-Authored-By: ...",
    })
    expect(r.ok).toBe(false)
    expect(r.hasFooter).toBe(false)
  })

  test("multiple runtime files, only some co-staged with docs → still OK", () => {
    // The discipline is satisfied as long as docs/current-state.md is co-staged
    // with the changeset; per-file co-staging isn't required.
    const r = evaluate({
      stagedFiles: [
        "src/agents/foo/index.ts",
        "src/phases/bar.ts",
        "src/llm.ts",
        "docs/current-state.md",
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.runtimeFiles).toHaveLength(3)
  })

  test("decisions.md alone does NOT satisfy discipline for runtime change", () => {
    const r = evaluate({
      stagedFiles: ["src/agents/foo/index.ts", "docs/decisions.md"],
    })
    expect(r.ok).toBe(false)
  })
})
