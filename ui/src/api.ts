// Auth: cookie-based (nh_session set by /login). Falls back to ?key= for backward compat.
const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""

const headers: Record<string, string> = {
  ...(API_KEY && { "x-api-key": API_KEY }),
  "Content-Type": "application/json",
}

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...opts?.headers }, credentials: "same-origin" })
  if (res.status === 401) {
    // Session expired — redirect to login
    window.location.href = "/login"
    throw new Error("Session expired")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export function getSeeds() {
  return fetchJSON<{ seeds: string[] }>("/api/novel/seeds")
}

export function listNovels() {
  return fetchJSON<{ novels: NovelListItem[] }>("/api/novel/list")
}

export function startNovel(seed: string, mode: "interactive" | "auto" = "interactive") {
  return fetchJSON<{ ok: boolean; novelId: string }>("/api/novel/start", {
    method: "POST",
    body: JSON.stringify({ seed, mode }),
  })
}

export interface LockedCharacter {
  name: string
  role?: string
  mustHaveTraits?: string[]
  mustHaveArc?: string
}

export interface RequiredBeat {
  chapter?: number
  description: string
  mustInclude?: string[]
}

export interface StructuralConstraints {
  chapterCount?: number
  povRotation?: string
  pacing?: string
  targetWordsPerChapter?: number
}

export interface PlanningDirectives {
  lockedCharacters: LockedCharacter[]
  requiredBeats: RequiredBeat[]
  forbidden: string[]
  tonalAnchors: string[]
  structuralConstraints: StructuralConstraints
  rawNotes: string
}

export const emptyDirectives: PlanningDirectives = {
  lockedCharacters: [],
  requiredBeats: [],
  forbidden: [],
  tonalAnchors: [],
  structuralConstraints: { povRotation: "", pacing: "" },
  rawNotes: "",
}

export interface CustomSeed {
  premise: string
  genre: string
  characters: { name: string; role: "protagonist" | "antagonist" | "supporting"; description: string }[]
  directives?: PlanningDirectives
}

export function startNovelCustom(customSeed: CustomSeed, mode: "interactive" | "auto" = "interactive") {
  return fetchJSON<{ ok: boolean; novelId: string }>("/api/novel/start", {
    method: "POST",
    body: JSON.stringify({ customSeed, mode }),
  })
}

export interface DirectorChatTurn {
  role: "user" | "assistant"
  content: string
}

export function chatWithDirector(args: {
  seed: { premise: string; genre: string; chapterCount?: number }
  history: DirectorChatTurn[]
  message: string
}) {
  return fetchJSON<{ ok: boolean; assistantMessage: string }>("/api/novel/director/chat", {
    method: "POST",
    body: JSON.stringify(args),
  })
}

export function compileDirectives(args: {
  seed: { premise: string; genre: string; chapterCount?: number }
  history: DirectorChatTurn[]
}) {
  return fetchJSON<{ ok: boolean; directives: PlanningDirectives }>("/api/novel/director/compile", {
    method: "POST",
    body: JSON.stringify(args),
  })
}

export function resumeNovel(novelId: string, opts?: { rewindTo?: "concept" | "planning" | "drafting" | "validation" }) {
  return fetchJSON<{ ok: boolean }>("/api/novel/resume", {
    method: "POST",
    body: JSON.stringify({ novelId, mode: "interactive", rewindTo: opts?.rewindTo }),
  })
}

export function redraftChapter(novelId: string, chapterNum: number) {
  return fetchJSON<{ ok: boolean; chapter: number }>(`/api/novel/${novelId}/chapter/${chapterNum}/redraft`, {
    method: "POST",
  })
}

export function getNovelState(novelId: string) {
  return fetchJSON<NovelState>(`/api/novel/${novelId}/state`)
}

export function getWorldBible(novelId: string) {
  return fetchJSON<any>(`/api/novel/${novelId}/world-bible`)
}

export function getCharacters(novelId: string) {
  return fetchJSON<any[]>(`/api/novel/${novelId}/characters`)
}

export function getStorySpine(novelId: string) {
  return fetchJSON<any>(`/api/novel/${novelId}/story-spine`)
}

export function getOutlines(novelId: string) {
  return fetchJSON<any[]>(`/api/novel/${novelId}/outlines`)
}

export function getChapterDraft(novelId: string, chapter: number) {
  return fetchJSON<{ prose: string; wordCount: number; version: number; status: string } | null>(`/api/novel/${novelId}/chapter/${chapter}/draft`)
}

export function getIssues(novelId: string) {
  return fetchJSON<any[]>(`/api/novel/${novelId}/issues`)
}

export interface ChapterData {
  chapter: number
  prose: string
  wordCount: number
  version: number
  status: string
}

export function getAllChapters(novelId: string) {
  return fetchJSON<ChapterData[]>(`/api/novel/${novelId}/chapters`)
}

export interface BeatData {
  chapter: number
  beatIndex: number
  prose: string
  wordCount: number
  promptTokens: number
  completionTokens: number
  latencyMs: number
  timestamp: string
}

export function getBeats(novelId: string) {
  return fetchJSON<BeatData[]>(`/api/novel/${novelId}/beats`)
}

export function deleteNovel(novelId: string) {
  return fetchJSON<{ ok: boolean }>(`/api/novel/${novelId}`, { method: "DELETE" })
}

export function decideGate(novelId: string, gateId: string, action: "approve" | "revise" | "reject", notes?: string[]) {
  return fetchJSON<{ ok: boolean }>(`/api/novel/${novelId}/gate/${encodeURIComponent(gateId)}/decide`, {
    method: "POST",
    body: JSON.stringify({ action, notes }),
  })
}

export function getNovelConfig() {
  return fetchJSON<NovelConfig>("/api/novel/config")
}

export function setAgentConfig(agentName: string, config: Partial<{ provider: string; model: string; temperature: number; maxTokens: number }>) {
  return fetchJSON<{ ok: boolean; effective: any }>(`/api/novel/config/agent/${encodeURIComponent(agentName)}`, {
    method: "PUT",
    body: JSON.stringify(config),
  })
}

export function resetAgentConfig(agentName: string) {
  return fetchJSON<{ ok: boolean }>(`/api/novel/config/agent/${encodeURIComponent(agentName)}`, {
    method: "DELETE",
  })
}

export function persistConfig() {
  return fetchJSON<{ ok: boolean; changed: string[] }>("/api/novel/config/persist", {
    method: "POST",
  })
}

export function toggleModelHidden(provider: string, modelId: string, hidden: boolean) {
  return fetchJSON<{ ok: boolean }>("/api/models/hidden", {
    method: "POST",
    body: JSON.stringify({ provider, modelId, hidden }),
  })
}

// ── LLM call inspector ────────────────────────────────────────────────────

export interface LLMCallRow {
  id: number
  run_id: number
  agent: string
  phase: string | null
  provider: string
  model: string
  temperature: number | null
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number
  tokens_per_sec: number
  cost: string
  novel_id: string | null
  chapter: number | null
  beat_index: number | null
  attempt: number | null
  timestamp: string
  failed: boolean | null
  error_text: string | null
}

export interface LLMCallDetail extends LLMCallRow {
  max_tokens: number | null
  system_prompt: string | null
  user_prompt: string | null
  response_content: string | null
  request_json: any | null
  json_extraction_success: boolean | null
  json_extraction_retried: boolean | null
  zod_validation_success: boolean | null
  zod_errors: string | null
  http_attempts: number | null
  retry_errors: string | null
}

export interface LLMCallFilters {
  novelId?: string
  agent?: string
  chapter?: number
  beatIndex?: number
  runId?: number
  limit?: number
  failedOnly?: boolean
}

export function listLLMCalls(filters: LLMCallFilters = {}) {
  const qs = new URLSearchParams()
  if (filters.novelId) qs.set("novel_id", filters.novelId)
  if (filters.agent) qs.set("agent", filters.agent)
  if (filters.chapter != null) qs.set("chapter", String(filters.chapter))
  if (filters.beatIndex != null) qs.set("beat_index", String(filters.beatIndex))
  if (filters.runId != null) qs.set("run_id", String(filters.runId))
  if (filters.limit != null) qs.set("limit", String(filters.limit))
  if (filters.failedOnly) qs.set("failed", "1")
  return fetchJSON<LLMCallRow[]>(`/api/novel/llm-calls?${qs.toString()}`)
}

export function getLLMCall(id: number) {
  return fetchJSON<LLMCallDetail>(`/api/novel/llm-calls/${id}`)
}

export function listLLMCallAgents(novelId?: string) {
  const qs = novelId ? `?novel_id=${encodeURIComponent(novelId)}` : ""
  return fetchJSON<string[]>(`/api/novel/llm-calls/agents${qs}`)
}

// ── Retrieval Config ──────────────────────────────────────────────────────

export interface RetrievalConfig {
  novelId: string
  maxFacts: number
  maxEvents: number
  maxSummaries: number
  maxStates: number
  maxRelationships: number
  maxKnowledge: number
  minSimilarity: number
  rrfK: number
  fetchPerLeg: number
  characterBoost: number
  locationBoost: number
  recencyHalfLife: number
}

export function getRetrievalConfig(novelId: string) {
  return fetchJSON<RetrievalConfig>(`/api/retrieval-config/${novelId}`)
}

export function updateRetrievalConfig(novelId: string, config: Partial<RetrievalConfig>) {
  return fetchJSON<{ ok: boolean }>(`/api/retrieval-config/${novelId}`, {
    method: "PUT",
    body: JSON.stringify(config),
  })
}

export function getRetrievalDefaults() {
  return fetchJSON<RetrievalConfig>("/api/retrieval-config/defaults")
}

// ── Deterministic Config ─────────────────────────────────────────────────

export interface DeterministicConfig {
  novelId: string
  causalParticipantWeight: number
  causalLocationWeight: number
  causalTemporalWeight: number
  causalConsequenceWeight: number
  causalAutoThreshold: number
  causalCandidateThreshold: number
}

export function getDeterministicConfig(novelId: string) {
  return fetchJSON<DeterministicConfig>(`/api/deterministic-config/${novelId}`)
}

export function updateDeterministicConfig(novelId: string, config: Partial<DeterministicConfig>) {
  return fetchJSON<{ ok: boolean }>(`/api/deterministic-config/${novelId}`, {
    method: "PUT",
    body: JSON.stringify(config),
  })
}

export function getDeterministicDefaults() {
  return fetchJSON<DeterministicConfig>("/api/deterministic-config/defaults")
}

// ── Docs ──────────────────────────────────────────────────────────────

export interface DocEntry {
  filename: string
  title: string
  size: number
}

export function listDocs() {
  return fetchJSON<{ docs: DocEntry[] }>("/api/docs")
}

export function getDoc(filename: string) {
  return fetchJSON<{ filename: string; title: string; content: string }>(`/api/docs/${encodeURIComponent(filename)}`)
}

// ── Fine-tune Training Data ──────────────────────────────────────────

export interface FinetuneStats {
  totals: Record<string, number>
  byTask: Record<string, Record<string, number>>
}

export interface FinetunePair {
  id: string
  task: string
  status: string
  novel_id: string | null
  chapter_number: number | null
  system_prompt: string
  user_content: string
  base_output: string
  gold_output: string | null
  reviewer_notes: string | null
  created_at: string
  reviewed_at: string | null
}

export function getFinetuneStats() {
  return fetchJSON<FinetuneStats>("/api/finetune/stats")
}

export function getFinetunePairs(task?: string, status?: string, limit?: number, offset?: number) {
  const params = new URLSearchParams()
  if (task) params.set("task", task)
  if (status) params.set("status", status)
  if (limit) params.set("limit", String(limit))
  if (offset) params.set("offset", String(offset))
  const qs = params.toString()
  return fetchJSON<{ pairs: FinetunePair[] }>(`/api/finetune/pairs${qs ? `?${qs}` : ""}`)
}

export function getFinetunePair(id: string) {
  return fetchJSON<FinetunePair>(`/api/finetune/pairs/${id}`)
}

export function updateFinetunePair(id: string, data: { gold_output?: string; status?: string; reviewer_notes?: string }) {
  return fetchJSON<FinetunePair>(`/api/finetune/pairs/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export async function exportFinetuneData(task: string): Promise<Blob> {
  const res = await fetch(`/api/finetune/export?task=${encodeURIComponent(task)}`, { headers, credentials: "same-origin" })
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  return res.blob()
}

export function generateFinetuneData(task: string, limit: number) {
  return fetchJSON<{ ok: boolean; task: string; limit: number; pid: number }>("/api/finetune/generate", {
    method: "POST",
    body: JSON.stringify({ task, limit }),
  })
}

// ── Preference evaluation ────────────────────────────────────────────

export function getPrefRatings(evalName: string) {
  return fetchJSON<{ ratings: { paragraph_index: number; chosen_model: string }[] }>(
    `/api/pref-eval/${encodeURIComponent(evalName)}`
  )
}

export function savePrefRating(evalName: string, data: {
  paragraphIndex: number
  inputText: string
  chosenText: string
  rejectedText: string
  chosenModel: string
  rejectedModel: string
}) {
  return fetchJSON<{ ok: boolean }>(`/api/pref-eval/${encodeURIComponent(evalName)}`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function exportPrefDpo(evalName: string): Promise<Blob> {
  const res = await fetch(`/api/pref-eval/${encodeURIComponent(evalName)}/export`, { headers, credentials: "same-origin" })
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  return res.blob()
}

export interface ExperimentSummary {
  id: number
  type: string
  description: string
  target: string | null
  dimension: string | null
  conclusion: string | null
  timestamp: string
}

export function getExperiments(limit = 200) {
  return fetchJSON<ExperimentSummary[]>(`/api/experiments?limit=${limit}`)
}

// Types
export interface AgentGroup {
  label: string
  description: string
  agents: string[]
}

export interface NovelConfig {
  models: { label: string; id: string; provider: string; pricing?: { input: number; output: number } }[]
  providers: string[]
  agentGroups: Record<string, AgentGroup>
  assignments: Record<string, { provider: string; model: string; temperature: number; maxTokens: number }>
  overrides: Record<string, Partial<{ provider: string; model: string; temperature: number; maxTokens: number }>>
}

export interface SeedInfo {
  premise: string
  genre: string
  characters?: { name: string; role: string; description: string }[]
  chapterCount?: number
}

export interface NovelListItem {
  id: string
  phase: string
  currentChapter: number
  totalChapters: number
  createdAt: string
  active: boolean
  seed: SeedInfo | null
  pendingGate: { gateId: string; title: string } | null
}

export interface NovelState {
  id: string
  phase: string
  currentChapter: number
  totalChapters: number
  createdAt: string
  active: boolean
  activeError?: string
  pendingGate: {
    gateId: string
    title: string
    content: string
  } | null
}

export interface SSEEvent {
  type: string
  data: Record<string, any>
  timestamp: string
}

// ── Pipeline trace ────────────────────────────────────────────────────

export interface TraceEvent {
  id: number
  novel_id: string
  run_id: number | null
  chapter: number | null
  beat_index: number | null
  event_type: string
  agent: string | null
  llm_call_id: number | null
  duration_ms: number | null
  payload: Record<string, any>
  timestamp: string
}

export function getTrace(novelId: string, filters: { chapter?: number; event_type?: string; agent?: string; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (filters.chapter != null) params.set("chapter", String(filters.chapter))
  if (filters.event_type) params.set("event_type", filters.event_type)
  if (filters.agent) params.set("agent", filters.agent)
  if (filters.limit) params.set("limit", String(filters.limit))
  const qs = params.toString()
  return fetchJSON<TraceEvent[]>(`/api/novel/${novelId}/trace${qs ? `?${qs}` : ""}`)
}
