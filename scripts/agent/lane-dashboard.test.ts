import { describe, expect, test } from "bun:test"
import { parseArgs, renderInPlaceFrame, renderWatchFrame, shouldRenderSingleSnapshotInsteadOfWatch } from "./lane-dashboard"

describe("lane-dashboard watch rendering", () => {
  test("parses watch options", () => {
    const args = parseArgs(["docs/sessions/lane.md", "--watch", "--append", "--interval-sec", "2", "--panel", "outside,coordination"])
    expect(args.watch).toBe(true)
    expect(args.append).toBe(true)
    expect(args.intervalSeconds).toBe(2)
    expect(args.panels).toEqual(["outside", "coordination"])
  })

  test("adds an explicit monitor footer", () => {
    const frame = renderWatchFrame("Lane Dashboard\nstate: CONTINUE", { append: false, intervalSeconds: 5 }, 123)
    expect(frame).toContain("Monitor:")
    expect(frame).toContain("mode: stable in-place redraw")
    expect(frame).toContain("refresh: every 5s; stop: Ctrl-C; render_ms=123")
    expect(frame).toContain("snapshot is collected before redraw")
  })

  test("renders in-place frames without clearing before snapshot content", () => {
    const frame = renderInPlaceFrame("Lane Dashboard\nstate: CONTINUE")
    expect(frame.startsWith("\x1b[HLane Dashboard")).toBe(true)
    expect(frame.endsWith("\x1b[J")).toBe(true)
    expect(frame).not.toContain("\x1b[H\x1b[JLane Dashboard")
  })

  test("does not repeat watch frames when stdout is not a TTY", () => {
    expect(shouldRenderSingleSnapshotInsteadOfWatch(false, false)).toBe(true)
    expect(shouldRenderSingleSnapshotInsteadOfWatch(false, true)).toBe(false)
    expect(shouldRenderSingleSnapshotInsteadOfWatch(true, false)).toBe(false)
  })
})
