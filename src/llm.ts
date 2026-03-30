import { z } from "zod"

const MODEL = process.env.MODEL ?? "stepfun/step-3.5-flash:free"
const API_URL = "https://openrouter.ai/api/v1/chat/completions"

interface AgentConfig<T> {
  systemPrompt: string
  userPrompt: string
  schema: z.ZodSchema<T>
  temperature?: number
  maxTokens?: number
}

interface AgentResult<T> {
  output: T
  tokensUsed: { prompt: number; completion: number }
}

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error("OPENROUTER_API_KEY not set in .env")
  return key
}

export function extractJSON(raw: string): string {
  // Try 1: raw string is valid JSON
  try {
    JSON.parse(raw)
    return raw
  } catch {}

  // Try 2: extract from ```json ... ``` code blocks
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlockMatch) {
    try {
      JSON.parse(codeBlockMatch[1].trim())
      return codeBlockMatch[1].trim()
    } catch {}
  }

  // Try 3: find first { ... } or [ ... ]
  const braceStart = raw.indexOf("{")
  const bracketStart = raw.indexOf("[")
  let start = -1

  if (braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart)) {
    start = braceStart
  } else if (bracketStart >= 0) {
    start = bracketStart
  }

  if (start >= 0) {
    const openChar = raw[start]
    const closeChar = openChar === "{" ? "}" : "]"
    let depth = 0
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === openChar) depth++
      else if (raw[i] === closeChar) depth--
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1)
        try {
          JSON.parse(candidate)
          return candidate
        } catch {}
      }
    }
  }

  throw new Error(`Could not extract JSON from response:\n${raw.slice(0, 500)}`)
}

async function makeRequest(
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const maxRetries = 3
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  })
  const headers = {
    "Authorization": `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(API_URL, { method: "POST", headers, body })

    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxRetries) {
        const text = await res.text()
        throw new Error(`LLM request failed after ${maxRetries} retries: ${res.status} ${text}`)
      }
      const delay = (attempt + 1) * 5000 // 5s, 10s, 15s
      console.log(`  [LLM] ${res.status} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`)
      await Bun.sleep(delay)
      continue
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`LLM request failed: ${res.status} ${text}`)
    }

    const data = await res.json() as any
    if (data.error) {
      throw new Error(`LLM error: ${JSON.stringify(data.error)}`)
    }
    return {
      content: data.choices[0].message.content,
      usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
    }
  }

  throw new Error("LLM request: unreachable")
}

let totalTokens = { prompt: 0, completion: 0 }

export function getTokenUsage() {
  return { ...totalTokens }
}

export async function callAgent<T>(config: AgentConfig<T>): Promise<AgentResult<T>> {
  const temperature = config.temperature ?? 0.7
  const maxTokens = config.maxTokens ?? 4096

  console.log(`  [LLM] Calling ${MODEL} (temp=${temperature})...`)

  const { content, usage } = await makeRequest(
    config.systemPrompt,
    config.userPrompt,
    temperature,
    maxTokens,
  )

  totalTokens.prompt += usage.prompt_tokens
  totalTokens.completion += usage.completion_tokens
  console.log(`  [LLM] Response: ${usage.prompt_tokens}+${usage.completion_tokens} tokens`)

  // Parse JSON from response
  let jsonStr: string
  try {
    jsonStr = extractJSON(content)
  } catch (e) {
    // Retry once without response_format (model might not support it)
    console.log("  [LLM] JSON extraction failed, retrying without response_format...")
    const retry = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: config.systemPrompt + "\n\nIMPORTANT: Respond ONLY with valid JSON. No other text." },
          { role: "user", content: config.userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    })
    if (!retry.ok) throw new Error(`LLM retry failed: ${retry.status}`)
    const data = await retry.json() as any
    const retryContent = data.choices[0].message.content
    jsonStr = extractJSON(retryContent)
  }

  // Parse with Zod
  const parsed = JSON.parse(jsonStr)

  if (parsed === null || parsed === undefined) {
    throw new Error("LLM returned null/undefined instead of a JSON object")
  }

  const result = config.schema.safeParse(parsed)

  if (!result.success) {
    console.error("  [LLM] Zod validation failed:", result.error.issues)
    console.error("  [LLM] Raw parsed JSON keys:", Object.keys(parsed))
    throw new Error(`LLM output doesn't match schema: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")}`)
  }

  return {
    output: result.data,
    tokensUsed: { prompt: usage.prompt_tokens, completion: usage.completion_tokens },
  }
}
