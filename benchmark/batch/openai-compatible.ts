/**
 * OpenAI-compatible Batch API adapter.
 *
 * Shared implementation for any provider using the OpenAI batch protocol
 * (JSONL upload → /batches → poll → download results). Currently used by
 * OpenAI and Groq, both offering 50% off batch processing.
 *
 * Provider-specific subclasses only need to supply the API base URL and key.
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import type { BatchProvider, BatchRequest, BatchResult, BatchStatus } from "./types"

const BATCH_DIR = new URL("../../data/batches", import.meta.url).pathname

function ensureBatchDir() {
  if (!existsSync(BATCH_DIR)) mkdirSync(BATCH_DIR, { recursive: true })
}

export class OpenAICompatibleBatchProvider implements BatchProvider {
  constructor(
    public readonly name: string,
    private readonly apiBase: string,
    private readonly getApiKey: () => string,
  ) {}

  private async apiCall(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.apiBase}${path}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${this.name} API ${res.status}: ${text.slice(0, 300)}`)
    }
    return res.json()
  }

  async submit(requests: BatchRequest[], description?: string): Promise<string> {
    ensureBatchDir()

    const lines = requests.map(req => {
      const tokenParam = req.useMaxCompletionTokens
        ? { max_completion_tokens: req.maxTokens }
        : { max_tokens: req.maxTokens }
      return JSON.stringify({
        custom_id: req.customId,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          ...tokenParam,
          response_format: req.responseFormat,
        },
      })
    })
    const jsonl = lines.join("\n")

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const localPath = `${BATCH_DIR}/input-${this.name}-${timestamp}.jsonl`
    writeFileSync(localPath, jsonl)

    // Upload file
    const formData = new FormData()
    formData.append("file", new Blob([jsonl], { type: "application/jsonl" }), "batch-input.jsonl")
    formData.append("purpose", "batch")

    const fileRes = await fetch(`${this.apiBase}/files`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.getApiKey()}` },
      body: formData,
    })
    if (!fileRes.ok) {
      const text = await fileRes.text()
      throw new Error(`${this.name} file upload ${fileRes.status}: ${text.slice(0, 300)}`)
    }
    const fileData = await fileRes.json() as any

    // Create batch
    const batch = await this.apiCall("/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_file_id: fileData.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
        metadata: { description: description ?? `${this.name} judge batch` },
      }),
    })

    return batch.id
  }

  async checkStatus(batchId: string): Promise<BatchStatus> {
    const batch = await this.apiCall(`/batches/${batchId}`)

    const statusMap: Record<string, BatchStatus["status"]> = {
      validating: "validating",
      in_progress: "in_progress",
      completed: "completed",
      failed: "failed",
      expired: "expired",
      cancelling: "cancelling",
      cancelled: "cancelled",
      finalizing: "in_progress",
    }

    return {
      id: batch.id,
      status: statusMap[batch.status] ?? "in_progress",
      requestCount: batch.request_counts?.total ?? 0,
      completedCount: batch.request_counts?.completed ?? 0,
      failedCount: batch.request_counts?.failed ?? 0,
    }
  }

  async collectResults(batchId: string): Promise<BatchResult[]> {
    ensureBatchDir()

    const batch = await this.apiCall(`/batches/${batchId}`)
    if (batch.status !== "completed") {
      throw new Error(`Batch ${batchId} is not completed (status: ${batch.status})`)
    }

    const outputFileId = batch.output_file_id
    if (!outputFileId) throw new Error(`Batch ${batchId} has no output file`)

    const res = await fetch(`${this.apiBase}/files/${outputFileId}/content`, {
      headers: { "Authorization": `Bearer ${this.getApiKey()}` },
    })
    if (!res.ok) throw new Error(`Failed to download output file: ${res.status}`)

    const content = await res.text()

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    writeFileSync(`${BATCH_DIR}/output-${this.name}-${timestamp}.jsonl`, content)

    const results: BatchResult[] = []
    for (const line of content.split("\n").filter(l => l.trim())) {
      try {
        const entry = JSON.parse(line)
        const customId = entry.custom_id

        if (entry.error) {
          results.push({ customId, success: false, error: JSON.stringify(entry.error) })
          continue
        }

        const response = entry.response
        if (response?.status_code !== 200) {
          results.push({ customId, success: false, error: `HTTP ${response?.status_code}` })
          continue
        }

        const body = response.body
        const message = body?.choices?.[0]?.message?.content
        const usage = body?.usage

        results.push({
          customId,
          success: true,
          content: message,
          usage: usage ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
          } : undefined,
        })
      } catch (err) {
        results.push({ customId: "unknown", success: false, error: `Parse error: ${err}` })
      }
    }

    return results
  }
}
