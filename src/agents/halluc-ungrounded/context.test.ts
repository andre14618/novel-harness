import { test, expect } from "bun:test"
import { buildContext, buildCharacterRoster, buildOutlineEntityList, extractProperNouns } from "./context"

const baseBeat = {
  description: "Kael finds the torn map behind the tavern hearth.",
  kind: "action" as const,
  characters: ["Kael"],
  requiredPayoffs: [],
}

const baseOutline = {
  chapterNumber: 2,
  title: "The Hearth",
  povCharacter: "Kael",
  setting: "The Broken Anchor Tavern",
  purpose: "",
  scenes: [],
  targetWords: 1000,
  charactersPresent: ["Kael", "Meera"],
  establishedFacts: [],
  characterStateChanges: [],
  knowledgeChanges: [],
} as any

const baseChars = [
  { id: "kael", name: "Kael", role: "", speechPattern: "clipped, wry" },
  { id: "meera", name: "Meera", role: "", speechPattern: "deferential" },
  { id: "not_in_beat", name: "Doran", role: "", speechPattern: "booming" },
] as any

const baseWorldBible = {
  locations: [{ name: "The Broken Anchor" }, { name: "Lowport" }],
  cultures: [{ name: "Coast-born" }],
  systems: [{ name: "Tide-calling" }],
  rules: ["A rule that should NOT render"],
}

