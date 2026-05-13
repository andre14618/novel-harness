import { expect, test, mock, beforeEach } from "bun:test"

// ── Stage-gating mocks ──────────────────────────────────────────────────
//
// The two-stage adherence checker (2026-05-01, exp #317) requires that
// Stage 2 (per-event enumeration) only fires when Stage 1 returns
// `events_present: false`. Tests below assert that contract by spying on
// `callAgent` invocations: each call's system prompt identifies which
// stage was invoked.
//
// `callAgentResponses` is a queue of stubbed outputs; the mocked
// `callAgent` shifts one per call. `callAgentInvocations` records the
// system prompt of every call so tests can detect "stage 1 only" vs
// "stage 1 + stage 2".

let callAgentResponses: any[] = []
const callAgentInvocations: Array<{ systemPrompt: string; userPrompt: string }> = []

mock.module("../../llm", () => ({
  callAgent: async (config: any) => {
    callAgentInvocations.push({ systemPrompt: config.systemPrompt, userPrompt: config.userPrompt })
    if (callAgentResponses.length === 0) {
      throw new Error(`adherence-checker.test: callAgent invoked with no stubbed response (stage prompt: ${config.systemPrompt.slice(0, 60)}…)`)
    }
    const next = callAgentResponses.shift()
    if (next instanceof Error) throw next
    return { output: next, tokensUsed: { prompt: 0, completion: 0 } }
  },
}))

mock.module("../../trace", () => ({
  trace: async () => {},
}))

import { characterMentionedInProse, checkSceneAdherence, findMissingCharacterMentions } from "./adherence-checker"
import type { BeatObligationsContract, ChapterOutline, CharacterProfile, SceneBeat } from "../../types"

const emptyObligations: BeatObligationsContract = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

const STAGE1_PROMPT_PREFIX = "You verify whether the prose ENACTS the scene entry on-page."
const STAGE2_PROMPT_PREFIX = "You enumerate which obligated events from a scene entry are missing from the prose."

beforeEach(() => {
  callAgentResponses = []
  callAgentInvocations.length = 0
})

test("character presence accepts possessive relationship labels with curly apostrophes", () => {
  expect(characterMentionedInProse(
    "Wren's grandmother",
    "Wren’s grandmother gripped the doorframe and whispered a prayer.",
  )).toBe(true)
})

test("character presence does not satisfy possessive relationship labels with owner only", () => {
  expect(characterMentionedInProse(
    "Wren's grandmother",
    "Wren gripped the doorframe and whispered a prayer.",
  )).toBe(false)
})

test("character presence ignores title words when checking titled names", () => {
  expect(characterMentionedInProse("Captain Wren", "The captain waited in the rain.")).toBe(false)
  expect(characterMentionedInProse("Captain Wren", "Wren waited in the rain.")).toBe(true)
})

test("deterministic character presence does not require spelling out the POV character", () => {
  const issues = findMissingCharacterMentions(
    "She walked toward the isolation room door. The handle was cold when she touched it.",
    beat({ characters: ["Istra Vellian"] }),
    outline({ povCharacter: "Istra Vellian" }),
  )

  expect(issues).not.toContain('Character "Istra Vellian" not found in prose')
})

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  // Cast: SceneBeat is z.infer<typeof sceneBeatSchema>, and obligations is
  // a Zod-inferred shape with `objectOutputType<...>` generics. TypeScript
  // sometimes treats two structurally-identical Zod-inferred types as
  // unrelated when the inference path differs (z.infer reaches the same
  // shape via slightly different generic instantiations). The runtime
  // shape is correct; the cast bypasses the nominal-identity check.
  return {
    description: "Istra walks toward the isolation room door.",
    characters: ["Istra Vellian"],
    kind: "action",
    requiredPayoffs: [],
    obligations: emptyObligations,
    ...overrides,
  } as SceneBeat
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Test",
    povCharacter: "Istra Vellian",
    setting: "Clinic",
    purpose: "Test",
    scenes: [],
    targetWords: 1000,
    charactersPresent: ["Istra Vellian"],
    charactersPresentIds: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}

// ── Two-stage gating tests (exp #317) ───────────────────────────────────

const PASS_PROSE = "Istra crossed the corridor and pushed open the isolation room door. The handle was cold under her palm."
const FAIL_PROSE = "Istra stood by the corridor window, watching the rain. She thought about the door but did not move."

