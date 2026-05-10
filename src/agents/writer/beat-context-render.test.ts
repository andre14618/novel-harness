import { expect, test } from "bun:test"

import { renderBeatContext } from "./beat-context-render"
import type { BeatContext } from "./beat-context"

test("renderBeatContext includes compact planner-authored beat obligations", () => {
  const rendered = renderBeatContext({
    beatSpec: {
      beatNumber: 1,
      totalBeats: 2,
      pov: "Calla",
      setting: "Iron Hall",
      kind: "action",
      description: "Calla discovers forbidden script on Davan's skin.",
      charactersPresent: ["Calla", "Davan"],
      seeds: [],
      payoffsDue: [],
      obligations: {
        mustEstablish: [{ id: "old-script", text: "Davan bears pre-imperial inscriptions" }],
        mustPayOff: [],
        mustTransferKnowledge: [{ characterName: "Calla", text: "Calla learns the script predates the empire" }],
        mustShowStateChange: [{ characterName: "Calla", text: "Calla moves from detached executioner to shaken witness" }],
        mustNotReveal: [{ text: "Do not reveal Orvath's full plan yet" }],
        allowedNewEntities: ["Old Tongue"],
      },
    },
    transitionBridge: null,
    landingTarget: null,
    characterSnapshots: [],
    resolvedReferencesText: null,
    readerInfoState: null,
    setting: null,
  } satisfies BeatContext, { compact: false })

  expect(rendered).toContain("BEAT OBLIGATIONS:")
  expect(rendered).toContain("Must establish:")
  expect(rendered).toContain("  - Davan bears pre-imperial inscriptions")
  expect(rendered).toContain("Must transfer knowledge:")
  expect(rendered).toContain("  - Calla: Calla learns the script predates the empire")
  expect(rendered).toContain("Allowed new named entities:")
  expect(rendered).toContain("  - Old Tongue")
})

// L38-A: prior-chapter reader-info state placement + compact-mode parity.
//
// The slot is rendered as a standalone section between resolvedReferencesText
// and setting, mirroring `insertEnrichedSection`'s anchor in the Arm B
// preflight (enriched-context.ts:328). When the slot is null (chapter 1 or
// no prior signal), no section is emitted — protecting the byte-parity gate.
test("renderBeatContext emits readerInfoState before SETTING when present", () => {
  const ctx: BeatContext = {
    beatSpec: {
      beatNumber: 1,
      totalBeats: 1,
      pov: "Maret",
      setting: "Temple",
      kind: "action",
      description: "Maret enters the High Temple.",
      charactersPresent: ["Maret"],
      seeds: [],
      payoffsDue: [],
      obligations: {
        mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [],
        mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
      },
    },
    transitionBridge: null,
    landingTarget: null,
    characterSnapshots: [],
    resolvedReferencesText: null,
    readerInfoState: "READER-INFO STATE:\nReader already knows:\n- [ch1] Maret copied the sealed report months ago",
    setting: { name: "High Temple", description: "Marble vault.", sensoryDetails: "incense, cold stone" },
  }
  const rendered = renderBeatContext(ctx, { compact: false })
  const readerIdx = rendered.indexOf("READER-INFO STATE:")
  const settingIdx = rendered.indexOf("SETTING:")
  expect(readerIdx).toBeGreaterThan(0)
  expect(settingIdx).toBeGreaterThan(readerIdx)
  expect(rendered).toContain("Reader already knows:")
  expect(rendered).toContain("[ch1] Maret copied the sealed report months ago")
})

test("renderBeatContext omits readerInfoState section when slot is null", () => {
  const ctx: BeatContext = {
    beatSpec: {
      beatNumber: 1,
      totalBeats: 1,
      pov: "Maret",
      setting: "Guildhall",
      kind: "action",
      description: "Maret opens the floorboard.",
      charactersPresent: ["Maret"],
      seeds: [],
      payoffsDue: [],
      obligations: {
        mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [],
        mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
      },
    },
    transitionBridge: null,
    landingTarget: null,
    characterSnapshots: [],
    resolvedReferencesText: null,
    readerInfoState: null,
    setting: null,
  }
  const rendered = renderBeatContext(ctx, { compact: false })
  expect(rendered).not.toContain("READER-INFO STATE:")
})

test("renderBeatContext emits character context capsules when supplied", () => {
  const ctx: BeatContext = {
    beatSpec: {
      beatNumber: 1,
      totalBeats: 1,
      pov: "Noor",
      setting: "Deep Stacks",
      kind: "dialogue",
      description: "Noor chooses whether to trust Cassius.",
      charactersPresent: ["Noor", "Cassius"],
      seeds: [],
      payoffsDue: [],
      obligations: {
        mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [],
        mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
      },
    },
    transitionBridge: null,
    landingTarget: null,
    characterSnapshots: [],
    characterContextCapsules: {
      mode: "thread-character-context-v1",
      scope: "beat",
      chapterId: "ch-001-deep-stacks",
      beatId: "beat-001-trust-choice",
      beatNumber: 1,
      povCharacterId: "char-noor",
      povPersonalStake: "Noor's need to be useful conflicts with her fear of being erased.",
      activeThreadIds: ["thread-inquiry"],
      activePromiseIds: ["debt-folio"],
      activePayoffIds: [],
      cards: [{
        characterId: "char-noor",
        name: "Noor",
        role: "protagonist",
        sceneRole: "pov",
        want: "Preserve the folio's truth.",
        need: "Trust someone else with danger.",
        sourceObligationIds: ["obl-trust-choice"],
        activeThreadIds: ["thread-inquiry"],
        activePromiseIds: ["debt-folio"],
        activePayoffIds: [],
      }],
      missingCharacterIds: [],
    },
    resolvedReferencesText: "RESOLVED REFERENCES:\n- folio",
    readerInfoState: null,
    setting: null,
  }

  const rendered = renderBeatContext(ctx, { compact: false })
  expect(rendered).toContain("CHARACTER CONTEXT CAPSULES:")
  expect(rendered).toContain("POV personal stake: Noor's need to be useful")
  expect(rendered).toContain("- Noor [char-noor] (pov; protagonist)")
  expect(rendered.indexOf("CHARACTER CONTEXT CAPSULES:")).toBeLessThan(rendered.indexOf("RESOLVED REFERENCES:"))

  // L099 / adjusted-B1: idRendering="suppress" hides Cluster-1 raw-ID lines
  // while preserving every semantic field. Default ("raw" / undefined) is
  // byte-identical to the legacy renderer (covered above).
  const suppressed = renderBeatContext(ctx, { compact: false, idRendering: "suppress" })
  expect(suppressed).toContain("CHARACTER CONTEXT CAPSULES:")
  expect(suppressed).toContain("POV personal stake: Noor's need to be useful")
  expect(suppressed).toContain("- Noor (pov; protagonist)")
  expect(suppressed).not.toContain("Chapter ID:")
  expect(suppressed).not.toContain("Beat ID:")
  expect(suppressed).not.toContain("POV character ID:")
  expect(suppressed).not.toContain("Active thread refs:")
  expect(suppressed).not.toContain("Active promise refs:")
  expect(suppressed).not.toContain("Source obligations:")
  expect(suppressed).not.toContain("Active threads:")
  expect(suppressed).not.toContain("[char-noor]")
  expect(suppressed).not.toContain("thread-inquiry")
  expect(suppressed).not.toContain("debt-folio")
  expect(suppressed).not.toContain("obl-trust-choice")
})
