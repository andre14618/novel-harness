import { useEffect, useMemo, useState } from "react"
import {
  listLLMCalls, listLLMCallAgents, getLLMCall, listNovels,
  type LLMCallRow, type LLMCallDetail,
} from "../api"

// LLM Call inspector — see exactly what every agent received and produced.
//
// Default view: most recent 100 calls. Filter by novel + agent + chapter + beat
// to drill into a specific point in the pipeline. Click any row to open the
// detail panel with the full system prompt, user prompt, and response.
//
// See docs/llm-call-inspector.md for usage workflows.

type SortCol = "id" | "status" | "agent" | "novel" | "ch" | "beat" | "att" | "model" | "in" | "out" | "ms" | "$"
type SortDir = "asc" | "desc"

export function LLMCallsPage() {
  const [rows, setRows] = useState<LLMCallRow[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [novels, setNovels] = useState<{ id: string; title: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<LLMCallDetail | null>(null)
  const [selectedLoading, setSelectedLoading] = useState(false)

  // Server-side filters
  const [novelId, setNovelId] = useState<string>("")
  const [agent, setAgent] = useState<string>("")
  const [chapter, setChapter] = useState<string>("")
  const [beatIndex, setBeatIndex] = useState<string>("")
  const [failedOnly, setFailedOnly] = useState(false)
  const [limit, setLimit] = useState(100)

  // Client-side sort + search
  const [sortCol, setSortCol] = useState<SortCol>("id")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [search, setSearch] = useState("")

  function load() {
    setLoading(true)
    setError(null)
    listLLMCalls({
      novelId: novelId || undefined,
      agent: agent || undefined,
      chapter: chapter ? parseInt(chapter) : undefined,
      beatIndex: beatIndex ? parseInt(beatIndex) : undefined,
      failedOnly: failedOnly || undefined,
      limit,
    })
      .then(r => { setRows(r); setLastRefresh(new Date()) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 10_000)
    return () => clearInterval(interval)
  }, [novelId, agent, chapter, beatIndex, failedOnly, limit])

  useEffect(() => {
    listLLMCallAgents(novelId || undefined).then(setAgents).catch(() => {})
  }, [novelId])

  useEffect(() => {
    listNovels().then(r => {
      setNovels(r.novels)
      // Auto-select the most recent novel on initial load (list is sorted by created_at DESC)
      if (!novelId && r.novels.length > 0) {
        setNovelId(r.novels[0].id)
      }
    }).catch(() => {})
  }, [])

  function openCall(id: number) {
    setSelectedLoading(true)
    getLLMCall(id)
      .then(setSelected)
      .catch(e => setError(String(e)))
      .finally(() => setSelectedLoading(false))
  }

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc")
    } else {
      setSortCol(col)
      setSortDir(col === "id" ? "desc" : "asc")
    }
  }

  // Sort + search client-side, then cluster consecutive beat groups
  const clusteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let filtered = q
      ? rows.filter(r =>
          r.agent.toLowerCase().includes(q) ||
          shortModel(r.model).toLowerCase().includes(q) ||
          r.model.toLowerCase().includes(q) ||
          (r.novel_id ?? "").toLowerCase().includes(q)
        )
      : rows

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case "id":      cmp = a.id - b.id; break
        case "status":  cmp = Number(a.failed) - Number(b.failed); break
        case "agent":   cmp = a.agent.localeCompare(b.agent); break
        case "novel":   cmp = (a.novel_id ?? "").localeCompare(b.novel_id ?? ""); break
        case "ch":      cmp = (a.chapter ?? -1) - (b.chapter ?? -1); break
        case "beat":    cmp = (a.beat_index ?? -1) - (b.beat_index ?? -1); break
        case "att":     cmp = (a.attempt ?? -1) - (b.attempt ?? -1); break
        case "model":   cmp = shortModel(a.model).localeCompare(shortModel(b.model)); break
        case "in":      cmp = (a.prompt_tokens ?? 0) - (b.prompt_tokens ?? 0); break
        case "out":     cmp = (a.completion_tokens ?? 0) - (b.completion_tokens ?? 0); break
        case "ms":      cmp = (a.latency_ms ?? 0) - (b.latency_ms ?? 0); break
        case "$":       cmp = Number(a.cost) - Number(b.cost); break
      }
      return sortDir === "asc" ? cmp : -cmp
    })

    // Only cluster when sorted by id desc (natural pipeline order)
    const isDefaultOrder = sortCol === "id" && sortDir === "desc" && !q
    return sorted.map((r, i) => {
      const prev = sorted[i - 1]
      const isNewCluster = isDefaultOrder && (!prev
        || prev.novel_id !== r.novel_id
        || prev.chapter !== r.chapter
        || prev.beat_index !== r.beat_index)
      return { row: r, isNewCluster }
    })
  }, [rows, sortCol, sortDir, search])

  return (
    <div style={{ padding: 16, maxWidth: "100%" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: 8, color: "var(--text-primary)" }}>
        LLM Call Inspector
      </h2>
      <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: 16 }}>
        Every LLM call across the pipeline. Filter by novel/agent/chapter/beat, click a row to see the full prompt and response.
      </p>

      {/* Filter bar */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16,
        padding: 12, background: "var(--bg-surface)", borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
      }}>
        <Field label="Novel">
          <select value={novelId} onChange={e => setNovelId(e.target.value)} style={selectStyle}>
            <option value="">all novels</option>
            {novels.map(n => <option key={n.id} value={n.id}>{n.title || n.id}</option>)}
          </select>
        </Field>
        <Field label="Agent">
          <select value={agent} onChange={e => setAgent(e.target.value)} style={selectStyle}>
            <option value="">all agents</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Chapter">
          <input type="number" value={chapter} onChange={e => setChapter(e.target.value)}
            placeholder="any" style={{ ...inputStyle, width: 70 }} />
        </Field>
        <Field label="Beat">
          <input type="number" value={beatIndex} onChange={e => setBeatIndex(e.target.value)}
            placeholder="any" style={{ ...inputStyle, width: 70 }} />
        </Field>
        <Field label="Limit">
          <select value={limit} onChange={e => setLimit(parseInt(e.target.value))} style={selectStyle}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
        </Field>
        <Field label="Failed only">
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.74rem", color: "var(--text-primary)", paddingTop: 4 }}>
            <input
              type="checkbox"
              checked={failedOnly}
              onChange={e => setFailedOnly(e.target.checked)}
            />
            errors only
          </label>
        </Field>
        <button onClick={load} disabled={loading} style={buttonStyle}>
          {loading ? "loading…" : "refresh now"}
        </button>
        {lastRefresh && (
          <span style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", alignSelf: "flex-end", paddingBottom: 6 }}>
            auto · last {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
        <Field label="Search">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="agent / model / novel"
            style={{ ...inputStyle, width: 180 }}
          />
        </Field>
        {(novelId || agent || chapter || beatIndex || failedOnly || search) && (
          <button onClick={() => { setNovelId(""); setAgent(""); setChapter(""); setBeatIndex(""); setFailedOnly(false); setSearch("") }}
            style={{ ...buttonStyle, background: "transparent" }}>
            clear
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--red)", marginBottom: 12, fontSize: "0.78rem" }}>{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: 16 }}>
        {/* List view */}
        <div style={{
          background: "var(--bg-surface)", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-subtle)", overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.74rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-raised)", color: "var(--text-secondary)" }}>
                <Th col="id" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>id</Th>
                <Th col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>status</Th>
                <Th col="agent" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>agent</Th>
                <Th col="novel" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>novel</Th>
                <Th col="ch" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>ch</Th>
                <Th col="beat" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>beat</Th>
                <Th col="att" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>att</Th>
                <Th col="model" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>model</Th>
                <Th col="in" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right">in</Th>
                <Th col="out" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right">out</Th>
                <Th col="ms" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right">ms</Th>
                <Th col="$" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right">$</Th>
              </tr>
            </thead>
            <tbody>
              {clusteredRows.map(({ row, isNewCluster }) => (
                <tr
                  key={row.id}
                  onClick={() => openCall(row.id)}
                  title={row.failed && row.error_text ? row.error_text : undefined}
                  style={{
                    cursor: "pointer",
                    borderTop: isNewCluster
                      ? "1px solid var(--border-default)"
                      : "1px solid var(--border-subtle)",
                    background: selected?.id === row.id
                      ? "var(--accent-surface)"
                      : row.failed
                        ? "rgba(239, 68, 68, 0.08)"
                        : undefined,
                  }}
                  onMouseEnter={e => { if (selected?.id !== row.id) (e.currentTarget as HTMLElement).style.background = "var(--bg-raised)" }}
                  onMouseLeave={e => {
                    if (selected?.id !== row.id) {
                      (e.currentTarget as HTMLElement).style.background = row.failed ? "rgba(239, 68, 68, 0.08)" : ""
                    }
                  }}
                >
                  <Td muted>{row.id}</Td>
                  <Td>
                    {row.failed
                      ? <span style={{ color: "var(--red)", fontWeight: 600 }}>FAIL</span>
                      : <span style={{ color: "var(--text-tertiary)" }}>ok</span>}
                  </Td>
                  <Td>{row.agent}</Td>
                  <Td muted>{row.novel_id ? row.novel_id.slice(0, 8) : "—"}</Td>
                  <Td>{row.chapter ?? "—"}</Td>
                  <Td>{row.beat_index ?? "—"}</Td>
                  <Td>{row.attempt ?? "—"}</Td>
                  <Td muted>{shortModel(row.model)}</Td>
                  <Td align="right">{row.prompt_tokens}</Td>
                  <Td align="right">{row.completion_tokens}</Td>
                  <Td align="right">{row.latency_ms}</Td>
                  <Td align="right">{Number(row.cost).toFixed(4)}</Td>
                </tr>
              ))}
              {clusteredRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>
                    {rows.length > 0 ? "no rows match search" : "no calls match these filters"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {rows.length > 0 && (
            <div style={{
              padding: "5px 10px", fontSize: "0.68rem", color: "var(--text-tertiary)",
              borderTop: "1px solid var(--border-subtle)", textAlign: "right",
            }}>
              {clusteredRows.length < rows.length
                ? `${clusteredRows.length} of ${rows.length} rows`
                : `${rows.length} rows`}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel
            call={selected}
            loading={selectedLoading}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

function DetailPanel({ call, loading, onClose }: { call: LLMCallDetail; loading: boolean; onClose: () => void }) {
  return (
    <div style={{
      background: "var(--bg-surface)", borderRadius: "var(--radius-md)",
      border: "1px solid var(--border-default)", padding: 16,
      maxHeight: "calc(100vh - 200px)", overflowY: "auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: "0.85rem", color: "var(--accent)", marginBottom: 4 }}>
            #{call.id} · {call.agent}
            {call.failed && (
              <span style={{
                marginLeft: 8, padding: "1px 6px", borderRadius: "var(--radius-sm)",
                background: "var(--red)", color: "#fff", fontSize: "0.65rem", fontWeight: 600,
              }}>FAILED</span>
            )}
          </h3>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
            {call.provider}/{shortModel(call.model)} · t={call.temperature ?? "—"} · {call.prompt_tokens}+{call.completion_tokens} tokens · {call.latency_ms}ms · ${Number(call.cost).toFixed(4)}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: 2 }}>
            novel={call.novel_id?.slice(0, 12) ?? "—"} · ch={call.chapter ?? "—"} · beat={call.beat_index ?? "—"} · attempt={call.attempt ?? "—"} · {new Date(call.timestamp).toLocaleString()}
          </div>
        </div>
        <button onClick={onClose} style={{ ...buttonStyle, padding: "2px 8px" }}>×</button>
      </div>

      {loading && <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>loading…</p>}

      {/* Failure summary — pinned at top so it's the first thing you see */}
      {call.failed && (
        <div style={{
          marginBottom: 12, padding: 10,
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid var(--red)",
          borderRadius: "var(--radius-sm)",
        }}>
          <div style={{
            fontSize: "0.65rem", color: "var(--red)", fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6,
          }}>
            error
          </div>
          <pre style={{
            ...preStyle,
            background: "transparent", border: "none", padding: 0,
            color: "var(--text-primary)", maxHeight: 200,
          }}>{call.error_text ?? "(no error text captured)"}</pre>
        </div>
      )}

      {call.system_prompt == null && call.user_prompt == null && !call.failed && (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.74rem", padding: 12, background: "var(--bg-inset)", borderRadius: "var(--radius-sm)" }}>
          No prompt text stored for this call. Calls logged before sql/017_llm_call_inspection.sql have NULL prompt fields.
        </p>
      )}

      {call.system_prompt != null && (
        <Section title="system prompt" tokens={null}>
          <pre style={preStyle}>{call.system_prompt}</pre>
        </Section>
      )}

      {call.user_prompt != null && (
        <Section title={`user prompt (${call.prompt_tokens} tokens)`} tokens={null}>
          <pre style={preStyle}>{call.user_prompt}</pre>
        </Section>
      )}

      {call.response_content != null && (
        <Section title={`response (${call.completion_tokens} tokens)`} tokens={null}>
          <pre style={{ ...preStyle, color: "var(--accent)" }}>{call.response_content}</pre>
        </Section>
      )}

      {call.request_json != null && (
        <Section title="request envelope (provider/model/params)" tokens={null}>
          <pre style={preStyle}>{JSON.stringify(call.request_json, null, 2)}</pre>
        </Section>
      )}

      {(call.zod_errors || call.retry_errors
        || (call.json_extraction_success === false)
        || (call.zod_validation_success === false)) && (
        <Section title="diagnostics" tokens={null}>
          <pre style={{ ...preStyle, color: "var(--red)" }}>
            {JSON.stringify({
              json_extraction_success: call.json_extraction_success,
              json_extraction_retried: call.json_extraction_retried,
              zod_validation_success: call.zod_validation_success,
              zod_errors: call.zod_errors,
              http_attempts: call.http_attempts,
              retry_errors: call.retry_errors,
            }, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; tokens: number | null; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: 4,
          cursor: "pointer", userSelect: "none", textTransform: "uppercase", letterSpacing: "0.04em",
        }}
      >
        {collapsed ? "▸" : "▾"} {title}
      </div>
      {!collapsed && children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</label>
      {children}
    </div>
  )
}

function Th({
  children, align, col, sortCol, sortDir, onSort,
}: {
  children: React.ReactNode
  align?: "left" | "right"
  col?: SortCol
  sortCol?: SortCol
  sortDir?: SortDir
  onSort?: (col: SortCol) => void
}) {
  const active = col && sortCol === col
  return (
    <th
      onClick={col && onSort ? () => onSort(col) : undefined}
      style={{
        padding: "6px 8px", textAlign: align ?? "left", fontWeight: 500,
        fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em",
        cursor: col ? "pointer" : undefined,
        userSelect: "none",
        color: active ? "var(--text-primary)" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {col && (
        <span style={{ marginLeft: 4, opacity: active ? 1 : 0.25, fontSize: "0.6rem" }}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      )}
    </th>
  )
}

function Td({ children, align, muted }: { children: React.ReactNode; align?: "left" | "right"; muted?: boolean }) {
  return (
    <td style={{
      padding: "5px 8px", textAlign: align ?? "left",
      color: muted ? "var(--text-tertiary)" : "var(--text-primary)",
      fontVariantNumeric: "tabular-nums",
    }}>
      {children}
    </td>
  )
}

function shortModel(m: string): string {
  // Trim provider prefixes and version suffixes for table display
  return m.replace(/^[^\/]+\//, "").replace(/-instruct.*$/i, "")
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-inset)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
  padding: "4px 8px", fontSize: "0.74rem", fontFamily: "var(--font-mono)",
}

const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 120 }

const buttonStyle: React.CSSProperties = {
  background: "var(--bg-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
  padding: "5px 12px", fontSize: "0.74rem", fontFamily: "var(--font-mono)",
  cursor: "pointer", alignSelf: "flex-end",
}

const preStyle: React.CSSProperties = {
  background: "var(--bg-inset)", color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)",
  padding: 10, fontSize: "0.72rem", fontFamily: "var(--font-mono)",
  whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 400, overflowY: "auto",
}
