import { describe, expect, test } from "bun:test"

import { buildPlanCheckDriftWitnessPayload } from "./plan-check-drift-witness"
import type { ChapterPlanCheckResult } from "../agents/chapter-plan-checker/schema"

describe("plan-check-drift-witness", () => {
  test("builds stable beat refs and repeat counts for unresolved deviations", () => {
    const initial: ChapterPlanCheckResult = {
      pass: false,
      deviations: [
        { beat_index: 1, description: "Emotional arc reversed from plan." },
        { beat_index: null, description: "Chapter ends in the wrong setting." },
      ],
    }
    const final: ChapterPlanCheckResult = {
      pass: false,
      deviations: [
        { beat_index: 1, description: "  Emotional arc reversed FROM plan. " },
        { beat_index: 2, beatId: "beat-explicit", description: "New unresolved beat issue." },
      ],
    }

    const payload = buildPlanCheckDriftWitnessPayload({
      result: final,
      outline: {
        scenes: [
          { beatId: "beat-one" },
          { beatId: "beat-two" },
          { beatId: "beat-three" },
        ],
      },
      settleKind: "exhausted",
      rewritePass: 2,
      history: [initial, final],
    })

    expect(payload).toEqual({
      source: "post-settle",
      passed: false,
      settled: false,
      outcome: "exhausted",
      rewritePassCount: 2,
      forcedPlanCheck: false,
      deviationCount: 2,
      stableBeatRefs: ["beat-two", "beat-explicit"],
      witnesses: [{
        beatIndex: 1,
        beatLabel: 2,
        beatId: "beat-two",
        description: "  Emotional arc reversed FROM plan. ",
        seenCount: 2,
        persistedAcrossPasses: true,
      }, {
        beatIndex: 2,
        beatLabel: 3,
        beatId: "beat-explicit",
        description: "New unresolved beat issue.",
        seenCount: 1,
        persistedAcrossPasses: false,
      }],
    })
  })
})
