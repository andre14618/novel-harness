import { expect, test, describe } from "bun:test"
import { parseConceptFixture, parseFrozenPlanManifest } from "./scene-first-fixture-schema"

describe("parseConceptFixture", () => {
  const validConcept = {
    fixture_metadata: {
      profile: "P1-over-target",
      expected_baseline_ratio: ">=1.5",
      expected_baseline_failures: ["a", "b"],
    },
    concept: {
      premise: "test premise",
      genre: "epic-fantasy",
      chapterCount: 2,
      characters: [{ name: "X", role: "protagonist", description: "..." }],
    },
  }

  test("parses a minimal valid P1 fixture", () => {
    const out = parseConceptFixture(validConcept, "test.json")
    expect(out.fixture_metadata.profile).toBe("P1-over-target")
    expect(out.fixture_metadata.expected_baseline_failures).toEqual(["a", "b"])
    expect(out.concept.premise).toBe("test premise")
    expect(out.concept.chapterCount).toBe(2)
  })

  test("preserves optional pre_resolved_entities and scene_contract_target", () => {
    const fixture = {
      ...validConcept,
      pre_resolved_entities: { officers_named_in_seed: ["A", "B"] },
      scene_contract_target: { fields_populated: ["goal"], fields_null: ["opposition"] },
    }
    const out = parseConceptFixture(fixture, "test.json")
    expect(out.pre_resolved_entities).toEqual({ officers_named_in_seed: ["A", "B"] })
    expect(out.scene_contract_target).toEqual({ fields_populated: ["goal"], fields_null: ["opposition"] })
  })

  test("rejects P4 fixtures (concept loader is for P1/P2/P3 only)", () => {
    const fixture = {
      ...validConcept,
      fixture_metadata: { ...validConcept.fixture_metadata, profile: "P4-real-runtime" },
    }
    expect(() => parseConceptFixture(fixture, "p4.json")).toThrow(/P4-real-runtime.*frozen-plan/i)
  })

  test("rejects unknown profile values", () => {
    const fixture = {
      ...validConcept,
      fixture_metadata: { ...validConcept.fixture_metadata, profile: "P9-unknown" },
    }
    expect(() => parseConceptFixture(fixture, "x.json")).toThrow(/profile must be one of/)
  })

  test("rejects missing premise", () => {
    const fixture = { ...validConcept, concept: { genre: "x", chapterCount: 1 } }
    expect(() => parseConceptFixture(fixture, "x.json")).toThrow(/concept.premise/)
  })

  test("rejects non-finite chapterCount", () => {
    const fixture = {
      ...validConcept,
      concept: { ...validConcept.concept, chapterCount: "many" },
    }
    expect(() => parseConceptFixture(fixture, "x.json")).toThrow(/chapterCount must be a finite number/)
  })

  test("rejects non-object root", () => {
    expect(() => parseConceptFixture(null, "x.json")).toThrow(/must be an object/)
    expect(() => parseConceptFixture([1, 2], "x.json")).toThrow(/must be an object/)
  })

  test("rejects non-string-array expected_baseline_failures", () => {
    const fixture = {
      ...validConcept,
      fixture_metadata: { ...validConcept.fixture_metadata, expected_baseline_failures: [1, 2] },
    }
    expect(() => parseConceptFixture(fixture, "x.json")).toThrow(/expected_baseline_failures.*array of strings/)
  })

  test("carries through extra concept fields the runtime accepts", () => {
    const fixture = {
      ...validConcept,
      concept: {
        ...validConcept.concept,
        worldFacts: ["one", "two"],
        pipelineOverrides: { customFlag: true },
      },
    }
    const out = parseConceptFixture(fixture, "x.json")
    expect((out.concept as Record<string, unknown>).worldFacts).toEqual(["one", "two"])
    expect((out.concept as Record<string, unknown>).pipelineOverrides).toEqual({ customFlag: true })
  })
})

describe("parseFrozenPlanManifest", () => {
  const stub = {
    fixture_metadata: {
      profile: "P4-real-runtime",
      expected_baseline_ratio: "1.89-3.03",
      expected_baseline_failures: [],
    },
    is_stub: true,
  }

  test("parses a stub manifest without outlines", () => {
    const out = parseFrozenPlanManifest(stub, "stub.json")
    expect(out.is_stub).toBe(true)
    expect(out.outlines).toEqual([])
  })

  test("rejects non-P4 profiles", () => {
    const wrong = { ...stub, fixture_metadata: { ...stub.fixture_metadata, profile: "P1-over-target" } }
    expect(() => parseFrozenPlanManifest(wrong, "x.json")).toThrow(/must declare profile P4-real-runtime/)
  })

  test("rejects non-stub manifest with no outlines array", () => {
    const noOutlines = {
      fixture_metadata: {
        profile: "P4-real-runtime",
        expected_baseline_ratio: "1.89-3.03",
        expected_baseline_failures: [],
      },
    }
    expect(() => parseFrozenPlanManifest(noOutlines, "x.json")).toThrow(/outlines.*array.*is_stub/)
  })

  test("parses a non-stub manifest with outline rows", () => {
    const full = {
      fixture_metadata: {
        profile: "P4-real-runtime",
        expected_baseline_ratio: "1.89-3.03",
        expected_baseline_failures: [],
        source_novel_id: "novel-1778411555121",
        captured_at: "2026-05-10T11:15:55Z",
      },
      outlines: [
        { chapterNumber: 1, outline_json: { title: "ch1", scenes: [] } },
        { chapterNumber: 2, outline_json: { title: "ch2", scenes: [] } },
      ],
    }
    const out = parseFrozenPlanManifest(full, "full.json")
    expect(out.outlines.length).toBe(2)
    expect(out.outlines[0]!.chapterNumber).toBe(1)
    expect(out.fixture_metadata.source_novel_id).toBe("novel-1778411555121")
    expect(out.fixture_metadata.captured_at).toBe("2026-05-10T11:15:55Z")
  })

  test("rejects outline entry missing chapterNumber", () => {
    const bad = {
      fixture_metadata: {
        profile: "P4-real-runtime",
        expected_baseline_ratio: "1.89-3.03",
        expected_baseline_failures: [],
      },
      outlines: [{ outline_json: {} }],
    }
    expect(() => parseFrozenPlanManifest(bad, "x.json")).toThrow(/chapterNumber must be a finite number/)
  })

  test("rejects outline entry missing outline_json", () => {
    const bad = {
      fixture_metadata: {
        profile: "P4-real-runtime",
        expected_baseline_ratio: "1.89-3.03",
        expected_baseline_failures: [],
      },
      outlines: [{ chapterNumber: 1 }],
    }
    expect(() => parseFrozenPlanManifest(bad, "x.json")).toThrow(/outline_json is required/)
  })
})
