import { describe, expect, test } from "bun:test"
import {
  deriveClass,
  summarizeByClass,
  formatPerClassTable,
  type AbInputRow,
  type AbResultRow,
} from "../scripts/hallucination/per-class-summary"

function row(
  input: AbInputRow,
  status: AbResultRow["calibration_status"],
  fixtureId: string,
): { input: AbInputRow; result: AbResultRow } {
  return {
    input,
    result: {
      fixture_id: fixtureId,
      case_role: input.case_role,
      calibration_status: status,
    },
  }
}

describe("deriveClass", () => {
  test("synthetic row uses fixture_class", () => {
    expect(
      deriveClass({ case_role: "synthetic_fixture", fixture_class: "title-surname" }),
    ).toBe("title-surname")
  })

  test("synthetic row appends entity_class subclass when present", () => {
    expect(
      deriveClass({
        case_role: "synthetic_fixture",
        fixture_class: "synthetic_entity_insertion",
        entity_class: "place",
      }),
    ).toBe("synthetic_entity_insertion::place")
  })

  test("natural row uses gold.calibration_status", () => {
    expect(
      deriveClass({
        case_role: "current_surface_natural",
        gold: { calibration_status: "FN" },
      }),
    ).toBe("natural_FN")
  })

  test("natural row without label collapses to natural_unlabeled", () => {
    expect(deriveClass({ case_role: "current_surface_natural" })).toBe("natural_unlabeled")
  })

  test("unknown shape collapses to unclassified", () => {
    expect(deriveClass({})).toBe("unclassified")
  })
})

describe("summarizeByClass", () => {
  test("aggregates per-class counts and computes recall/precision/F1", () => {
    const joined = [
      // title-surname: 2 expected fail, 1 caught (TP), 1 missed (FN), no controls
      row(
        { case_role: "synthetic_fixture", fixture_class: "title-surname" },
        "TP",
        "ts-1",
      ),
      row(
        { case_role: "synthetic_fixture", fixture_class: "title-surname" },
        "FN",
        "ts-2",
      ),
      // generic-document-fp-control: 2 pass controls, 1 wrongly flagged (FP)
      row(
        { case_role: "synthetic_fixture", fixture_class: "generic-document-fp-control" },
        "FP",
        "gd-1",
      ),
      row(
        { case_role: "synthetic_fixture", fixture_class: "generic-document-fp-control" },
        "TN",
        "gd-2",
      ),
      // natural rows partition by gold status
      row(
        {
          case_role: "current_surface_natural",
          gold: { calibration_status: "TN" },
        },
        "TN",
        "nat-1",
      ),
      row(
        {
          case_role: "current_surface_natural",
          gold: { calibration_status: "FN" },
        },
        "FN",
        "nat-2",
      ),
    ]

    const out = summarizeByClass(joined)
    const byClass = Object.fromEntries(out.map(e => [e.class, e]))

    expect(byClass["title-surname"]).toMatchObject({
      n: 2,
      TP: 1,
      FP: 0,
      FN: 1,
      TN: 0,
      recall_pct: 50,
      precision_pct: 100,
      f1_pct: 66.7,
    })

    expect(byClass["generic-document-fp-control"]).toMatchObject({
      n: 2,
      TP: 0,
      FP: 1,
      FN: 0,
      TN: 1,
      recall_pct: null,
      precision_pct: 0,
      f1_pct: null,
    })

    expect(byClass["natural_TN"]).toMatchObject({ n: 1, TN: 1 })
    expect(byClass["natural_FN"]).toMatchObject({ n: 1, FN: 1, recall_pct: 0 })
  })

  test("classes are returned in deterministic alphabetical order", () => {
    const joined = [
      row({ case_role: "synthetic_fixture", fixture_class: "z-class" }, "TN", "z"),
      row({ case_role: "synthetic_fixture", fixture_class: "a-class" }, "TN", "a"),
      row({ case_role: "synthetic_fixture", fixture_class: "m-class" }, "TN", "m"),
    ]
    const order = summarizeByClass(joined).map(e => e.class)
    expect(order).toEqual(["a-class", "m-class", "z-class"])
  })
})

describe("formatPerClassTable", () => {
  test("returns placeholder when no rows", () => {
    expect(formatPerClassTable([])).toBe("(no rows)")
  })

  test("renders a markdown table with all columns", () => {
    const joined = [
      row({ case_role: "synthetic_fixture", fixture_class: "title-surname" }, "TP", "x"),
    ]
    const table = formatPerClassTable(summarizeByClass(joined))
    expect(table).toContain("class")
    expect(table).toContain("title-surname")
    expect(table).toContain("recall")
    expect(table).toContain("precision")
    expect(table).toContain("F1")
  })
})