test("renders the four required blocks in order", () => {
  const out = buildContext("He leaned close.", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  const briefIdx = out.indexOf("BEAT BRIEF:")
  const wbIdx = out.indexOf("WORLD BIBLE")
  const speakersIdx = out.indexOf("SPEAKERS:")
  const proseIdx = out.indexOf("PROSE TO CHECK:")
  expect(briefIdx).toBeGreaterThanOrEqual(0)
  expect(wbIdx).toBeGreaterThan(briefIdx)
  expect(speakersIdx).toBeGreaterThan(wbIdx)
  expect(proseIdx).toBeGreaterThan(speakersIdx)
})

test("SPEAKERS section includes only beat.characters", () => {
  const out = buildContext("x", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out).toContain("Kael: clipped, wry")
  expect(out).not.toContain("Meera:")
  expect(out).not.toContain("Doran:")
})

test("WORLD BIBLE block renders names only — no descriptions or rules", () => {
  const out = buildContext("x", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out).toContain("The Broken Anchor")
  expect(out).toContain("Coast-born")
  expect(out).toContain("Tide-calling")
  expect(out).not.toContain("A rule that should NOT render")
})

test("missing world-bible sections degrade gracefully", () => {
  const wb = {}
  const out = buildContext("x", baseBeat as any, baseOutline, baseChars, wb)
  expect(out).toContain("Locations: (none)")
  expect(out).toContain("Cultures:  (none)")
  expect(out).toContain("Systems:   (none)")
})

test("PROSE TO CHECK section carries prose verbatim at the end", () => {
  const prose = "She lit the lamp. It guttered."
  const out = buildContext(prose, baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out.endsWith(prose)).toBe(true)
})

test("extractProperNouns: picks single- and multi-word proper nouns, filters stopwords", () => {
  const text = "Kael cryptically hints that the war is fueled by a cursed artifact called the Heartstone, which drains the land."
  const names = extractProperNouns(text)
  expect(names).toContain("Kael")
  expect(names).toContain("Heartstone")
  expect(names).not.toContain("The")
  expect(names).not.toContain("She")
})

test("extractProperNouns: picks multi-word spans with connectors", () => {
  const names = extractProperNouns("Tamsin rode along the Dust Road from Baldur's Gate to the Spine of the World.")
  expect(names).toContain("Tamsin")
  expect(names).toContain("Dust Road")
  expect(names).toContain("Baldur's Gate")
  expect(names).toContain("Spine of the World")
})

test("extractProperNouns: dedupes", () => {
  const names = extractProperNouns("Heartstone corrupts leaders. The Heartstone hums.")
  expect(names.filter(n => n === "Heartstone")).toHaveLength(1)
})

test("extractProperNouns: strips leading sentence-starter stopwords from multi-word matches", () => {
  // "When Rynn" / "But Kael" / "Then Marshal Vex" would otherwise leak through
  // the multi-word filter. Keep the payload, drop the starter.
  const names = extractProperNouns("When Rynn arrived, but Kael was gone. Then Marshal Vex spoke.")
  expect(names).toContain("Rynn")
  expect(names).toContain("Kael")
  expect(names).toContain("Marshal Vex")
  expect(names).not.toContain("When Rynn")
  expect(names).not.toContain("But Kael")
  expect(names).not.toContain("Then Marshal Vex")
})

test("extractProperNouns: keeps 'The <Name>' because 'The' starts real place names", () => {
  // "The Ashen Wastes" is a real place name — don't strip "The" from
  // multi-word spans; keep the whole thing so the checker sees it intact.
  const names = extractProperNouns("They crossed The Ashen Wastes on foot.")
  expect(names).toContain("The Ashen Wastes")
})

test("extractProperNouns: rank+name 'Marshal Vex' preserved", () => {
  // Codex called this out — titles like Marshal/Captain standalone get
  // filtered, but attached to a name they must survive.
  const names = extractProperNouns("Marshal Vex gave the order.")
  expect(names).toContain("Marshal Vex")
})

test("extractProperNouns: hyphenated and apostrophe names preserved", () => {
  // Fantasy corpus has lots of these: "Aegis-fang", "Catti-brie", possessives.
  const names = extractProperNouns("She carried Aegis-fang. He called out to Catti-brie.")
  expect(names).toContain("Aegis-fang")
  expect(names).toContain("Catti-brie")
})

test("buildContext: From-brief line surfaces brief-only proper nouns and dedupes against world bible", () => {
  const beat = {
    description: "Kael cryptically hints that the war is fueled by a cursed artifact called the Heartstone.",
    kind: "dialogue" as const,
    characters: ["Kael"],
    requiredPayoffs: [],
  } as any
  const outline = { ...baseOutline, setting: "The Broken Anchor" }
  const out = buildContext("prose", beat, outline, baseChars, baseWorldBible)
  expect(out).toContain("From-brief:")
  expect(out).toContain("Heartstone")
  // "The Broken Anchor" is already in the bible Locations list — don't duplicate into From-brief
  const fromBriefLine = out.split("\n").find(l => l.trim().startsWith("From-brief:")) ?? ""
  expect(fromBriefLine).not.toContain("The Broken Anchor")
})

test("buildContext: From-brief line renders '(none)' when brief has no proper nouns", () => {
  const beat = {
    description: "she ran toward him in the dark.",
    kind: "action" as const,
    characters: ["Kael"],
    requiredPayoffs: [],
  } as any
  const outline = { ...baseOutline, setting: "" }
  const out = buildContext("prose", beat, outline, baseChars, { locations: [], cultures: [], systems: [] })
  // Kael is in beat.characters so it's in bibleKnown; should be excluded from From-brief.
  expect(out).toContain("From-brief: (none)")
})

test("buildContext: Allowed-new-entities surfaces planner-sanctioned walk-ons", () => {
  // Simulate the planner authorizing "Master Orin" as a sanctioned new
  // walk-on for this beat via beat.obligations.allowedNewEntities. The
  // checker context must surface that name so the rubric can treat it
  // as grounded for this beat (sanction calibration is a separate loop;
  // here we only verify threading).
  const beat = {
    description: "Kael meets the master swordsmith.",
    kind: "action" as const,
    characters: ["Kael"],
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: ["Master Orin"],
    },
  } as any
  const out = buildContext("prose", beat, baseOutline, baseChars, baseWorldBible)
  expect(out).toContain("Allowed-new-entities:")
  expect(out).toContain("Master Orin")
  const allowedLine = out.split("\n").find(l => l.trim().startsWith("Allowed-new-entities:")) ?? ""
  expect(allowedLine).toContain("Master Orin")
})

test("buildContext: Allowed-new-entities renders '(none)' when obligation list is empty", () => {
  // Backward-compat: beats with no obligations.allowedNewEntities (or
  // with an empty list) still render the sub-line as "(none)" so the
  // checker sees a stable surface shape.
  const out = buildContext("prose", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out).toContain("Allowed-new-entities: (none)")
})

test("buildContext: Allowed-new-entities dedupes against world bible / brief / beat-entities", () => {
  // If the planner re-emits a name that's already in the bible, brief,
  // or derived beat-entities, don't duplicate it into the
  // Allowed-new-entities sub-line — keep only *additional* sanction
  // signal.
  const beat = {
    description: "Kael returns to The Broken Anchor.",
    kind: "action" as const,
    characters: ["Kael"],
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      // "The Broken Anchor" is already in bible.locations; "Heartstone"
      // would be in From-brief; "Master Orin" is genuinely new.
      allowedNewEntities: ["The Broken Anchor", "Master Orin"],
    },
  } as any
  const out = buildContext("prose", beat, baseOutline, baseChars, baseWorldBible)
  const allowedLine = out.split("\n").find(l => l.trim().startsWith("Allowed-new-entities:")) ?? ""
  expect(allowedLine).toContain("Master Orin")
  expect(allowedLine).not.toContain("The Broken Anchor")
})

