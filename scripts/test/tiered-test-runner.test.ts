import { describe, expect, it } from "bun:test"
import { planFileTestCommands } from "./tiered-test-runner"

describe("tiered-test-runner command planning", () => {
  it("runs process-global mock phase tests in isolated fast subprocesses", () => {
    const commands = planFileTestCommands("fast", [
      "src/phases/drafting-revision-used-persistence.test.ts",
      "tests/phases/phase-contract.test.ts",
      "ui/src/api.test.ts",
    ])

    expect(commands.map(command => command.cmd)).toEqual([
      [
        "bun",
        "test",
        "--timeout",
        "30000",
        "tests/phases/phase-contract.test.ts",
        "ui/src/api.test.ts",
      ],
      [
        "bun",
        "test",
        "--timeout",
        "30000",
        "src/phases/drafting-revision-used-persistence.test.ts",
      ],
    ])
  })

  it("keeps replay tests chunked because replay has its own process tier", () => {
    const commands = planFileTestCommands("replay", [
      "tests/phase-parity/normalize.test.ts",
      "tests/phase-parity/phase-parity.test.ts",
    ])

    expect(commands).toHaveLength(1)
    expect(commands[0].cmd).toContain("tests/phase-parity/phase-parity.test.ts")
  })
})
