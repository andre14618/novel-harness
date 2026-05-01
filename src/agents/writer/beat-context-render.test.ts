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