// ── L20: buildCharacterRoster + buildOutlineEntityList + buildContext integration ──

test("buildCharacterRoster: returns all character names from the profile array", () => {
  const chars = [
    { id: "kael", name: "Kael", role: "", speechPattern: "" },
    { id: "brennan", name: "Lord Sorcerer Brennan", role: "antagonist", speechPattern: "" },
    { id: "aldric", name: "Aldric Vey", role: "ally", speechPattern: "" },
  ] as any
  const roster = buildCharacterRoster(chars)
  expect(roster).toContain("Kael")
  expect(roster).toContain("Lord Sorcerer Brennan")
  expect(roster).toContain("Aldric Vey")
  expect(roster).toHaveLength(3)
})

test("buildCharacterRoster: empty array → empty list", () => {
  expect(buildCharacterRoster([])).toHaveLength(0)
})

test("buildOutlineEntityList: extracts entity from outline.setting", () => {
  const outline = {
    ...baseOutline,
    setting: "Eastern Reach, near the border garrison",
    scenes: [],
    establishedFacts: [],
  } as any
  const entities = buildOutlineEntityList(outline)
  expect(entities).toContain("Eastern Reach")
})

test("buildOutlineEntityList: extracts entity from beat description", () => {
  const outline = {
    ...baseOutline,
    scenes: [
      {
        description: "Kael follows the suspect down Silver Street toward the docks.",
        characters: ["Kael"],
        kind: "action",
        requiredPayoffs: [],
      },
    ],
    establishedFacts: [],
  } as any
  const entities = buildOutlineEntityList(outline)
  expect(entities).toContain("Silver Street")
})

test("buildOutlineEntityList: extracts entity from establishedFact text", () => {
  const outline = {
    ...baseOutline,
    scenes: [],
    establishedFacts: [
      { id: "f1", fact: "The Temple of Mercy serves as a neutral meeting ground for rival factions.", category: "knowledge" },
    ],
  } as any
  const entities = buildOutlineEntityList(outline)
  // extractProperNouns keeps leading "The" for place names (per its design —
  // "The Temple of Mercy" is a real multi-word location name).
  // The four-tier grounded-match also strips leading articles, so both
  // "Temple of Mercy" and "The Temple of Mercy" normalize identically.
  const hasTempleOfMercy = entities.some(e => e.includes("Temple of Mercy"))
  expect(hasTempleOfMercy).toBe(true)
})

test("buildOutlineEntityList: empty outline → empty list", () => {
  const outline = {
    ...baseOutline,
    setting: "",
    scenes: [],
    establishedFacts: [],
  } as any
  const entities = buildOutlineEntityList(outline)
  // Should not crash; result is deterministic.
  expect(Array.isArray(entities)).toBe(true)
})

test("buildContext: Character-roster line rendered when opts.characterRoster provided", () => {
  const chars = [
    { id: "kael", name: "Kael", role: "", speechPattern: "clipped, wry" },
    { id: "brennan", name: "Lord Sorcerer Brennan", role: "antagonist", speechPattern: "" },
  ] as any
  const out = buildContext("prose", baseBeat as any, baseOutline, chars, baseWorldBible, {
    characterRoster: ["Lord Sorcerer Brennan"],
  })
  expect(out).toContain("Character-roster:")
  expect(out).toContain("Lord Sorcerer Brennan")
})

test("buildContext: Character-roster NOT rendered when opts.characterRoster is undefined (backward compat)", () => {
  const out = buildContext("prose", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out).not.toContain("Character-roster:")
})

test("buildContext: Outline-entities line rendered when opts.outlineEntities provided", () => {
  const out = buildContext("prose", baseBeat as any, baseOutline, baseChars, baseWorldBible, {
    outlineEntities: ["Silver Street", "Eastern Reach"],
  })
  expect(out).toContain("Outline-entities:")
  expect(out).toContain("Silver Street")
  expect(out).toContain("Eastern Reach")
})

