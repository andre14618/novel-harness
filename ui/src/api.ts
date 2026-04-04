const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""

const headers: Record<string, string> = {
  "x-api-key": API_KEY,
  "Content-Type": "application/json",
}

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...opts?.headers } })
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

export interface CustomSeed {
  premise: string
  genre: string
  characters: { name: string; role: "protagonist" | "antagonist" | "supporting"; description: string }[]
}

export function startNovelCustom(customSeed: CustomSeed, mode: "interactive" | "auto" = "interactive") {
  return fetchJSON<{ ok: boolean; novelId: string }>("/api/novel/start", {
    method: "POST",
    body: JSON.stringify({ customSeed, mode }),
  })
}

export function resumeNovel(novelId: string) {
  return fetchJSON<{ ok: boolean }>("/api/novel/resume", {
    method: "POST",
    body: JSON.stringify({ novelId, mode: "interactive" }),
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
  return fetchJSON<any>(`/api/novel/${novelId}/chapter/${chapter}/draft`)
}

export function getIssues(novelId: string) {
  return fetchJSON<any[]>(`/api/novel/${novelId}/issues`)
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

export interface NovelListItem {
  id: string
  phase: string
  currentChapter: number
  totalChapters: number
  createdAt: string
  active: boolean
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
