/**
 * Tests for the prompt-change lint.
 *
 * Each check (default-drift, neg-prime, staleness) is exercised against
 * a fixture repo built in /tmp so tests are hermetic — no dependence on
 * the production prompt corpus drifting and breaking the regex
 * assertions.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execSync } from "node:child_process"
import {
  ROLE_TO_LIVE_PROMPT,
  checkDefaultDrift,
  checkNegPriming,
  checkVariantStaleness,
} from "./lint-prompts"

let fixtureRoot: string

function writeFixture(rel: string, content: string) {
  const path = join(fixtureRoot, rel)
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true })
  writeFileSync(path, content, "utf8")
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "lint-prompts-fixture-"))
})

afterEach(() => {
  if (fixtureRoot && existsSync(fixtureRoot)) {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

describe("checkDefaultDrift", () => {
  test("emits no findings when default.md is byte-equal to live prompt", () => {
    const role = Object.keys(ROLE_TO_LIVE_PROMPT)[0]!
    const livePath = ROLE_TO_LIVE_PROMPT[role]!
    const promptBody = "# Live prompt content\nLine 2."
    writeFixture(livePath, promptBody)
    writeFixture(`scripts/phase-eval/variants/${role}/default.md`, promptBody)

    const findings = checkDefaultDrift(fixtureRoot)
    const errors = findings.filter(f => f.kind === "ERROR")
    expect(errors.length).toBe(0)
  })

  test("emits ERROR when default.md drifts from live prompt", () => {
    const role = Object.keys(ROLE_TO_LIVE_PROMPT)[0]!
    const livePath = ROLE_TO_LIVE_PROMPT[role]!
    writeFixture(livePath, "# Live prompt v2\nUpdated.")
    writeFixture(`scripts/phase-eval/variants/${role}/default.md`, "# Live prompt v1\nOld.")

    const findings = checkDefaultDrift(fixtureRoot)
    const errors = findings.filter(f => f.kind === "ERROR" && f.check === "default-drift")
    expect(errors.length).toBe(1)
    expect(errors[0]!.file).toContain("default.md")
  })

  test("skips role with no default.md (variant-only role is allowed)", () => {
    const role = Object.keys(ROLE_TO_LIVE_PROMPT)[0]!
    const livePath = ROLE_TO_LIVE_PROMPT[role]!
    writeFixture(livePath, "# Live prompt")
    writeFixture(`scripts/phase-eval/variants/${role}/loud.md`, "# Loud variant")
    // No default.md.

    const findings = checkDefaultDrift(fixtureRoot)
    const errors = findings.filter(f => f.kind === "ERROR")
    expect(errors.length).toBe(0)
  })

  test("emits INFO when role directory has no live-prompt mapping", () => {
    writeFixture("scripts/phase-eval/variants/unknown-role/default.md", "# Anything")

    const findings = checkDefaultDrift(fixtureRoot)
    const infos = findings.filter(f => f.kind === "INFO" && f.check === "config")
    expect(infos.length).toBe(1)
    expect(infos[0]!.message).toContain("unknown-role")
  })

  test("emits ERROR when live prompt path in mapping does not exist", () => {
    const role = Object.keys(ROLE_TO_LIVE_PROMPT)[0]!
    // Don't write the live prompt — only the variant default.
    writeFixture(`scripts/phase-eval/variants/${role}/default.md`, "# Variant default")

    const findings = checkDefaultDrift(fixtureRoot)
    const errors = findings.filter(f => f.kind === "ERROR" && f.check === "config")
    expect(errors.length).toBe(1)
  })
})

describe("checkNegPriming", () => {
  test("flags NEVER use X, Y, Z patterns", () => {
    writeFixture("src/agents/writer/test.md", '- NEVER use filter words: "realized", "noticed", "knew".\n')
    const findings = checkNegPriming(fixtureRoot)
    const negs = findings.filter(f => f.check === "neg-prime")
    expect(negs.length).toBe(1)
    expect(negs[0]!.file).toContain("writer/test.md")
  })

  test("flags Do not pair a verb with X, Y patterns", () => {
    writeFixture("src/agents/writer/test.md", '- Do not pair: "softly", "loudly".\n')
    const findings = checkNegPriming(fixtureRoot)
    const negs = findings.filter(f => f.check === "neg-prime")
    expect(negs.length).toBe(1)
  })

  test("flags Never write 'X' or 'Y' or 'Z' patterns", () => {
    writeFixture(
      "src/agents/writer/test.md",
      `Never write a paragraph that begins with "She had once been..." or "Years ago..." or "She had always..."\n`
    )
    const findings = checkNegPriming(fixtureRoot)
    const negs = findings.filter(f => f.check === "neg-prime")
    expect(negs.length).toBe(1)
  })

  test("does NOT flag good-example lists without prohibition+verb pair", () => {
    writeFixture(
      "src/agents/character-agent/test.md",
      'Good names: "Kael Voss", "Senna Dray", "Castellan Orvid".\n'
    )
    const findings = checkNegPriming(fixtureRoot)
    const negs = findings.filter(f => f.check === "neg-prime")
    expect(negs.length).toBe(0)
  })

  test("does NOT flag illustrative parentheticals like (refuse, reveal, sacrifice)", () => {
    writeFixture(
      "src/agents/planning-beats/test.md",
      "If a character must do something specific (refuse, reveal, sacrifice, discover), the beat description says so directly.\n"
    )
    const findings = checkNegPriming(fixtureRoot)
    const negs = findings.filter(f => f.check === "neg-prime")
    expect(negs.length).toBe(0)
  })

  test("scans both src/agents and scripts/phase-eval/variants directories", () => {
    writeFixture("src/agents/role-a/sys.md", '- NEVER use: "X", "Y".\n')
    writeFixture("scripts/phase-eval/variants/role-a/loud.md", '- NEVER add: "P", "Q".\n')
    const findings = checkNegPriming(fixtureRoot)
    const negs = findings.filter(f => f.check === "neg-prime")
    expect(negs.length).toBe(2)
  })
})

describe("checkVariantStaleness", () => {
  function git(args: string): string {
    return execSync(`git ${args}`, {
      cwd: fixtureRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  }

  function commitFile(rel: string, content: string, dateISO: string) {
    writeFixture(rel, content)
    execSync(`git add "${rel}"`, { cwd: fixtureRoot, stdio: "ignore" })
    execSync(`git commit -m "touch ${rel}" --date="${dateISO}"`, {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: dateISO,
        GIT_COMMITTER_DATE: dateISO,
      },
      stdio: "ignore",
    })
  }

  beforeEach(() => {
    git("init -q")
    git("config user.email test@test")
    git("config user.name test")
  })

  test("flags variant whose live prompt is >= STALE_DAYS newer", () => {
    const role = Object.keys(ROLE_TO_LIVE_PROMPT)[0]!
    const livePath = ROLE_TO_LIVE_PROMPT[role]!

    commitFile(`scripts/phase-eval/variants/${role}/loud.md`, "old variant", "2026-01-01T00:00:00Z")
    commitFile(livePath, "new live", "2026-04-01T00:00:00Z")

    const findings = checkVariantStaleness(fixtureRoot, 30)
    const stales = findings.filter(f => f.check === "staleness")
    expect(stales.length).toBe(1)
    expect(stales[0]!.file).toContain("loud.md")
  })

  test("does NOT flag variant when live prompt is within STALE_DAYS", () => {
    const role = Object.keys(ROLE_TO_LIVE_PROMPT)[0]!
    const livePath = ROLE_TO_LIVE_PROMPT[role]!

    commitFile(`scripts/phase-eval/variants/${role}/loud.md`, "variant", "2026-04-01T00:00:00Z")
    commitFile(livePath, "live", "2026-04-15T00:00:00Z")

    const findings = checkVariantStaleness(fixtureRoot, 30)
    const stales = findings.filter(f => f.check === "staleness")
    expect(stales.length).toBe(0)
  })

  test("does NOT flag default.md (handled by drift check)", () => {
    const role = Object.keys(ROLE_TO_LIVE_PROMPT)[0]!
    const livePath = ROLE_TO_LIVE_PROMPT[role]!

    commitFile(`scripts/phase-eval/variants/${role}/default.md`, "old", "2026-01-01T00:00:00Z")
    commitFile(livePath, "new", "2026-04-01T00:00:00Z")

    const findings = checkVariantStaleness(fixtureRoot, 30)
    const stales = findings.filter(f => f.check === "staleness")
    expect(stales.length).toBe(0)
  })
})