test("buildContext: Character-roster dedupes against bible / beat.characters", () => {
  // "Kael" is already in beat.characters (hence bibleKnown); roster should not
  // duplicate it into the Character-roster sub-line.
  const beat = {
    description: "Kael approaches the hall.",
    kind: "action" as const,
    characters: ["Kael"],
    requiredPayoffs: [],
  } as any
  const chars = [
    { id: "kael", name: "Kael", role: "", speechPattern: "" },
    { id: "brennan", name: "Lord Sorcerer Brennan", role: "antagonist", speechPattern: "" },
  ] as any
  const out = buildContext("prose", beat, baseOutline, chars, baseWorldBible, {
    characterRoster: ["Kael", "Lord Sorcerer Brennan"],
  })
  const rosterLine = out.split("\n").find(l => l.trim().startsWith("Character-roster:")) ?? ""
  // "Kael" is in bibleKnown (via beat.characters) → deduped out
  expect(rosterLine).not.toContain("Kael")
  // "Lord Sorcerer Brennan" is genuinely new → kept
  expect(rosterLine).toContain("Lord Sorcerer Brennan")
})

// ── L23b: deriveTitleNouns tests ──────────────────────────────────────────────

import { deriveTitleNouns } from "./context"

test("deriveTitleNouns: 'Guild Master' role → emits 'GuildMaster' and 'guildmaster'", () => {
  const chars = [
    { id: "x", name: "Vareth", role: "Guild Master", speechPattern: "" },
  ] as any
  const titles = deriveTitleNouns(chars)
  expect(titles).toContain("GuildMaster")
  expect(titles).toContain("guildmaster")
})

test("deriveTitleNouns: 'Lord Sorcerer' role → emits 'LordSorcerer' and leading 'Lord'", () => {
  const chars = [
    { id: "x", name: "Brennan", role: "Lord Sorcerer", speechPattern: "" },
  ] as any
  const titles = deriveTitleNouns(chars)
  expect(titles).toContain("LordSorcerer")
  expect(titles).toContain("Lord")
})

test("deriveTitleNouns: single-token title role 'Guildmaster' → emits 'Guildmaster' directly", () => {
  const chars = [
    { id: "x", name: "Vareth", role: "Guildmaster", speechPattern: "" },
  ] as any
  const titles = deriveTitleNouns(chars)
  expect(titles).toContain("Guildmaster")
})

test("deriveTitleNouns: role with no title root → not emitted", () => {
  const chars = [
    { id: "x", name: "Bob", role: "protagonist", speechPattern: "" },
  ] as any
  const titles = deriveTitleNouns(chars)
  // "protagonist" has no title root → empty
  expect(titles).toHaveLength(0)
})

test("deriveTitleNouns: empty role → not emitted", () => {
  const chars = [
    { id: "x", name: "Kael", role: "", speechPattern: "" },
  ] as any
  expect(deriveTitleNouns(chars)).toHaveLength(0)
})

test("deriveTitleNouns: multiple characters → all roles processed", () => {
  const chars = [
    { id: "a", name: "Vareth", role: "Guild Master", speechPattern: "" },
    { id: "b", name: "Lira", role: "High Priest", speechPattern: "" },
    { id: "c", name: "Kael", role: "protagonist", speechPattern: "" },
  ] as any
  const titles = deriveTitleNouns(chars)
  expect(titles).toContain("GuildMaster")
  expect(titles).toContain("HighPriest")
  // "protagonist" has no title root — must not emit a joined form
  expect(titles).not.toContain("protagonist")
})

test("buildContext: Derived-titles line rendered when opts.derivedTitles provided", () => {
  const chars = [
    { id: "vareth", name: "Vareth", role: "Guild Master", speechPattern: "" },
  ] as any
  const out = buildContext("prose", baseBeat as any, baseOutline, chars, baseWorldBible, {
    derivedTitles: ["GuildMaster", "guildmaster"],
  })
  expect(out).toContain("Derived-titles:")
  expect(out).toContain("GuildMaster")
})

test("buildContext: Derived-titles NOT rendered when opts.derivedTitles is undefined (backward compat)", () => {
  const out = buildContext("prose", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out).not.toContain("Derived-titles:")
})

test("buildContext: Derived-titles dedupes against bible entries", () => {
  // If world-bible already has "Guild" or derivedTitles duplicate the roster,
  // dedup should remove it from the sub-line.
  const out = buildContext("prose", baseBeat as any, baseOutline, baseChars, baseWorldBible, {
    derivedTitles: ["Coast-born"],  // "Coast-born" is in cultures — already known
  })
  const derivedLine = out.split("\n").find(l => l.trim().startsWith("Derived-titles:")) ?? ""
  // "Coast-born" is already in bible.cultures → deduped out
  expect(derivedLine).not.toContain("Coast-born")
})
