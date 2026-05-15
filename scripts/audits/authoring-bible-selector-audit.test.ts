import { describe, expect, test } from "bun:test"

import type { AuthoringBibleRule, AuthoringBibleRuleSelection } from "../../src/harness/authoring-bible"
import type { ChapterOutline, SceneBeat } from "../../src/types"
import { auditScene, matchNameForScene } from "./authoring-bible-selector-audit"

describe("authoring bible selector audit name matching", () => {
  test("distinguishes exact, honorific, primary-token, and missing matches", () => {
    expect(matchNameForScene("Kael Rusk", ["Kael Rusk"])).toMatchObject({
      status: "exact",
      matchedSceneName: "Kael Rusk",
    })
    expect(matchNameForScene("Lady Varn", ["Varn"])).toMatchObject({
      status: "honorific",
      matchedSceneName: "Varn",
    })
    expect(matchNameForScene("Kael Rusk", ["Kael"])).toMatchObject({
      status: "primary_token",
      matchedSceneName: "Kael",
      token: "kael",
    })
    expect(matchNameForScene("Mira Rusk", ["Kael Rusk"])).toMatchObject({
      status: "missing",
    })
  })
})

describe("authoring bible selector audit scene checks", () => {
  test("flags scene-local rules in the cache-stable prefix", () => {
    const rule: AuthoringBibleRule = {
      id: "char-rule:kael-rusk:voice",
      kind: "character",
      title: "Kael voice",
      text: "Short, tactical tradeoffs.",
      appliesWhen: "Kael is present.",
      source: "test",
      characterName: "Kael Rusk",
    }
    const selection: AuthoringBibleRuleSelection = {
      ruleId: rule.id,
      kind: "character",
      reason: "scene_character_present",
      characterName: "Kael Rusk",
    }
    const row = auditScene({
      outline: outline(["Kael"]),
      scene: scene(["Kael"]),
      sceneIndex: 0,
      rules: [rule],
      selections: [selection],
      stablePreludeRuleIds: [rule.id],
      sceneSliceRuleIds: [],
      stablePrelude: `[${rule.id}] ${rule.text}`,
      maxRulesWarning: 32,
    })

    expect(row.findings.map(finding => finding.code)).toContain("SCENE_LOCAL_RULE_IN_STABLE_PREFIX")
    expect(row.findings.map(finding => finding.code)).toContain("UNSTABLE_REASON_IN_STABLE_PREFIX")
    expect(row.findings.map(finding => finding.code)).toContain("PRIMARY_TOKEN_NAME_MATCH")
  })

  test("accepts exact scene-local character and relationship selections", () => {
    const rules: AuthoringBibleRule[] = [
      {
        id: "char-rule:kael-rusk:driver",
        kind: "character",
        title: "Kael driver",
        text: "Counts risk as debt pressure.",
        appliesWhen: "Kael is present.",
        source: "test",
        characterName: "Kael Rusk",
      },
      {
        id: "rel-rule:kael-rusk:orin-vale",
        kind: "relationship",
        title: "Kael and Orin",
        text: "Trust is transactional but old.",
        appliesWhen: "Both are present.",
        source: "test",
        characterName: "Kael Rusk",
        relatedCharacterName: "Orin Vale",
      },
    ]
    const selections: AuthoringBibleRuleSelection[] = [
      { ruleId: rules[0]!.id, kind: "character", reason: "scene_character_present", characterName: "Kael Rusk" },
      {
        ruleId: rules[1]!.id,
        kind: "relationship",
        reason: "relationship_characters_present",
        characterName: "Kael Rusk",
        relatedCharacterName: "Orin Vale",
      },
    ]
    const row = auditScene({
      outline: outline(["Kael Rusk"]),
      scene: scene(["Kael Rusk", "Orin Vale"]),
      sceneIndex: 0,
      rules,
      selections,
      stablePreludeRuleIds: [],
      sceneSliceRuleIds: rules.map(rule => rule.id),
      stablePrelude: null,
      maxRulesWarning: 32,
    })

    expect(row.findings).toEqual([])
    expect(row.selectedRules.map(rule => rule.ruleId)).toEqual(rules.map(rule => rule.id))
  })
})

function outline(names: string[]): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Test",
    povCharacter: names[0] ?? "",
    setting: "Test setting",
    purpose: "Test purpose",
    targetWords: 1000,
    charactersPresent: names,
    scenes: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as ChapterOutline
}

function scene(characters: string[]): SceneBeat {
  return {
    sceneId: "scene-test",
    description: "A test scene.",
    characters,
  } as SceneBeat
}
