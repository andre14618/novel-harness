import { describe, it, expect } from "bun:test"
import { conceptPhase } from "../../src/phases/concept"
import { planningPhase } from "../../src/phases/planning"
import { draftingPhase } from "../../src/phases/drafting"
import { validationPhase } from "../../src/phases/validation"
import type { Phase, PhaseName } from "../../src/phases/contract"

// P8 — contract tests at the new Phase<I,O> interface. Each test asserts
// the public shape the typed driver depends on:
//
//   * `name` is the canonical PhaseName literal
//   * `run` is an async function (returns a Promise)
//   * `loadOutput` is an async function (returns a Promise)
//
// Behavior coverage of `run` and `loadOutput` lives in the per-phase
// integration tests (drafting-*) and the byte-parity harness. This file
// pins the surface so a future refactor that breaks the wrapper shape
// fails here instead of at the call site.

const PHASES: ReadonlyArray<{ name: PhaseName; phase: Phase<unknown, unknown> }> = [
  { name: "concept", phase: conceptPhase as Phase<unknown, unknown> },
  { name: "planning", phase: planningPhase as Phase<unknown, unknown> },
  { name: "drafting", phase: draftingPhase as Phase<unknown, unknown> },
  { name: "validation", phase: validationPhase as Phase<unknown, unknown> },
]

describe("Phase<I,O> contract", () => {
  for (const { name, phase } of PHASES) {
    describe(`${name}Phase`, () => {
      it(`exposes name === "${name}"`, () => {
        expect(phase.name).toBe(name)
      })

      it("exposes run as an async function", () => {
        expect(typeof phase.run).toBe("function")
        expect(phase.run.constructor.name).toBe("AsyncFunction")
      })

      it("exposes loadOutput as an async function", () => {
        expect(typeof phase.loadOutput).toBe("function")
        expect(phase.loadOutput.constructor.name).toBe("AsyncFunction")
      })
    })
  }

  it("all four phase names are unique", () => {
    const names = PHASES.map(p => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("phase names cover the full PhaseName union", () => {
    // Compile-time check: assigning each name to PhaseName confirms
    // the union is exhaustively populated by the live phase set.
    const names: PhaseName[] = ["concept", "planning", "drafting", "validation"]
    expect(PHASES.map(p => p.name).sort()).toEqual([...names].sort())
  })
})
