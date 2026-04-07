import db from "../../data/connection"

export interface LLMCallRow {
  novelId?: string
  agentName?: string
  model: string
  provider: string
  latencyMs: number
  promptTokens: number
  completionTokens: number
  httpAttempts: number
}

export async function saveLLMCall(call: LLMCallRow): Promise<void> {
  await db`INSERT INTO llm_calls (novel_id, agent_name, model, provider, latency_ms, prompt_tokens, completion_tokens, http_attempts)
           VALUES (${call.novelId ?? null}, ${call.agentName ?? null}, ${call.model}, ${call.provider},
                   ${call.latencyMs}, ${call.promptTokens}, ${call.completionTokens}, ${call.httpAttempts})`
}
