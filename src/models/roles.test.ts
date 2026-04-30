import { describe, expect, test } from "bun:test"
import { resolveStructuralPriors, resolveWriterPack } from "./roles"

const WRITER_ENV_KEYS = [
  "WRITER_MODEL_OVERRIDE",
  "WRITER_PROVIDER_OVERRIDE",
  "WRITER_COMPACT_CONTEXT_OVERRIDE",
  "WRITER_CONDITIONING",
] as const

describe("writer genre pack routing", () => {
  test("production fantasy route keeps Salvatore adapter-specific context and leak profile", () => {
    withWriterEnv({}, () => {
      const pack = resolveWriterPack("dark fantasy")
      expect(pack?.label).toBe("salvatore-fantasy")
      expect(pack?.model.provider).toBe("wandb")
      expect(pack?.model.model).toContain("salvatore-1988-v4")
      expect(pack?.compactContext).toBe(true)
      expect(pack?.leakProfile).toBe("salvatore")
    })
  })

  test("base-model override keeps fantasy priors but uses rich context and no corpus leak profile", () => {
    withWriterEnv({
      WRITER_MODEL_OVERRIDE: "deepseek-v4-flash",
      WRITER_PROVIDER_OVERRIDE: "deepseek",
    }, () => {
      const pack = resolveWriterPack("dark fantasy")
      const priors = resolveStructuralPriors("dark fantasy")

      expect(pack?.label).toBe("salvatore-fantasy")
      expect(pack?.model.provider).toBe("deepseek")
      expect(pack?.model.model).toBe("deepseek-v4-flash")
      expect(pack?.compactContext).toBe(false)
      expect(pack?.leakProfile).toBeUndefined()
      expect(priors?.beatsPerChapter).toEqual([11, 40])
    })
  })

  test("compact context can still be explicitly forced for route experiments", () => {
    withWriterEnv({
      WRITER_MODEL_OVERRIDE: "deepseek-v4-flash",
      WRITER_PROVIDER_OVERRIDE: "deepseek",
      WRITER_COMPACT_CONTEXT_OVERRIDE: "true",
    }, () => {
      const pack = resolveWriterPack("dark fantasy")

      expect(pack?.model.provider).toBe("deepseek")
      expect(pack?.compactContext).toBe(true)
      expect(pack?.leakProfile).toBeUndefined()
    })
  })
})

function withWriterEnv(env: Partial<Record<(typeof WRITER_ENV_KEYS)[number], string>>, run: () => void): void {
  const previous = new Map<string, string | undefined>()
  for (const key of WRITER_ENV_KEYS) {
    previous.set(key, process.env[key])
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }

  try {
    run()
  } finally {
    for (const key of WRITER_ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
