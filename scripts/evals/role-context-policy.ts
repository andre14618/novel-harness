#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { buildBeatContext } from "../../src/agents/writer/beat-context"
import {
  selectContinuityFactsForPolicy,
  selectWriterFactsForPolicy,
  type FactRoleContextPolicy,
} from "../../src/harness/fact-roles"
import type { ChapterOutline, CharacterProfile, Fact } from "../../src/types"

export interface RoleContextPolicyFixture {
  id: string
  description?: string
  facts: Fact[]
  expect: {
    legacyWriterContains: string[]
    roleAwareWriterContains: string[]
    roleAwareWriterOmits: string[]
    legacyContinuityFactIds: string[]
    roleAwareContinuityFactIds: string[]
  }
}

export interface RoleContextPolicyEvidence {
  fixtureId: string
  description?: string
  passed: boolean
  writer: {
    legacyPrompt: string
    roleAwarePrompt: string
    legacyContains: CheckResult[]
    roleAwareContains: CheckResult[]
    roleAwareOmits: CheckResult[]
  }
  continuity: {
    legacyFactIds: string[]
    roleAwareFactIds: string[]
    legacyMatchesExpected: boolean
    roleAwareMatchesExpected: boolean
  }
}

export interface CheckResult {
  text: string
  passed: boolean
}

export async function loadRoleContextPolicyFixture(path: string): Promise<RoleContextPolicyFixture> {
  return JSON.parse(await readFile(path, "utf8")) as RoleContextPolicyFixture
}

export async function evaluateRoleContextPolicyFixture(
  fixture: RoleContextPolicyFixture,
): Promise<RoleContextPolicyEvidence> {
  const legacyPrompt = await buildWriterPrompt(fixture.facts, "legacy")
  const roleAwarePrompt = await buildWriterPrompt(fixture.facts, "role-aware")
  const legacyFactIds = selectContinuityFactsForPolicy(fixture.facts, "legacy").map((fact) => fact.id)
  const roleAwareFactIds = selectContinuityFactsForPolicy(fixture.facts, "role-aware").map((fact) => fact.id)

  const writer = {
    legacyPrompt,
    roleAwarePrompt,
    legacyContains: fixture.expect.legacyWriterContains.map((text) => ({
      text,
      passed: legacyPrompt.includes(text),
    })),
    roleAwareContains: fixture.expect.roleAwareWriterContains.map((text) => ({
      text,
      passed: roleAwarePrompt.includes(text),
    })),
    roleAwareOmits: fixture.expect.roleAwareWriterOmits.map((text) => ({
      text,
      passed: !roleAwarePrompt.includes(text),
    })),
  }
  const continuity = {
    legacyFactIds,
    roleAwareFactIds,
    legacyMatchesExpected: sameArray(legacyFactIds, fixture.expect.legacyContinuityFactIds),
    roleAwareMatchesExpected: sameArray(roleAwareFactIds, fixture.expect.roleAwareContinuityFactIds),
  }
  return {
    fixtureId: fixture.id,
    description: fixture.description,
    passed: [
      ...writer.legacyContains,
      ...writer.roleAwareContains,
      ...writer.roleAwareOmits,
    ].every((check) => check.passed) &&
      continuity.legacyMatchesExpected &&
      continuity.roleAwareMatchesExpected,
    writer,
    continuity,
  }
}

export function renderRoleContextPolicyEvidence(evidence: RoleContextPolicyEvidence): string {
  const lines: string[] = []
  lines.push(`# Role Context Policy Fixture: ${evidence.fixtureId}`)
  if (evidence.description) lines.push(evidence.description)
  lines.push("")
  lines.push(`Result: ${evidence.passed ? "PASS" : "FAIL"}`)
  lines.push("")
  lines.push("| check | result |")
  lines.push("|---|---|")
  for (const check of evidence.writer.legacyContains) {
    lines.push(`| legacy writer contains \`${escapeCell(check.text)}\` | ${mark(check.passed)} |`)
  }
  for (const check of evidence.writer.roleAwareContains) {
    lines.push(`| role-aware writer contains \`${escapeCell(check.text)}\` | ${mark(check.passed)} |`)
  }
  for (const check of evidence.writer.roleAwareOmits) {
    lines.push(`| role-aware writer omits \`${escapeCell(check.text)}\` | ${mark(check.passed)} |`)
  }
  lines.push(`| legacy continuity ids = ${evidence.continuity.legacyFactIds.join(", ")} | ${mark(evidence.continuity.legacyMatchesExpected)} |`)
  lines.push(`| role-aware continuity ids = ${evidence.continuity.roleAwareFactIds.join(", ")} | ${mark(evidence.continuity.roleAwareMatchesExpected)} |`)
  return lines.join("\n")
}

async function buildWriterPrompt(facts: readonly Fact[], policy: FactRoleContextPolicy): Promise<string> {
  const selectedFacts = selectWriterFactsForPolicy(facts, policy)
  const result = await buildBeatContext({
    novelId: "role-context-fixture",
    chapterNumber: 2,
    beatIndex: 0,
    outline: outline(),
    characters: [maret()],
    characterStates: [],
    worldBible: { locations: [] },
    preResolvedRefs: { context: "", lookupCount: 0, llmUsed: false },
    compactMode: true,
    genre: "fantasy",
    priorChapterFacts: selectedFacts,
  })
  return result.userPrompt
}

function outline(): ChapterOutline {
  return {
    chapterNumber: 2,
    title: "The Ledger Door",
    povCharacter: "Maret",
    setting: "Bellwright Archive",
    purpose: "Maret enters the archive and studies the oath ledger.",
    targetWords: 1200,
    charactersPresent: ["Maret"],
    charactersPresentIds: ["maret"],
    scenes: [
      {
        description: "Maret studies the oath ledger before the dawn bells sound.",
        characters: ["Maret"],
        kind: "interiority",
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      },
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as ChapterOutline
}

function maret(): CharacterProfile {
  return {
    id: "maret",
    name: "Maret",
    role: "protagonist",
    backstory: "",
    traits: [],
    speechPattern: "precise, guarded",
    goals: "Find out who altered the ledger.",
    fears: "",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  } as CharacterProfile
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function mark(passed: boolean): string {
  return passed ? "PASS" : "FAIL"
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/`/g, "'")
}

async function main(argv: string[]): Promise<number> {
  const json = argv.includes("--json")
  const paths = argv.filter((arg) => arg !== "--json")
  const fixturePaths = paths.length > 0
    ? paths
    : [join("tests", "role-context-policy-fixtures", "reference-hidden-basic.json")]
  const evidence = await Promise.all(
    fixturePaths.map(async (path) => evaluateRoleContextPolicyFixture(await loadRoleContextPolicyFixture(path))),
  )
  if (json) {
    console.log(JSON.stringify(evidence, null, 2))
  } else {
    console.log(evidence.map(renderRoleContextPolicyEvidence).join("\n\n"))
  }
  return evidence.every((item) => item.passed) ? 0 : 1
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
