/**
 * Provider-agnostic batch processing types.
 *
 * Each provider adapter implements BatchProvider to submit,
 * check status, and collect results from their batch API.
 */

export interface BatchRequest {
  customId: string               // unique ID to map results back (e.g. "gen-123-telling")
  model: string                  // model ID
  messages: Array<{ role: string; content: string }>
  temperature: number
  maxTokens: number
  useMaxCompletionTokens?: boolean  // use max_completion_tokens instead of max_tokens
  responseFormat?: { type: string }
}

export interface BatchResult {
  customId: string
  success: boolean
  content?: string               // raw response content (JSON string)
  error?: string
  usage?: { promptTokens: number; completionTokens: number }
}

export interface BatchStatus {
  id: string                     // provider's batch ID
  status: "validating" | "in_progress" | "completed" | "failed" | "expired" | "cancelling" | "cancelled"
  requestCount: number
  completedCount: number
  failedCount: number
}

export interface BatchProvider {
  name: string
  /** Submit a batch of requests. Returns the provider's batch ID. */
  submit(requests: BatchRequest[], description?: string): Promise<string>
  /** Check the status of a submitted batch. */
  checkStatus(batchId: string): Promise<BatchStatus>
  /** Collect results from a completed batch. */
  collectResults(batchId: string): Promise<BatchResult[]>
}