test("two-stage: PASS path makes ONLY the binary stage-1 call (no stage 2)", async () => {
  // Stage 1 returns events_present=true → stage 2 must be skipped.
  callAgentResponses = [{ events_present: true, evidence: "pushed open the isolation room door", reasoning: "door action enacted" }]

  const result = await checkSceneAdherence(
    PASS_PROSE,
    beat({ description: "Istra opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(true)
  expect(result.issues).toEqual([])
  expect(callAgentInvocations).toHaveLength(1)
  expect(callAgentInvocations[0].systemPrompt.startsWith(STAGE1_PROMPT_PREFIX)).toBe(true)
})

test("two-stage: FAIL path fires stage 2 and returns per-event detail with quote evidence", async () => {
  // Stage 1 says fail; stage 2 enumerates two events, one missing one enacted.
  callAgentResponses = [
    { events_present: false, evidence: "stood by the corridor window", reasoning: "no door action on-page" },
    {
      obligated_events: [
        { event: "Istra opens the isolation room door", enacted: false, evidence_quote: "thought about the door but did not move" },
        { event: "Istra crosses the corridor", enacted: true, evidence_quote: "stood by the corridor window" },
      ],
      reasoning: "door open is missing; corridor crossing implied",
    },
  ]

  const result = await checkSceneAdherence(
    FAIL_PROSE,
    beat({ description: "Istra crosses the corridor and opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(callAgentInvocations).toHaveLength(2)
  expect(callAgentInvocations[0].systemPrompt.startsWith(STAGE1_PROMPT_PREFIX)).toBe(true)
  expect(callAgentInvocations[1].systemPrompt.startsWith(STAGE2_PROMPT_PREFIX)).toBe(true)

  // Only the unenacted event surfaces in issues, with its quote.
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]).toContain("Scene event missing: Istra opens the isolation room door")
  expect(result.issues[0]).toContain('thought about the door but did not move')
})

// ── L31c: stage-2 override tests (exp #346, 2026-05-02) ────────────────
//
// When stage 1 returns `events_present=false` but stage 2 reports ALL events
// as `enacted: true`, the scene passes (stage 2 overrides stage 1). This aligns
// the two-stage design with its original intent: stage 2 is authoritative
// because it provides per-event quote evidence.
//
// Override fires only on UNANIMOUS enactment. If stage 2 lists ANY event as
// `enacted: false`, the stage-1 fail stands.

test("L31c: stage 1 false, stage 2 all-enacted — scene PASSES (override)", async () => {
  // L24 beat 7 shape: stage 1 called events_present=false (stochastic
  // self-inconsistency on "filling out form = deciding to report"), but stage
  // 2 confirmed all 4 events enacted. Beat must pass after the override.
  callAgentResponses = [
    { events_present: false, evidence: "no door action", reasoning: "door open never happens" },
    {
      obligated_events: [
        { event: "Istra opens the door", enacted: true, evidence_quote: "pushed open the door" },
        { event: "Istra crosses the corridor", enacted: true, evidence_quote: "crossed the corridor" },
      ],
      reasoning: "all events enacted on-page",
    },
  ]

  const result = await checkSceneAdherence(
    PASS_PROSE,
    beat({ description: "Istra crosses the corridor and opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(true)
  expect(result.issues).toEqual([])
  // Both stage 1 and stage 2 must have been invoked.
  expect(callAgentInvocations).toHaveLength(2)
  expect(callAgentInvocations[0].systemPrompt.startsWith(STAGE1_PROMPT_PREFIX)).toBe(true)
  expect(callAgentInvocations[1].systemPrompt.startsWith(STAGE2_PROMPT_PREFIX)).toBe(true)
})

test("L31c: stage 1 false, stage 2 partial-enacted — scene FAILS (no override)", async () => {
  // At least one enacted=false means override does NOT fire.
  callAgentResponses = [
    { events_present: false, evidence: "no door action", reasoning: "door open never happens" },
    {
      obligated_events: [
        { event: "Istra crosses the corridor", enacted: false, evidence_quote: "" },
        { event: "Istra opens the door", enacted: true, evidence_quote: "pushed open" },
      ],
      reasoning: "crossing missing",
    },
  ]

  const result = await checkSceneAdherence(
    FAIL_PROSE,
    beat({ description: "Istra crosses the corridor and opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]).toContain("Scene event missing: Istra crosses the corridor")
})

test("L31c: stage 1 false, stage 2 empty obligated_events — scene FAILS (no override)", async () => {
  // Empty stage-2 enumeration is invalid evidence for an override; preserve
  // the stage-1 failure instead of treating vacuous unanimity as success.
  callAgentResponses = [
    { events_present: false, evidence: "no door action", reasoning: "door open never happens" },
    {
      obligated_events: [],
      reasoning: "no events identified",
    },
  ]

  const result = await checkSceneAdherence(
    FAIL_PROSE,
    beat({ description: "Istra opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(callAgentInvocations).toHaveLength(2)
  expect(result.issues).toEqual(["Scene events not enacted on-page: door open never happens"])
})

test("L31c: stage 1 true — stage 2 never fires, no override path involved", async () => {
  // Pass path: stage 2 must not be invoked at all.
  callAgentResponses = [
    { events_present: true, evidence: "pushed open the isolation room door", reasoning: "door action enacted" },
  ]

  const result = await checkSceneAdherence(
    PASS_PROSE,
    beat({ description: "Istra opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(true)
  expect(result.issues).toEqual([])
  expect(callAgentInvocations).toHaveLength(1)
  expect(callAgentInvocations[0].systemPrompt.startsWith(STAGE1_PROMPT_PREFIX)).toBe(true)
})

test("two-stage: stage 2 transport failure falls back to generic stage-1 message", async () => {
  callAgentResponses = [
    { events_present: false, evidence: "no door action", reasoning: "door open never happens" },
    new Error("simulated stage-2 transport failure"),
  ]

  const result = await checkSceneAdherence(
    FAIL_PROSE,
    beat({ description: "Istra opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(callAgentInvocations).toHaveLength(2)
  expect(result.issues).toEqual(["Scene events not enacted on-page: door open never happens"])
})

test("two-stage: stage 2 emits one issue per missing event when multiple events are absent", async () => {
  callAgentResponses = [
    { events_present: false, evidence: "", reasoning: "two events missing" },
    {
      obligated_events: [
        { event: "Istra crosses the corridor", enacted: false, evidence_quote: "" },
        { event: "Istra opens the isolation room door", enacted: false, evidence_quote: "thought about the door" },
        { event: "Istra steps inside", enacted: true, evidence_quote: "stepped over the threshold" },
      ],
      reasoning: "two of three events missing",
    },
  ]

  const result = await checkSceneAdherence(
    FAIL_PROSE,
    beat({ description: "Istra crosses the corridor, opens the door, and steps inside." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(result.issues).toHaveLength(2)
  // Issue without quote evidence omits the closest-prose suffix.
  expect(result.issues[0]).toBe("Scene event missing: Istra crosses the corridor")
  // Issue with quote evidence includes the closest-prose suffix.
  expect(result.issues[1]).toContain("Scene event missing: Istra opens the isolation room door")
  expect(result.issues[1]).toContain('thought about the door')
})

// ── L39: prose truncation ─────────────────────────────────────────────────
// Heretic ch1 beat 4 root-cause analysis (2026-05-02, novel-1777709036403):
// 52% of writer outputs exceed 2000 chars. The original truncation at 2000
// dropped resolution actions in long action beats, causing adherence FNs.
// The fix raises the limit to 8000 (covers 100% of observed beats).

test("L39: prose truncation preserves beat resolution at chars 2000-3000", async () => {
  callAgentResponses = [{ events_present: true, evidence: "covered", reasoning: "all enacted" }]

  // Build a long-prose beat that has the obligated resolution near char 2400
  // (in the historically-truncated zone). Pre-L39 (limit=2000) would not
  // see "She slid it back into its slot"; post-L39 (limit=8000) does.
  const filler = "The lamplight flickered. ".repeat(80) // ~2000 chars of filler
  const longProse = `Maret pulled her file from the cabinet. ${filler}She slid it back into its slot, untouched.`

  expect(longProse.length).toBeGreaterThan(2000)
  expect(longProse.length).toBeLessThan(8000)

  await checkSceneAdherence(
    longProse,
    beat({ description: "Maret pulls her file, hesitates, reshelves it untouched.", characters: ["Maret"] }),
    outline(),
    [] as CharacterProfile[],
  )

  // The userPrompt sent to stage 1 must contain the resolution action,
  // not just the opening. Pre-L39 this assertion would have failed.
  expect(callAgentInvocations).toHaveLength(1)
  expect(callAgentInvocations[0].userPrompt).toContain("She slid it back into its slot")
})

test("L39: prose truncation cap is 8000 chars (above which the model gets a slice)", async () => {
  callAgentResponses = [{ events_present: true, evidence: "covered", reasoning: "all enacted" }]

  // Build a prose >8000 chars; the resolution is intentionally placed
  // past the 8000 boundary so the test verifies where the cut happens.
  const huge = "The room was vast. ".repeat(500) // ~10000 chars
  const longProse = `Maret entered the records room. ${huge}She finally reshelved the file untouched.`

  expect(longProse.length).toBeGreaterThan(8000)

  await checkSceneAdherence(
    longProse,
    beat({ description: "Maret enters and reshelves the file untouched.", characters: ["Maret"] }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(callAgentInvocations).toHaveLength(1)
  // The opening (well within 8000) is present.
  expect(callAgentInvocations[0].userPrompt).toContain("Maret entered the records room")
  // The far-tail resolution (past 8000) is NOT present — confirms the
  // cap exists and beats >8000 are still partially truncated. If we
  // need to bump the cap further, this test fails loudly.
  expect(callAgentInvocations[0].userPrompt).not.toContain("She finally reshelved the file untouched")
})
