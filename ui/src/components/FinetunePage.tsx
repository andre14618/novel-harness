import { useEffect, useState, useCallback, useRef } from "react"
import {
  getFinetuneStats,
  getFinetunePairs,
  getFinetunePair,
  updateFinetunePair,
  exportFinetuneData,
  generateFinetuneData,
  getExperiments,
  type FinetuneStats,
  type FinetunePair,
  type ExperimentSummary,
} from "../api"

const TASKS = ["fact-extractor", "adherence-checker", "chapter-plan-checker", "tonal-pass"]
const STATUSES = ["pending", "reviewed", "approved", "rejected"]
const FACT_CATEGORIES = ["physical", "rule", "relationship", "knowledge", "identity", "temporal"]

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved" ? "done" :
    status === "rejected" ? "error" :
    status === "reviewed" ? "waiting" :
    "idle"
  return <span className={`badge ${cls}`}>{status}</span>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "..." : s
}

function tryParse(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}

// ── Per-item review components ────────────────────────────────────────

interface FactItem {
  fact: string
  category: string
  enabled: boolean
  feedback: string
}

function FactReview({ items, onChange }: { items: FactItem[]; onChange: (items: FactItem[]) => void }) {
  function update(i: number, patch: Partial<FactItem>) {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  function addFact() {
    onChange([...items, { fact: "", category: "physical", enabled: true, feedback: "" }])
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      {items.map((item, i) => (
        <div key={i} style={{
          display: "flex", gap: "0.4rem", alignItems: "center",
          padding: "0.4rem 0.5rem", borderRadius: "var(--radius-sm)",
          background: item.enabled ? "transparent" : "var(--bg-inset)",
          opacity: item.enabled ? 1 : 0.4,
          borderLeft: item.feedback ? "3px solid var(--yellow)" : "3px solid transparent",
          transition: "opacity 0.15s",
        }}>
          {/* Keep/remove toggle */}
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={() => update(i, { enabled: !item.enabled })}
            style={{ flexShrink: 0, cursor: "pointer", accentColor: "var(--accent)" }}
          />

          {/* Fact text + category tag */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.78rem", color: item.enabled ? "var(--text-primary)" : "var(--text-ghost)", lineHeight: 1.4 }}>
              <span style={{
                fontSize: "0.65rem", padding: "1px 5px", borderRadius: "3px",
                background: "var(--bg-inset)", color: "var(--text-tertiary)",
                marginRight: "0.4rem", fontFamily: "var(--font-mono)",
              }}>
                {item.category}
              </span>
              {item.fact}
            </div>
            {/* Feedback — click to add */}
            {item.feedback ? (
              <input type="text" value={item.feedback} onChange={e => update(i, { feedback: e.target.value })}
                style={{
                  marginTop: "0.2rem", fontSize: "0.7rem", padding: "1px 4px", width: "100%",
                  background: "transparent", border: "none", borderBottom: "1px solid var(--yellow)",
                  color: "var(--yellow)", outline: "none",
                }}
              />
            ) : item.enabled ? (
              <button onClick={() => update(i, { feedback: " " })}
                style={{
                  marginTop: "0.15rem", fontSize: "0.65rem", padding: "0", border: "none",
                  background: "none", color: "var(--text-ghost)", cursor: "pointer", textDecoration: "underline",
                }}>
                + comment
              </button>
            ) : null}
          </div>
        </div>
      ))}

      <button className="secondary" onClick={addFact} style={{ alignSelf: "flex-start", fontSize: "0.75rem", padding: "4px 12px", marginTop: "0.3rem" }}>
        + Add Missing Fact
      </button>
    </div>
  )
}

interface CheckItem {
  text: string
  enabled: boolean
  feedback: string
}

function ChecklistReview({ items, onChange, label, addLabel }: {
  items: CheckItem[]; onChange: (items: CheckItem[]) => void; label: string; addLabel: string
}) {
  function update(i: number, patch: Partial<CheckItem>) {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  function remove(i: number) { onChange(items.filter((_, j) => j !== i)) }
  function add() { onChange([...items, { text: "", enabled: true, feedback: "" }]) }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {items.length === 0 && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-ghost)", fontStyle: "italic" }}>No {label.toLowerCase()} reported by base model</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="card" style={{
          padding: "0.5rem 0.7rem",
          opacity: item.enabled ? 1 : 0.4,
          borderColor: item.feedback ? "var(--yellow)" : undefined,
        }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <button
              onClick={() => update(i, { enabled: !item.enabled })}
              style={{
                padding: "2px 6px", fontSize: "0.7rem", flexShrink: 0, marginTop: "2px",
                background: item.enabled ? "var(--accent-surface)" : "var(--bg-inset)",
                color: item.enabled ? "var(--accent)" : "var(--text-ghost)",
                border: `1px solid ${item.enabled ? "var(--accent-dim)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-sm)", cursor: "pointer",
              }}
            >
              {item.enabled ? "ON" : "OFF"}
            </button>
            <input
              type="text"
              value={item.text}
              onChange={e => update(i, { text: e.target.value })}
              placeholder={`${label} description...`}
              style={{
                flex: 1, fontSize: "0.78rem", padding: "3px 6px",
                background: "var(--bg-inset)", border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
              }}
            />
            <button onClick={() => remove(i)} className="secondary"
              style={{ padding: "2px 6px", fontSize: "0.7rem", flexShrink: 0, color: "var(--red)" }}>x</button>
          </div>
          {item.enabled && (
            <input type="text" value={item.feedback} onChange={e => update(i, { feedback: e.target.value })}
              placeholder="Feedback (optional)" style={{
                marginTop: "0.3rem", fontSize: "0.72rem", padding: "2px 6px", width: "100%",
                background: "transparent", border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)", color: "var(--text-tertiary)",
              }}
            />
          )}
        </div>
      ))}
      <button className="secondary" onClick={add} style={{ alignSelf: "flex-start", fontSize: "0.75rem", padding: "4px 12px" }}>
        + {addLabel}
      </button>
    </div>
  )
}

// ── Convert between structured items and JSON ────────────────────────

function factsToItems(json: string): FactItem[] {
  const parsed = tryParse(json)
  if (!parsed?.facts) return []
  return parsed.facts.map((f: any) => ({
    fact: f.fact || "",
    category: f.category || "physical",
    enabled: true,
    feedback: "",
  }))
}

function itemsToFactsJson(items: FactItem[]): string {
  const facts = items.filter(i => i.enabled).map(i => ({ fact: i.fact, category: i.category }))
  return JSON.stringify({ facts }, null, 2)
}

function checklistToItems(json: string, key: string): CheckItem[] {
  const parsed = tryParse(json)
  const arr = parsed?.[key]
  if (!Array.isArray(arr)) return []
  return arr.map((s: string) => ({ text: s, enabled: true, feedback: "" }))
}

function itemsToChecklistJson(items: CheckItem[], key: string, passKey: string, json: string): string {
  const parsed = tryParse(json) || {}
  const enabled = items.filter(i => i.enabled).map(i => i.text)
  return JSON.stringify({ [passKey]: enabled.length === 0, [key]: enabled }, null, 2)
}

function collectFeedback(items: (FactItem | CheckItem)[]): string {
  return items.filter(i => i.feedback).map(i => {
    const label = "fact" in i ? (i as FactItem).fact : (i as CheckItem).text
    return `[${truncate(label, 40)}] ${i.feedback}`
  }).join("\n")
}

// ═══════════════════════════════════════════════════════════════════════
// Slots Strategy Tab
// ═══════════════════════════════════════════════════════════════════════

type SlotStatus = "live" | "in-progress" | "pending" | "blocked" | "experimental" | "data-needed"

interface SlotDef {
  key: string
  label: string
  agentKey: string
  currentModel: string
  provider: string
  status: SlotStatus
  statusNote: string
  priority: number
  costPerCall: string
  dataStatus: string
  experimentTargetKey: string
}

const SLOT_DEFS: SlotDef[] = [
  {
    key: "adherence-checker",
    label: "Adherence Checker",
    agentKey: "adherence-checker",
    currentModel: "Qwen3-14B-Instruct",
    provider: "wandb",
    status: "live",
    statusNote: "Base model = oracle (96% agreement, exp #101). No fine-tune needed. Swap confirmed 2026-04-08.",
    priority: 2,
    costPerCall: "$0.00005",
    dataStatus: "160 pairs validated (exp #100)",
    experimentTargetKey: "adherence-checker",
  },
  {
    key: "tonal-pass",
    label: "Tonal Pass",
    agentKey: "tonal-pass",
    currentModel: "Qwen3.5-9B + howard-tonal-v3 (Together)",
    provider: "together",
    status: "in-progress",
    statusNote: "V4 (Qwen3-14B W&B, exp #98) beats V3 on all quantitative metrics. Pref eval in progress at /app/lora-style. V5 pending pref eval outcome.",
    priority: 5,
    costPerCall: "$0.0002",
    dataStatus: "4,497 training pairs (v3/v4). Pref eval: 15 paragraphs in UI.",
    experimentTargetKey: "tonal-pass",
  },
  {
    key: "continuity",
    label: "Continuity",
    agentKey: "continuity",
    currentModel: "Qwen3-235B (Cerebras)",
    provider: "cerebras",
    status: "pending",
    statusNote: "Highest per-call cost (7,294 avg input tokens, $0.0023/call). Phase 3 — requires compact diff format design first.",
    priority: 1,
    costPerCall: "$0.0023",
    dataStatus: "Not started. Needs compact diff schema design before data generation.",
    experimentTargetKey: "continuity",
  },
  {
    key: "chapter-plan-checker",
    label: "Chapter Plan Checker",
    agentKey: "chapter-plan-checker",
    currentModel: "gpt-oss-120b (Groq)",
    provider: "groq",
    status: "data-needed",
    statusNote: "Base 14B zero-shot = 58% agreement with 120B oracle (exp #107). 100% one-directional: 14B rubber-stamps all FAIL cases, incl. FAIL_WRONG_SETTING at 0/10. Highly learnable one-sided bias — fine-tune (distill 120B) is the path. Keep 120B in prod until adapter exists.",
    priority: 4,
    costPerCall: "$0.0007",
    dataStatus: "80 synthetic pairs generated (lora-data/chapter-plan-checker-pairs.jsonl). Relabel with 120B from exp #107, plus accumulate 200+ real production pairs.",
    experimentTargetKey: "chapter-plan-checker",
  },
  {
    key: "reference-resolver",
    label: "Reference Resolver",
    agentKey: "reference-resolver",
    currentModel: "Llama 3.1 8B (Groq)",
    provider: "groq",
    status: "pending",
    statusNote: "Parallel-3 set-union compensates for low single-shot recall. Fine-tune could collapse to single-shot. Phase 1.",
    priority: 3,
    costPerCall: "$0.00003",
    dataStatus: "Best-of-3 union outputs from approved beats. Not yet collected.",
    experimentTargetKey: "reference-resolver",
  },
  {
    key: "fact-extractor",
    label: "Fact Extractor",
    agentKey: "fact-extractor",
    currentModel: "MiMo Flash",
    provider: "mimo",
    status: "pending",
    statusNote: "Over-extracts (17-20 facts/chapter vs target 8-15). Needs labeled keep/drop examples. Phase 2.",
    priority: 6,
    costPerCall: "~$0.0001",
    dataStatus: "Review UI exists (/app/finetune → Data). Pairs accumulating.",
    experimentTargetKey: "fact-extractor",
  },
  {
    key: "lint-fixer",
    label: "Lint Fixer",
    agentKey: "lint-fixer",
    currentModel: "Qwen3-235B (Cerebras)",
    provider: "cerebras",
    status: "pending",
    statusNote: "Per-sentence cliché rewrite. Mine (flagged_sentence, context, good_rewrite) from approved chapters. Phase 4.",
    priority: 7,
    costPerCall: "$0.00005",
    dataStatus: "Not started. Mine from approved novel chapters.",
    experimentTargetKey: "lint-fixer",
  },
  {
    key: "beat-writer",
    label: "Beat Writer",
    agentKey: "beat-writer",
    currentModel: "Qwen3-235B (Cerebras)",
    provider: "cerebras",
    status: "experimental",
    statusNote: "Highest upside (7.8× cost reduction) but highest risk — creative core. Needs 500+ high-quality examples. Phase 4.",
    priority: 8,
    costPerCall: "$0.001",
    dataStatus: "Not started. Collect from best-rated novel runs only.",
    experimentTargetKey: "beat-writer",
  },
]

const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  "live": "Live",
  "in-progress": "In Progress",
  "pending": "Pending",
  "blocked": "Blocked",
  "experimental": "Experimental",
  "data-needed": "Data Needed",
}

const SLOT_STATUS_COLOR: Record<SlotStatus, string> = {
  "live": "var(--green, #4caf50)",
  "in-progress": "var(--accent)",
  "pending": "var(--text-tertiary)",
  "blocked": "var(--yellow, #f0a500)",
  "experimental": "var(--text-ghost)",
  "data-needed": "var(--yellow, #f0a500)",
}

function SlotStatusBadge({ status }: { status: SlotStatus }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "0.68rem",
      fontWeight: 700,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      background: `color-mix(in srgb, ${SLOT_STATUS_COLOR[status]} 15%, transparent)`,
      border: `1px solid color-mix(in srgb, ${SLOT_STATUS_COLOR[status]} 40%, transparent)`,
      color: SLOT_STATUS_COLOR[status],
    }}>
      {SLOT_STATUS_LABEL[status]}
    </span>
  )
}

function SlotsTab() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getExperiments(200).then(exps => {
      setExperiments(exps)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function getSlotExperiments(targetKey: string): ExperimentSummary[] {
    return experiments.filter(e => e.target === targetKey).slice(0, 5)
  }

  function extractAgreementPct(conclusion: string | null): string | null {
    if (!conclusion) return null
    const m = conclusion.match(/(\d+)%\s*(oracle\s+)?agreement/)
    if (m) return `${m[1]}% agreement`
    const m2 = conclusion.match(/agree[^)]*?\((\d+)%\)/)
    if (m2) return `${m2[1]}% agreement`
    return null
  }

  const sortedSlots = [...SLOT_DEFS].sort((a, b) => a.priority - b.priority)

  return (
    <div>
      <p style={{ color: "var(--text-tertiary)", fontSize: "0.82rem", marginBottom: "1.5rem", marginTop: 0 }}>
        One base model — <code>OpenPipe/Qwen3-14B-Instruct</code> on W&B Inference — with multiple task-specific LoRA adapters.
        Training is free (W&B Serverless SFT). Each slot is a fine-tune candidate ordered by expected ROI.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {sortedSlots.map(slot => {
          const slotExps = getSlotExperiments(slot.experimentTargetKey)
          const latestExp = slotExps[0]
          const agreementPct = latestExp ? extractAgreementPct(latestExp.conclusion) : null

          return (
            <div key={slot.key} className="card" style={{
              padding: "1rem 1.2rem",
              borderLeft: `3px solid ${SLOT_STATUS_COLOR[slot.status]}`,
              opacity: slot.status === "experimental" ? 0.75 : 1,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-ghost)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                    #{slot.priority}
                  </span>
                  <h3 style={{ margin: 0, fontSize: "0.9rem" }}>{slot.label}</h3>
                  <SlotStatusBadge status={slot.status} />
                  {agreementPct && (
                    <span style={{ fontSize: "0.7rem", color: "var(--accent)", fontWeight: 600 }}>{agreementPct}</span>
                  )}
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-ghost)", textAlign: "right" }}>
                  <span style={{ color: "var(--text-tertiary)" }}>{slot.costPerCall}/call</span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 2rem", marginBottom: "0.6rem" }}>
                <div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-ghost)", marginBottom: "2px" }}>CURRENT MODEL</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                    {slot.currentModel}
                    <span style={{ fontSize: "0.65rem", color: "var(--text-ghost)", marginLeft: "6px" }}>({slot.provider})</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-ghost)", marginBottom: "2px" }}>TRAINING DATA</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-tertiary)" }}>{slot.dataStatus}</div>
                </div>
              </div>

              <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: slotExps.length ? "0.6rem" : 0 }}>
                {slot.statusNote}
              </div>

              {slotExps.length > 0 && (
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                  {slotExps.map(exp => (
                    <a
                      key={exp.id}
                      href={`/app/experiments#${exp.id}`}
                      style={{
                        fontSize: "0.68rem",
                        padding: "2px 7px",
                        borderRadius: "4px",
                        background: "var(--bg-inset)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-tertiary)",
                        textDecoration: "none",
                        cursor: "pointer",
                      }}
                    >
                      #{exp.id} {exp.type}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {loading && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-ghost)", marginTop: "1rem" }}>Loading experiments...</p>
      )}

      <div className="card" style={{ marginTop: "1.5rem", padding: "0.8rem 1.2rem" }}>
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>Infrastructure</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem 2rem" }}>
          {[
            ["Base model", "OpenPipe/Qwen3-14B-Instruct"],
            ["Training", "W&B Serverless SFT (free, public preview)"],
            ["Serving", "W&B Inference ($0.05/$0.22 per 1M)"],
            ["Max LoRA rank", "16 (W&B hard limit)"],
            ["Storage", "Free under 100GB (~50MB per r=16 adapter)"],
            ["Training script", "scripts/train-lora.py"],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: "0.65rem", color: "var(--text-ghost)", marginBottom: "2px" }}>{k}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════

export function FinetunePage() {
  const [mainTab, setMainTab] = useState<"strategy" | "data">("strategy")
  const [view, setView] = useState<"list" | "review">("list")
  const [stats, setStats] = useState<FinetuneStats | null>(null)
  const [pairs, setPairs] = useState<FinetunePair[]>([])
  const [loading, setLoading] = useState(true)
  const [taskFilter, setTaskFilter] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("")

  // Review state
  const [currentPair, setCurrentPair] = useState<FinetunePair | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [reviewerNotes, setReviewerNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [saveFlash, setSaveFlash] = useState<string | null>(null)
  const [showRawJson, setShowRawJson] = useState(false)
  const [rawJsonEdit, setRawJsonEdit] = useState("")

  // Structured edit state
  const [factItems, setFactItems] = useState<FactItem[]>([])
  const [checkItems, setCheckItems] = useState<CheckItem[]>([])
  const [passToggle, setPassToggle] = useState(true)

  // Generate dialog
  const [showGenerate, setShowGenerate] = useState(false)
  const [genTask, setGenTask] = useState(TASKS[0])
  const [genLimit, setGenLimit] = useState(50)
  const [generating, setGenerating] = useState(false)

  // Refs for scroll sync
  const sourceRef = useRef<HTMLDivElement>(null)

  const loadStats = useCallback(async () => {
    try { setStats(await getFinetuneStats()) } catch {}
  }, [])

  const loadPairs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getFinetunePairs(taskFilter || undefined, statusFilter || undefined, 200)
      setPairs(res.pairs)
    } catch {}
    setLoading(false)
  }, [taskFilter, statusFilter])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadPairs() }, [loadPairs])

  // ── Initialize structured edit from pair ─────────────────────────

  function initStructuredEdit(pair: FinetunePair) {
    const source = pair.gold_output ?? pair.base_output
    if (pair.task === "fact-extractor") {
      setFactItems(factsToItems(source))
    } else if (pair.task === "adherence-checker") {
      setCheckItems(checklistToItems(source, "issues"))
      setPassToggle(tryParse(source)?.pass ?? true)
    } else if (pair.task === "chapter-plan-checker") {
      setCheckItems(checklistToItems(source, "deviations"))
      setPassToggle(tryParse(source)?.pass ?? true)
    }
    setRawJsonEdit(source)
  }

  function getEditedJson(): string {
    if (showRawJson) return rawJsonEdit
    if (!currentPair) return "{}"
    if (currentPair.task === "fact-extractor") return itemsToFactsJson(factItems)
    if (currentPair.task === "adherence-checker") return itemsToChecklistJson(checkItems, "issues", "pass", currentPair.base_output)
    if (currentPair.task === "chapter-plan-checker") return itemsToChecklistJson(checkItems, "deviations", "pass", currentPair.base_output)
    return rawJsonEdit
  }

  // ── Review View handlers ─────────────────────────────────────────

  function openReview(pair: FinetunePair, index: number) {
    setCurrentPair(pair)
    setCurrentIndex(index)
    setReviewerNotes(pair.reviewer_notes ?? "")
    setShowSystemPrompt(false)
    setShowRawJson(false)
    setSaveFlash(null)
    initStructuredEdit(pair)
    setView("review")
  }

  async function navigateReview(dir: -1 | 1) {
    const newIndex = currentIndex + dir
    if (newIndex < 0 || newIndex >= pairs.length) return
    const p = pairs[newIndex]
    try { openReview(await getFinetunePair(p.id), newIndex) }
    catch { openReview(p, newIndex) }
  }

  async function saveReview(newStatus: string) {
    if (!currentPair) return
    setSaving(true)
    setSaveFlash(null)
    try {
      let output = getEditedJson()
      try { output = JSON.stringify(JSON.parse(output), null, 2) } catch {}

      // Collect per-item feedback into notes
      let notes = reviewerNotes
      let itemFeedback = ""
      if (currentPair.task === "fact-extractor") itemFeedback = collectFeedback(factItems)
      else itemFeedback = collectFeedback(checkItems)
      if (itemFeedback) notes = notes ? `${notes}\n\n--- Item Feedback ---\n${itemFeedback}` : `--- Item Feedback ---\n${itemFeedback}`

      const updated = await updateFinetunePair(currentPair.id, {
        gold_output: output,
        status: newStatus,
        reviewer_notes: notes || undefined,
      })
      setCurrentPair(updated)
      setPairs(prev => prev.map(p => p.id === updated.id ? updated : p))
      setSaveFlash(`Saved as ${newStatus}`)
      setTimeout(() => setSaveFlash(null), 2000)
    } catch (err) {
      setSaveFlash(`Error: ${err instanceof Error ? err.message : err}`)
    }
    setSaving(false)
  }

  async function handleExport() {
    const task = taskFilter || TASKS[0]
    try {
      const blob = await exportFinetuneData(task)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `${task}-approved.jsonl`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) { alert(`Export failed: ${err instanceof Error ? err.message : err}`) }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      await generateFinetuneData(genTask, genLimit)
      setShowGenerate(false)
      setSaveFlash("Generation started in background")
      setTimeout(() => { setSaveFlash(null); loadStats(); loadPairs() }, 3000)
    } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : err}`) }
    setGenerating(false)
  }

  // Keyboard shortcuts
  useEffect(() => {
    if (view !== "review") return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowLeft") navigateReview(-1)
      else if (e.key === "ArrowRight") navigateReview(1)
      else if (e.key === "a" && !e.metaKey && !e.ctrlKey) saveReview("approved")
      else if (e.key === "r" && !e.metaKey && !e.ctrlKey) saveReview("rejected")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view, currentIndex, factItems, checkItems, rawJsonEdit, reviewerNotes])

  // ═══════════════════════════════════════════════════════════════════
  // Review View
  // ═══════════════════════════════════════════════════════════════════
  if (view === "review" && currentPair) {
    const isStructured = ["fact-extractor", "adherence-checker", "chapter-plan-checker"].includes(currentPair.task)

    return (
      <div>
        <h1>Review Training Pair</h1>

        {/* Nav bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
          <button className="secondary" onClick={() => { setView("list"); loadPairs() }}>Back to List</button>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--text-ghost)" }}>
              arrow keys to nav | <strong>a</strong>=approve <strong>r</strong>=reject
            </span>
            <span style={{ fontSize: "0.78rem", color: "var(--text-tertiary)", margin: "0 0.3rem" }}>
              {currentIndex + 1} / {pairs.length}
            </span>
            <button className="secondary" onClick={() => navigateReview(-1)} disabled={currentIndex <= 0}>Prev</button>
            <button className="secondary" onClick={() => navigateReview(1)} disabled={currentIndex >= pairs.length - 1}>Next</button>
          </div>
        </div>

        {/* Metadata */}
        <div className="card" style={{ padding: "0.5rem 1rem", marginBottom: "0.8rem" }}>
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", fontSize: "0.78rem", flexWrap: "wrap" }}>
            <span><span style={{ color: "var(--text-tertiary)" }}>Task:</span> {currentPair.task}</span>
            <span><span style={{ color: "var(--text-tertiary)" }}>Novel:</span> {currentPair.novel_id ? truncate(currentPair.novel_id, 16) : "n/a"}</span>
            <span><span style={{ color: "var(--text-tertiary)" }}>Ch:</span> {currentPair.chapter_number ?? "n/a"}</span>
            <StatusBadge status={currentPair.status} />
            {isStructured && (
              <button className="secondary" style={{ padding: "2px 8px", fontSize: "0.68rem" }}
                onClick={() => {
                  if (!showRawJson) setRawJsonEdit(getEditedJson())
                  setShowRawJson(!showRawJson)
                }}>
                {showRawJson ? "Structured" : "Raw JSON"}
              </button>
            )}
          </div>
        </div>

        {/* Two-panel layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem", marginBottom: "0.8rem" }}>
          {/* Left: Source text */}
          <div className="card" style={{ padding: "0", display: "flex", flexDirection: "column" }}>
            <div style={{
              padding: "0.5rem 1rem",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Source Text
              </span>
              <button className="secondary" style={{ padding: "2px 8px", fontSize: "0.68rem" }}
                onClick={() => setShowSystemPrompt(!showSystemPrompt)}>
                {showSystemPrompt ? "Hide" : "Show"} Prompt
              </button>
            </div>
            {showSystemPrompt && (
              <div style={{
                padding: "0.6rem 1rem", borderBottom: "1px solid var(--border-subtle)",
                background: "var(--bg-inset)", fontSize: "0.72rem", lineHeight: 1.5,
                color: "var(--text-ghost)", whiteSpace: "pre-wrap", maxHeight: "150px", overflowY: "auto",
              }}>
                {currentPair.system_prompt}
              </div>
            )}
            <div ref={sourceRef} style={{
              padding: "0.8rem 1rem", fontFamily: "var(--font-mono)", fontSize: "0.75rem",
              lineHeight: 1.65, whiteSpace: "pre-wrap", overflowY: "auto",
              maxHeight: "65vh", color: "var(--text-secondary)",
            }}>
              {currentPair.user_content}
            </div>
          </div>

          {/* Right: Structured editor or raw JSON */}
          <div className="card" style={{ padding: "0", display: "flex", flexDirection: "column" }}>
            <div style={{
              padding: "0.5rem 1rem", borderBottom: "1px solid var(--border-subtle)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {showRawJson ? "Raw JSON" : "Extraction Review"}
              </span>
              <button className="secondary" style={{ padding: "2px 8px", fontSize: "0.68rem" }}
                onClick={() => initStructuredEdit(currentPair)}>
                Reset to Base
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", maxHeight: "65vh", padding: "0.8rem" }}>
              {showRawJson || !isStructured ? (
                <textarea
                  value={showRawJson ? rawJsonEdit : (getEditedJson())}
                  onChange={e => setRawJsonEdit(e.target.value)}
                  style={{
                    width: "100%", minHeight: "55vh", border: "none", borderRadius: 0,
                    background: "var(--bg-inset)", resize: "none", padding: "0.5rem",
                    fontSize: "0.75rem", lineHeight: 1.5, fontFamily: "var(--font-mono)",
                  }}
                />
              ) : currentPair.task === "fact-extractor" ? (
                <FactReview items={factItems} onChange={setFactItems} />
              ) : (currentPair.task === "adherence-checker" || currentPair.task === "chapter-plan-checker") ? (
                <div>
                  {/* Pass/fail toggle */}
                  <div style={{ marginBottom: "0.8rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)" }}>Overall:</span>
                    <button
                      onClick={() => setPassToggle(true)}
                      style={{
                        padding: "4px 14px", fontSize: "0.75rem", cursor: "pointer",
                        background: passToggle ? "var(--accent-surface)" : "var(--bg-inset)",
                        color: passToggle ? "var(--accent)" : "var(--text-ghost)",
                        border: `1px solid ${passToggle ? "var(--accent-dim)" : "var(--border-subtle)"}`,
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      PASS
                    </button>
                    <button
                      onClick={() => setPassToggle(false)}
                      style={{
                        padding: "4px 14px", fontSize: "0.75rem", cursor: "pointer",
                        background: !passToggle ? "rgba(var(--red-rgb, 239,68,68), 0.1)" : "var(--bg-inset)",
                        color: !passToggle ? "var(--red)" : "var(--text-ghost)",
                        border: `1px solid ${!passToggle ? "var(--red)" : "var(--border-subtle)"}`,
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      FAIL
                    </button>
                  </div>
                  <ChecklistReview
                    items={checkItems}
                    onChange={setCheckItems}
                    label={currentPair.task === "adherence-checker" ? "Issue" : "Deviation"}
                    addLabel={currentPair.task === "adherence-checker" ? "Add Issue" : "Add Deviation"}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Notes + actions */}
        <div className="card" style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem", display: "block" }}>
            Reviewer Notes
          </label>
          <textarea
            value={reviewerNotes}
            onChange={e => setReviewerNotes(e.target.value)}
            placeholder="General notes, patterns noticed, corrections made..."
            style={{ minHeight: "50px", marginBottom: "0.6rem" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button onClick={() => saveReview("approved")} disabled={saving}>Approve</button>
            <button className="danger" onClick={() => saveReview("rejected")} disabled={saving}>Reject</button>
            <button className="secondary" onClick={() => saveReview("reviewed")} disabled={saving}>Save Draft</button>
            {saveFlash && (
              <span style={{ fontSize: "0.78rem", fontWeight: 600, color: saveFlash.startsWith("Error") ? "var(--red)" : "var(--accent)" }}>
                {saveFlash}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // List View
  // ═══════════════════════════════════════════════════════════════════
  const totalCount = stats ? Object.values(stats.totals).reduce((a, b) => a + b, 0) : 0

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <h1>Fine-tune Strategy</h1>
        {mainTab === "data" && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="secondary" onClick={() => setShowGenerate(!showGenerate)}>Generate Data</button>
            <button onClick={handleExport} disabled={!taskFilter}>Export Approved</button>
          </div>
        )}
      </div>

      <div className="tab-bar" style={{ marginBottom: "1.5rem" }}>
        <div className={`tab ${mainTab === "strategy" ? "active" : ""}`} onClick={() => setMainTab("strategy")}>Strategy</div>
        <div className={`tab ${mainTab === "data" ? "active" : ""}`} onClick={() => setMainTab("data")}>Training Data</div>
      </div>

      {mainTab === "strategy" && <SlotsTab />}
      {mainTab === "data" && <div>

      {showGenerate && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent-dim)" }}>
          <h3 style={{ marginTop: 0, marginBottom: "0.6rem" }}>Generate Training Data</h3>
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", display: "block", marginBottom: "0.2rem" }}>Task</label>
              <select value={genTask} onChange={e => setGenTask(e.target.value)} style={{ width: "220px" }}>
                {TASKS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", display: "block", marginBottom: "0.2rem" }}>Limit</label>
              <input type="number" value={genLimit} onChange={e => setGenLimit(parseInt(e.target.value) || 50)} style={{ width: "80px" }} />
            </div>
            <button onClick={handleGenerate} disabled={generating}>{generating ? "Starting..." : "Start"}</button>
            <button className="secondary" onClick={() => setShowGenerate(false)}>Cancel</button>
          </div>
          <p style={{ fontSize: "0.7rem", color: "var(--text-ghost)", marginTop: "0.4rem", marginBottom: 0 }}>
            Pulls chapters from Postgres, runs base Qwen 3.5 9B, inserts pairs as pending.
          </p>
        </div>
      )}

      {saveFlash && (
        <div style={{
          padding: "0.4rem 1rem", borderRadius: "var(--radius-sm)",
          background: "var(--accent-surface)", border: "1px solid var(--accent-dim)",
          color: "var(--accent)", fontSize: "0.78rem", marginBottom: "0.8rem",
        }}>
          {saveFlash}
        </div>
      )}

      {stats && (
        <div style={{ fontSize: "0.78rem", color: "var(--text-tertiary)", marginBottom: "1rem", display: "flex", gap: "1.5rem" }}>
          <span>{totalCount} total</span>
          <span style={{ color: "var(--text-ghost)" }}>|</span>
          <span>{stats.totals.pending ?? 0} pending</span>
          <span>{stats.totals.reviewed ?? 0} reviewed</span>
          <span style={{ color: "var(--accent)" }}>{stats.totals.approved ?? 0} approved</span>
          <span style={{ color: "var(--red)" }}>{stats.totals.rejected ?? 0} rejected</span>
        </div>
      )}

      <div className="tab-bar">
        <div className={`tab ${taskFilter === "" ? "active" : ""}`} onClick={() => setTaskFilter("")}>All</div>
        {TASKS.map(t => (
          <div key={t} className={`tab ${taskFilter === t ? "active" : ""}`} onClick={() => setTaskFilter(t)}>
            {t}
            {stats?.byTask[t] && (
              <span style={{ fontSize: "0.68rem", marginLeft: "6px", color: "var(--text-ghost)" }}>
                ({Object.values(stats.byTask[t]).reduce((a, b) => a + b, 0)})
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
        <button className={statusFilter === "" ? undefined : "secondary"} style={{ padding: "4px 12px", fontSize: "0.72rem" }} onClick={() => setStatusFilter("")}>All</button>
        {STATUSES.map(s => (
          <button key={s} className={statusFilter === s ? undefined : "secondary"} style={{ padding: "4px 12px", fontSize: "0.72rem" }} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: "var(--text-tertiary)", fontSize: "0.82rem" }}>Loading...</p>
      ) : pairs.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--text-tertiary)", fontSize: "0.85rem" }}>No training pairs found.</p>
          <p style={{ color: "var(--text-ghost)", fontSize: "0.78rem", marginTop: "0.5rem" }}>
            Use "Generate Data" to create pairs from existing novel chapters.
          </p>
        </div>
      ) : (
        <table className="guide-table">
          <thead>
            <tr>
              <th style={{ width: "100px" }}>ID</th>
              <th>Task</th>
              <th>Novel</th>
              <th style={{ width: "45px" }}>Ch</th>
              <th style={{ width: "85px" }}>Status</th>
              <th style={{ width: "120px" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr key={p.id} onClick={() => openReview(p, i)} style={{ cursor: "pointer" }}>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{p.id.slice(0, 8)}</td>
                <td>{p.task}</td>
                <td style={{ fontSize: "0.75rem" }}>{p.novel_id ? truncate(p.novel_id, 18) : "-"}</td>
                <td>{p.chapter_number ?? "-"}</td>
                <td><StatusBadge status={p.status} /></td>
                <td style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{formatDate(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>}
    </div>
  )
}
