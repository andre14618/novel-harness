import { expect, test } from "bun:test"

import {
  buildFactUserPrompt,
  buildStateUserPrompt,
  isExplicitFactNonContradiction,
  resolveFactId,
  stateViolationToIssue,
} from "./check"
import type { ChapterOutline, CharacterState, Fact } from "../../types"

test("state prompt includes current plan and frames prior locations as starting context", () => {
  const prompt = buildStateUserPrompt(
    "Aldric stood in his study while Wren drew on the infirmary floor.",
    [characterState({ characterId: "char_aldric", location: "The Chancel Infirmary" })],
    outline(),
  )

  expect(prompt).toContain("CURRENT CHAPTER PLAN")
  expect(prompt).toContain('Chapter 2: "The Echo Chamber"')
  expect(prompt).toContain("Setting: The Chancel Infirmary and the High Ward")
  expect(prompt).toContain("Aldric Vane: location=His study in the High Ward")
  expect(prompt).toContain("starting context, not an immovable location requirement")
})

test("fact prompt includes current plan and frames relative timing/place context", () => {
  const prompt = buildFactUserPrompt(
    "At dawn the next morning, Maret reaches the bridge. Cassel says she will submit now.",
    [
      {
        id: "fact-verification",
        fact: "A mandatory Verification test is scheduled for tomorrow at dawn",
        category: "event",
        establishedInChapter: 1,
        role: "operational",
      },
      {
        id: "fact-cassel-archive",
        fact: "Arbiter Cassel is present in the Grand Archive",
        category: "physical",
        establishedInChapter: 1,
        role: "operational",
      },
    ],
    outline({
      chapterNumber: 2,
      setting: "The Iron Bridge",
      scenes: [{
        kind: "dialogue",
        description: "At dawn the next morning, Maret arrives at the Iron Bridge for Verification.",
        temporalAnchor: "dawn the next morning",
        placeAnchor: "Iron Bridge",
        characters: ["Maret", "Arbiter Cassel"],
        requiredPayoffs: [],
        obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      }],
    }),
  )

  expect(prompt).toContain("CURRENT CHAPTER PLAN")
  expect(prompt).toContain("At dawn the next morning")
  expect(prompt).toContain("time: dawn the next morning")
  expect(prompt).toContain("place: Iron Bridge")
  expect(prompt).toContain("Interpret relative words")
  expect(prompt).toContain("Prior-chapter location/presence facts are snapshots")
  expect(prompt).toContain("[factId=fact-verification; ch1; category=event]")
  expect(prompt).toContain('copy that exact factId into the JSON "fact" field')
})

test("fact prompt disambiguates authorization marks from missing binding seals", () => {
  const prompt = buildFactUserPrompt(
    "The transfer order bore Halric's signature and office seal. The blank circle for Maren's binding seal remained empty.",
    [{
      id: "fact-transfer-order-signed",
      fact: "The transfer order already bears Halric's authorization and names Corso as the new bearer; only Maren's binding seal remains missing.",
      category: "debt-law",
      establishedInChapter: 1,
      role: "operational",
    }],
    outline({
      chapterNumber: 2,
      title: "The Foreman's Name",
      setting: "Treasury Keep",
      scenes: [{
        kind: "action",
        description: "Maren reviews the authorized order before deciding whether to apply her seal.",
        characters: ["Maren Ailish"],
        requiredPayoffs: [],
        obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      }],
    }),
  )

  expect(prompt).toContain("Role-qualified marks are distinct")
  expect(prompt).toContain("another person's required binding seal")
  expect(prompt).toContain("unless the draft says the missing person's seal was applied")
  expect(prompt).toContain("[factId=fact-transfer-order-signed; ch1; category=debt-law]")
})

test("prior-state location violations are warning-class even when the model asks for blocker", () => {
  const issue = stateViolationToIssue({
    character: "aldric",
    type: "location",
    severity: "blocker",
    evidence: "Aldric stood in his study.",
    reasoning: "Previous state had Aldric at the infirmary.",
  })

  expect(issue.severity).toBe("warning")
})

test("knowledge violations remain blocker-class by default", () => {
  const issue = stateViolationToIssue({
    character: "wren",
    type: "knowledge",
    evidence: "Wren named the hidden culprit.",
    reasoning: "Wren acts on information she has not learned.",
  })

  expect(issue.severity).toBe("blocker")
})

// ── Stable-ID propagation (2026-05-04, additive) ─────────────────────────

test("stateViolationToIssue populates characterId on exact characterId match", () => {
  const charStates: CharacterState[] = [
    characterState({ characterId: "char_aldric" }),
    characterState({ characterId: "char_wren" }),
  ]
  const issue = stateViolationToIssue(
    {
      character: "char_aldric",
      type: "knowledge",
      evidence: "Aldric named the hidden room.",
      reasoning: "Aldric acts on information he has not learned.",
    },
    charStates,
  )

  expect(issue.characterId).toBe("char_aldric")
  // Severity routing for knowledge violations is unchanged.
  expect(issue.severity).toBe("blocker")
  // Legacy human-readable surface preserved verbatim.
  expect(issue.description).toContain("char_aldric knowledge violation")
})

