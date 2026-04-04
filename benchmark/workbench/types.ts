export type TransportMode = "realtime" | "batch"

export interface WorkbenchConfig {
  name: string
  suite: "prose" | "planning" | "extraction" | "continuity"
  models: Array<{
    id: string
    provider: string
    label: string
    maxTokens?: number
  }>
  evaluations: {
    penaltyJudges: boolean
    lint: boolean
    pairwise: boolean
  }
  transport: {
    generation: TransportMode
    judging: TransportMode
  }
  seeds: string[]
  runsPerSeed: number
  judgeModel?: { id: string; provider: string }
  /** Reuse prose from an existing run instead of generating new prose */
  sourceRunId?: number
}
