// Auth: cookie-based (nh_session set by /login). The `?key=` URL fallback
// was removed; browser sessions must sign in via /login first.
const headers: Record<string, string> = {
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

export interface CharacterPatch {
  name?: string
  role?: string
  backstory?: string
  traits?: string[]
  speechPattern?: string
  internalConflict?: string
  avoids?: string
  goals?: string
  fears?: string
}

export function updateCharacter(novelId: string, characterId: string, patch: CharacterPatch) {
  return fetchJSON<{ ok: boolean; character: any }>(`/api/novel/${novelId}/character/${encodeURIComponent(characterId)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  })
}

export interface WorldPatch {
  setting?: string
  timePeriod?: string
  geography?: string
  politicalStructure?: string
  technologyConstraints?: string
  sensoryPalette?: string
  culture?: string
  history?: string
  socialCustoms?: string[]
  rules?: string[]
}

export function updateWorldBible(novelId: string, patch: WorldPatch) {
  return fetchJSON<{ ok: boolean; world: any }>(`/api/novel/${novelId}/world-bible`, {
    method: "PUT",
    body: JSON.stringify(patch),
  })
}

export interface SpinePatch {
  centralConflict?: string
  theme?: string
  endingDirection?: string
}

export function updateStorySpine(novelId: string, patch: SpinePatch) {
  return fetchJSON<{ ok: boolean; spine: any }>(`/api/novel/${novelId}/story-spine`, {
    method: "PUT",
    body: JSON.stringify(patch),
  })
}

export type AdjusterPatch =
  | { type: "characterUpdate"; characterId: string; patch: CharacterPatch }
  | { type: "characterRename"; characterId: string; newName: string }
  | { type: "worldUpdate"; patch: WorldPatch }
  | { type: "spineUpdate"; patch: SpinePatch }

export interface AdjustTurn { role: "user" | "assistant"; content: string }

// Phase 3 commit 1 (collaborative-proposal-workflow): the /adjust endpoint
// now returns a ReviewProposalEnvelope per patch alongside the legacy
// `proposedPatches` array. UI surfaces can opt into the envelope (one
// proposal id per patch, target ref, precondition hash, risk class) for
// per-patch approve/reject/modify in subsequent Phase 3 commits. Server
// shape: src/canon/proposal-envelope.ts.
export type ProposalEnvelopeKind =
  | "artifact_patch"
  | "canon_update"
  | "prose_edit"
  | "editorial_flag"

export type ProposalEnvelopeStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "modified"
  | "shadowed"
  | "expired"

export type ProposalEnvelopeRisk = "mechanical" | "low" | "medium" | "high"

export interface ProposalTargetRef {
  kind:
    | "planning_directive"
    | "world_bible"
    | "character"
    | "story_spine"
    | "chapter_outline"
    | "canon_fact"
    | "prose_span"
  ref: string
  fieldPath?: string
  currentVersion: string
}

export interface ProposalSourceRef {
  agent: string
  userMessage?: string
  parentEnvelopeId?: string
}

export interface ProposalPrecondition {
  kind: "artifact_hash" | "snapshot_hash" | "draft_hash" | "canon_generation"
  hash: string
}

export interface ProposalPolicyRecommendation {
  decision: "queue" | "approve" | "reject" | "shadow"
  policyVersion?: string
  reasons: string[]
}

export interface ReviewProposalEnvelope<TPayload = unknown> {
  id: string
  kind: ProposalEnvelopeKind
  novelId: string
  target: ProposalTargetRef
  source: ProposalSourceRef
  status: ProposalEnvelopeStatus
  risk: ProposalEnvelopeRisk
  summary: string
  rationale: string
  evidence: readonly { kind: "quote" | "structured" | "link"; text: string; ref?: string }[]
  payload: TPayload
  precondition: ProposalPrecondition
  policyRecommendation: ProposalPolicyRecommendation
  createdAt: string
  resolvedAt?: string
  resolvedBy?: "human" | "policy" | "script" | "test"
}

export type ArtifactPatchEnvelope = ReviewProposalEnvelope<AdjusterPatch> & {
  kind: "artifact_patch"
}

export interface AdjustResponse {
  ok: boolean
  assistantMessage: string
  proposedPatches: AdjusterPatch[]
  /** Phase 3 commit 1 — per-patch envelope; optional for back-compat with older servers. */
  proposalEnvelopes?: ArtifactPatchEnvelope[]
  error?: string
  raw?: string
}

export function adjustNovel(novelId: string, message: string, history: AdjustTurn[] = []) {
  return fetchJSON<AdjustResponse>(
    `/api/novel/${novelId}/adjust`,
    { method: "POST", body: JSON.stringify({ message, history }) },
  )
}

export interface ResolveProposalEnvelopeResponse {
  ok: boolean
  envelopeId: string
  applied: boolean
  status?: "approved" | "rejected" | "modified"
  newVersion?: string
  /** Set on 409 stale-precondition. */
  expectedVersion?: string
  actualVersion?: string
  /** Set on 409 envelope-already-resolved (Phase 3 commit 4 follow-up A). */
  actualStatus?: string
  error?: string
}

/**
 * Phase 3 commit 2 — per-patch resolve. The body shape is asymmetric on
 * purpose: callers MUST always provide `envelope` and `status`; the
 * `modifiedPayload` is required ONLY when status === "modified". The
 * server enforces this with a 400 if the constraint is violated.
 *
 * On 409 stale-precondition the response carries `expectedVersion` +
 * `actualVersion` so the UI can choose: regenerate the patch (Phase 3
 * commit 3) or surface the diff for the operator.
 */
export function resolveProposalEnvelope(
  novelId: string,
  body: {
    envelope: ArtifactPatchEnvelope
    status: "approved" | "rejected" | "modified"
    modifiedPayload?: AdjusterPatch
    operatorNote?: string
  },
) {
  return fetchJSON<ResolveProposalEnvelopeResponse>(
    `/api/novel/${novelId}/proposal-envelopes/resolve`,
    { method: "POST", body: JSON.stringify(body) },
  )
}

export function getNovelState(novelId: string) {
  return fetchJSON<NovelState>(`/api/novel/${novelId}/state`)
}

export type ExportFormat = "markdown" | "txt" | "json"

export function exportNovelURL(novelId: string, format: ExportFormat, approvedOnly = false): string {
  const params = new URLSearchParams({ format })
  if (approvedOnly) params.set("approved", "true")
  return `/api/novel/${novelId}/export?${params.toString()}`
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

export function getAllChapters(novelId: string, variant: "approved" | "tonal" = "approved") {
  return fetchJSON<ChapterData[]>(`/api/novel/${novelId}/chapters?variant=${variant}`)
}

export interface ChapterVersions {
  approved: { prose: string; wordCount: number; version: number } | null
  tonal: { prose: string; wordCount: number; version: number } | null
}

export function getChapterVersions(novelId: string, chapter: number) {
  return fetchJSON<ChapterVersions>(`/api/novel/${novelId}/chapter/${chapter}/versions`)
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

export function decidePlanAssist(novelId: string, chapter: number, decision: PlanAssistDecision) {
  return fetchJSON<{ ok: boolean; novelId: string; chapter: number; action: string }>(
    `/api/novel/${novelId}/plan-assist/${chapter}/decide`,
    {
      method: "POST",
      body: JSON.stringify(decision),
    },
  )
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
  hidden: boolean
}

export function listDocs(showHidden = false) {
  const qs = showHidden ? "?showHidden=true" : ""
  return fetchJSON<{ docs: DocEntry[] }>(`/api/docs${qs}`)
}

export function getDoc(filename: string) {
  return fetchJSON<{ filename: string; title: string; content: string }>(`/api/docs/${encodeURIComponent(filename)}`)
}

export function setDocHidden(filename: string, hidden: boolean) {
  return fetchJSON<{ filename: string; hidden: boolean }>(
    `/api/docs/${encodeURIComponent(filename)}/hidden`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden }) },
  )
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
  pendingPlanAssist?: { chapter: number; kind: string } | null
}

// ── Plan-assist gate types (step 2 of exhaustion-handler-design) ──────

export interface PlanAssistPayload {
  kind: "plan-check-exhausted" | "reviser-rejected" | "integrity-exhausted"
  novelId: string
  chapter: number
  outline: any  // ChapterOutline — runtime shape varies; treat as JSON blob for UI display
  prose: string
  unresolvedDeviations: Array<{ description: string; beat_index: number | null }>
  reviserHistory?: {
    attemptedScenes: any[]
    rejectionReason: string
  }
}

export type PlanAssistDecision =
  | { action: "edit-plan"; outline: any }
  | { action: "override" }
  | { action: "abort" }

export interface NovelState {
  id: string
  phase: string
  currentChapter: number
  totalChapters: number
  createdAt: string
  active: boolean
  activeError?: string
  // `error` is the legacy field kept for UI back-compat; new consumers
  // can branch on `kind` for structured data (plan-assist-bail surfaces
  // bailKind + chapter).
  lastRunError?:
    | { kind: "error"; error: string; message: string; at: string }
    | { kind: "plan-assist-bail"; error: string; bailKind: string; chapter: number; message: string; at: string }
    | { error: string; at: string }
    | null
  pendingGate: {
    gateId: string
    title: string
    content: string
  } | null
  pendingPlanAssist?: {
    chapter: number
    payload: PlanAssistPayload
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

// ── Adapter registry ──────────────────────────────────────────────────

export type AdapterStatus = "deployed" | "candidate" | "retired" | "rejected"

export interface Adapter {
  uri: string
  name: string
  slot: string | null
  baseModel: string | null
  status: AdapterStatus
  trainingExperimentId: number | null
  evalExperimentIds: number[]
  deployedAt: string | null
  retiredAt: string | null
  headlineMetrics: Record<string, any> | null
  trainingDataPath: string | null
  trainingDataSha256: string | null
  supersedes: string | null
  notes: string | null
  trainingConclusion: string | null
}

export function listAdapters() {
  return fetchJSON<Adapter[]>("/api/adapters")
}

// ── Charters ──────────────────────────────────────────────────────────

export interface CharterMeta {
  slug: string
  title: string
  status: string | null
  kind: string | null
  experimentFamily: string | null
  proposedBy: string | null
  proposedDate: string | null
  adversaryVerdict: string | null
  supersedes: string | null
  supersededBy: string | null
  extras: Record<string, string>
}

export interface CharterFull extends CharterMeta { body: string }

export function listCharters() {
  return fetchJSON<CharterMeta[]>("/api/charters")
}

export function getCharter(slug: string) {
  return fetchJSON<CharterFull>(`/api/charters/${encodeURIComponent(slug)}`)
}

// ── Experiment families ───────────────────────────────────────────────

export interface FamilyExperiment {
  id: number
  timestamp: string
  description: string
  status: string | null
  conclusion: string | null
  experimentType: string | null
  kind: string | null
}

export interface FamilySummary {
  family: string
  charter: FamilyExperiment | null
  charterSlug: string | null
  runs: FamilyExperiment[]
  totalExperiments: number
  latestAt: string | null
  concludedCount: number
}

export function listExperimentFamilies() {
  return fetchJSON<FamilySummary[]>("/api/experiment-families")
}

export function getExperimentFamily(family: string) {
  return fetchJSON<FamilySummary>(`/api/experiment-families/${encodeURIComponent(family)}`)
}

// ── Chapter-plan-reviser telemetry ────────────────────────────────────

export type RevisionOutcome =
  | "accepted"
  | "rejected_beat_floor"
  | "rejected_new_characters"
  | "error"
  | "skip_already_revised"
  | "skip_duplicate_sig"
  | "skip_no_beat_state"

export interface RevisionRow {
  id: number
  novelId: string
  chapter: number
  attempt: number
  invokedAt: string
  issueSig: string
  issueCount: number
  originalBeatCount: number
  revisedBeatCount: number | null
  outlineBefore: unknown[] | null
  outlineAfter: unknown[] | null
  outcome: RevisionOutcome
  rejectionReason: string | null
}

export interface RevisionStats {
  novelId: string
  total: number
  invocations: number
  accepted: number
  rejectedBeatFloor: number
  rejectedNewCharacters: number
  errors: number
  skipAlreadyRevised: number
  skipDuplicateSig: number
  skipNoBeatState: number
  acceptanceRate: number | null
  affectedChapters: number[]
}

export function getNovelRevisions(novelId: string) {
  return fetchJSON<{ stats: RevisionStats; rows: RevisionRow[] }>(`/api/novel/${encodeURIComponent(novelId)}/revisions`)
}

export interface ExhaustionRow {
  id: number
  novelId: string
  chapter: number
  attempt: number
  firedAt: string
  kind: "plan-check-exhausted" | "reviser-rejected" | "integrity-exhausted"
  resolverMode: "auto" | "cli" | "web"
  unresolvedDeviations: Array<{ description: string; beat_index: number | null }>
  reviserHistory: { attemptedScenes: unknown[]; rejectionReason: string } | null
  decidedAt: string | null
  decision: "edit-plan" | "override" | "abort" | null
  decisionDetails: unknown | null
}

export function getNovelExhaustions(novelId: string) {
  return fetchJSON<{ exhaustions: ExhaustionRow[] }>(`/api/novel/${encodeURIComponent(novelId)}/exhaustions`)
}

// ── Canon proposal review (Phase 2B) ──────────────────────────────────
//
// Minimal client surface for the operator review panel. Mirrors
// `src/orchestrator/canon-proposal-routes.ts` shapes; types are kept narrow
// — the substrate's full schema lives in `src/canon/api.ts` and we only need
// what the UI renders.

export type ProposalProvenanceSource =
  | "planner-output"
  | "planning-state-mapper"
  | "planning-state-repair"
  | "post-draft-extraction"
  | "human-edit"
  | "corpus-import"

export type ProposalFactKind =
  | "established_fact"
  | "knowledge_change"
  | "character_state"
  | "promise"
  | "payoff"

export type ProposalStatus = "pending" | "approved" | "rejected" | "modified"

export interface ProposedFactProvenance {
  source: ProposalProvenanceSource
  chapter: number
  beat?: number
  extractorVersion: string
  confidence?: number
  origin: "planned" | "observed"
  supersedes?: string
}

export interface ProposedFact {
  id: string
  kind: ProposalFactKind
  text: string
  data?: Record<string, unknown>
  provenance: ProposedFactProvenance
}

export interface CanonProposal {
  id: string
  source: ProposalProvenanceSource
  targetFactId?: string
  proposedFact: ProposedFact
  status: ProposalStatus
  modifiedFact?: ProposedFact & { provenance: ProposedFactProvenance & { approvalStatus: string; createdAt: string; updatedAt: string } }
  operatorNote?: string
  createdAt: string
  resolvedAt?: string
}

export function listCanonProposals(
  novelId: string,
  opts?: {
    source?: string
    chapter?: number
    plannerOnly?: boolean
    status?: ProposalStatus | ProposalStatus[] | "all"
  },
) {
  const params = new URLSearchParams()
  if (opts?.source) params.set("source", opts.source)
  if (opts?.chapter !== undefined) params.set("chapter", String(opts.chapter))
  if (opts?.plannerOnly) params.set("plannerOnly", "true")
  if (opts?.status !== undefined) {
    const value = Array.isArray(opts.status) ? opts.status.join(",") : opts.status
    if (value && value !== "pending") params.set("status", value)
  }
  const qs = params.toString()
  const suffix = qs ? `?${qs}` : ""
  return fetchJSON<{ proposals: CanonProposal[] }>(
    `/api/novel/${encodeURIComponent(novelId)}/canon-proposals${suffix}`,
  )
}

export interface ResolveProposalBody {
  status: "approved" | "rejected" | "modified"
  modifiedFact?: ProposedFact
  operatorNote?: string
  expectedStatus?: "pending"
}

export interface ResolveProposalResult {
  proposalId: string
  status: "approved" | "rejected" | "modified"
  committedFact: unknown
}

export function resolveCanonProposal(
  novelId: string,
  proposalId: string,
  body: ResolveProposalBody,
) {
  return fetchJSON<ResolveProposalResult>(
    `/api/novel/${encodeURIComponent(novelId)}/canon-proposals/${encodeURIComponent(proposalId)}/resolve`,
    { method: "POST", body: JSON.stringify(body) },
  )
}

export interface GenerateProposalsResult {
  novelId: string
  outlinesCount: number
  gateClear: boolean
  created: number
  skipped: number
  gateReport: { summary: unknown }
}

export function generateProposalsFromOutline(novelId: string) {
  return fetchJSON<GenerateProposalsResult>(
    `/api/novel/${encodeURIComponent(novelId)}/canon-proposals/generate-from-outline`,
    { method: "POST", body: "{}" },
  )
}

export interface BulkResolutionRequest {
  proposalId: string
  status: "approved" | "rejected" | "modified"
  modifiedFact?: ProposedFact
  operatorNote?: string
  expectedStatus?: "pending"
}

export interface BulkResolutionResult {
  proposalId: string
  status: "ok" | "error"
  resolution?: "approved" | "rejected" | "modified"
  committedFact?: unknown
  error?: string
  httpStatus?: number
}

export interface BulkResolveResponse {
  results: BulkResolutionResult[]
  counts: { ok: number; error: number }
}

export function bulkResolveCanonProposals(
  novelId: string,
  resolutions: BulkResolutionRequest[],
) {
  return fetchJSON<BulkResolveResponse>(
    `/api/novel/${encodeURIComponent(novelId)}/canon-proposals/bulk-resolve`,
    { method: "POST", body: JSON.stringify({ resolutions }) },
  )
}