test("stateViolationToIssue keeps the existing severity downgrade for location violations even when characterId resolves", () => {
  const charStates: CharacterState[] = [
    characterState({ characterId: "char_aldric" }),
  ]
  const issue = stateViolationToIssue(
    {
      character: "char_aldric",
      type: "location",
      severity: "blocker",
      evidence: "Aldric stood in his study.",
      reasoning: "Previous state had Aldric at the infirmary.",
    },
    charStates,
  )

  expect(issue.characterId).toBe("char_aldric")
  expect(issue.severity).toBe("warning")
})

test("stateViolationToIssue leaves characterId absent when no exact characterId match exists", () => {
  const charStates: CharacterState[] = [
    characterState({ characterId: "char_aldric" }),
    characterState({ characterId: "char_wren" }),
  ]
  // Display name, not id — must NOT match (no fuzzy resolution).
  const issue = stateViolationToIssue(
    {
      character: "Aldric Vane",
      type: "knowledge",
      evidence: "Aldric named the hidden room.",
      reasoning: "Aldric acts on information he has not learned.",
    },
    charStates,
  )

  expect(issue.characterId).toBeUndefined()
})

test("stateViolationToIssue leaves characterId absent when caller passes no charStates (back-compat)", () => {
  // Pre-2026-05-04 callers that don't thread charStates still produce
  // valid issues without characterId. The 1-arg form is still supported.
  const issue = stateViolationToIssue({
    character: "char_aldric",
    type: "knowledge",
    evidence: "x",
    reasoning: "y",
  })

  expect(issue.characterId).toBeUndefined()
  expect(issue.severity).toBe("blocker")
})

test("resolveFactId returns the durable id when the model echoed canonical fact text", () => {
  const facts: Fact[] = [
    { id: "fact-cure", fact: "The bell tower hides the fever cure", category: "knowledge", establishedInChapter: 1, role: "operational" },
    { id: "fact-door", fact: "  The infirmary door is locked  ", category: "rule", establishedInChapter: 2, role: "operational" },
  ]
  expect(resolveFactId("The bell tower hides the fever cure", facts)).toBe("fact-cure")
  expect(resolveFactId("  The infirmary door is locked  ", facts)).toBe("fact-door")
  expect(resolveFactId("The infirmary door is locked", facts)).toBe("fact-door")
})

test("resolveFactId returns the durable id when the model already echoed the id", () => {
  const facts: Fact[] = [
    { id: "fact-cure", fact: "The bell tower hides the fever cure", category: "knowledge", establishedInChapter: 1, role: "operational" },
  ]
  expect(resolveFactId("fact-cure", facts)).toBe("fact-cure")
})

test("resolveFactId returns undefined for any fuzzy / partial / paraphrased match", () => {
  const facts: Fact[] = [
    { id: "fact-cure", fact: "The bell tower hides the fever cure", category: "knowledge", establishedInChapter: 1, role: "operational" },
  ]
  // Substring is not exact match.
  expect(resolveFactId("bell tower hides the fever cure", facts)).toBeUndefined()
  // Paraphrase is not exact match.
  expect(resolveFactId("the cure is hidden in the tower", facts)).toBeUndefined()
  // Empty / whitespace-only / undefined.
  expect(resolveFactId("", facts)).toBeUndefined()
  expect(resolveFactId("   ", facts)).toBeUndefined()
  expect(resolveFactId(undefined, facts)).toBeUndefined()
  // Empty fact registry.
  expect(resolveFactId("anything", [])).toBeUndefined()
})

test("resolveFactId skips facts without an id field even when the text matches", () => {
  const facts: Fact[] = [
    { id: "", fact: "The bell tower hides the fever cure", category: "knowledge", establishedInChapter: 1, role: "operational" },
  ]
  // The match is on text, but the fact carries no durable id — there's
  // nothing safe to copy onto the issue.
  expect(resolveFactId("The bell tower hides the fever cure", facts)).toBeUndefined()
})

test("isExplicitFactNonContradiction filters support echoes and omissions", () => {
  expect(isExplicitFactNonContradiction({
    evidence: "The transfer order bears Halric's seal.",
    reasoning: "This is consistent with the fact. No contradiction.",
  })).toBe(true)
  expect(isExplicitFactNonContradiction({
    reasoning: "The draft does not mention Halric's personal ruin, but it does not contradict it either.",
  })).toBe(true)
  expect(isExplicitFactNonContradiction({
    reasoning: "The draft states verification requires no witness, contradicting the fact.",
  })).toBe(false)
})

function characterState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    characterId: "char_wren",
    chapterNumber: 1,
    location: "The Chancel Infirmary",
    emotionalState: "calm",
    knows: [],
    doesNotKnow: [],
    ...overrides,
  }
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 2,
    title: "The Echo Chamber",
    povCharacter: "Istra Vayne",
    setting: "The Chancel Infirmary and the High Ward",
    purpose: "Show the echo spreading and Aldric forcing production.",
    targetWords: 3000,
    charactersPresent: ["Istra Vayne", "Aldric Vane", "Wren"],
    charactersPresentIds: [],
    scenes: [
      {
        kind: "dialogue",
        description: "Aldric welcomes Istra into his study in the High Ward.",
        characters: ["Aldric Vane", "Istra Vayne"],
        requiredPayoffs: [],
        obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      },
    ],
    establishedFacts: [],
    characterStateChanges: [
      {
        name: "Aldric Vane",
        location: "His study in the High Ward",
        emotionalState: "desperate and authoritative",
        knows: ["Istra has reported echoing side effects"],
        doesNotKnow: ["Istra's decision to resist"],
      },
    ],
    knowledgeChanges: [],
    ...overrides,
  }
}
