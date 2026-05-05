import { afterEach, describe, expect, test } from "bun:test"
import {
  directArtifactPutDisabledResponse,
  directArtifactPutEnabled,
} from "./direct-artifact-put-gate"

const originalAllowDirectArtifactPut = process.env.ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT
const originalDebugInjection = process.env.DEBUG_ENABLE_INJECTION

afterEach(() => {
  if (originalAllowDirectArtifactPut === undefined) delete process.env.ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT
  else process.env.ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT = originalAllowDirectArtifactPut

  if (originalDebugInjection === undefined) delete process.env.DEBUG_ENABLE_INJECTION
  else process.env.DEBUG_ENABLE_INJECTION = originalDebugInjection
})

function resetDirectPutEnv(): void {
  delete process.env.ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT
  delete process.env.DEBUG_ENABLE_INJECTION
}

describe("handleNovelRoute direct artifact PUT gate", () => {
  test.each([
    "/api/novel/novel-1/world-bible",
    "/api/novel/novel-1/story-spine",
    "/api/novel/novel-1/character/char-1",
  ])("%s is disabled by default", async (path) => {
    void path
    resetDirectPutEnv()
    expect(directArtifactPutEnabled()).toBe(false)
    const res = directArtifactPutDisabledResponse()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain("Direct artifact PUT routes are disabled by default")
    expect(body.enableWith).toContain("ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT=1")
    expect(body.enableWith).not.toContain("DEBUG_ENABLE_INJECTION")
  })

  test.each([
    "/api/novel/novel-1/world-bible",
    "/api/novel/novel-1/story-spine",
    "/api/novel/novel-1/character/char-1",
  ])("%s stays disabled under broad debug injection", async (path) => {
    void path
    delete process.env.ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT
    process.env.DEBUG_ENABLE_INJECTION = "true"
    expect(directArtifactPutEnabled()).toBe(false)
  })

  test("explicit artifact PUT opt-in enables the gate", () => {
    resetDirectPutEnv()
    process.env.ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT = "1"
    expect(directArtifactPutEnabled()).toBe(true)
  })
})
