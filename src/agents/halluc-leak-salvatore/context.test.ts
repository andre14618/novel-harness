import { test, expect } from "bun:test"
import { buildContext } from "./context"

test("prose-only: renders PROSE header + prose body verbatim", () => {
  const prose = "The horn sounded twice, brief and final."
  const out = buildContext(prose)
  expect(out).toBe(`PROSE:\n${prose}`)
})

test("empty prose still emits the PROSE header (no crash)", () => {
  const out = buildContext("")
  expect(out).toBe("PROSE:\n")
})

test("multi-line prose is preserved without rewrapping or trimming", () => {
  const prose = "Line one.\nLine two.\n\nLine four after a blank."
  const out = buildContext(prose)
  expect(out).toBe(`PROSE:\n${prose}`)
})

test("prose with leak-adjacent tokens is not pre-filtered by the renderer", () => {
  // The renderer must pass prose through unchanged — token detection is
  // the adapter's job. Including a token in the test input should not
  // cause the renderer to mutate or redact anything.
  const prose = "She walked past the walls of Mithril Hall without a glance."
  const out = buildContext(prose)
  expect(out).toContain("Mithril Hall")
  expect(out.endsWith(prose)).toBe(true)
})
