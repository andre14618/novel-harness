// Fallback only — roles.ts is the source of truth (see llm.ts:111). These
// values are used when getAgentConfig() returns undefined, which in practice
// never happens because AGENT_MODELS has an entry for this agent.
export const config = {
  name: "planning-plotter",
  temperature: 0.6,
  maxTokens: 8192,
  thinking: false,
}
