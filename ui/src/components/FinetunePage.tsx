import { useEffect, useState } from "react"
import { LoraComparePage } from "./LoraComparePage"
import { AdaptersPage } from "./AdaptersPage"
import { VoiceComparePage } from "./VoiceComparePage"
import { listAdapters, type Adapter } from "../api"

type Tab = "adapters" | "voice"

const TABS: Array<{ id: Tab; label: string; subtitle: string }> = [
  { id: "adapters", label: "Adapter Changelog", subtitle: "history + status" },
  { id: "voice", label: "Voice Imprinting", subtitle: "exp #193 · capability vs tuning" },
]

function summarizeMetrics(m: Record<string, any> | null): string {
  if (!m) return "—"
  const parts: string[] = []
  if (m.accuracy != null) parts.push(`acc ${(m.accuracy * 100).toFixed(0)}%`)
  if (m.precision != null && m.recall != null) parts.push(`P/R ${(m.precision * 100).toFixed(0)}/${(m.recall * 100).toFixed(0)}`)
  if (m.f1 != null) parts.push(`F1 ${m.f1.toFixed(2)}`)
  if (m.latency_ms != null) parts.push(`${m.latency_ms}ms`)
  if (m.delta_sum != null) parts.push(`Δsum ${m.delta_sum.toFixed(3)}`)
  if (m.max_jaccard != null) parts.push(`maxJ ${m.max_jaccard.toFixed(3)}`)
  return parts.length ? parts.join(" · ") : "—"
}

function DeployedSlate() {
  const [adapters, setAdapters] = useState<Adapter[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listAdapters().then(setAdapters).catch(err => setError(String(err)))
  }, [])

  if (error) return <p style={{ color: "#c95" }}>Failed to load adapters: {error}</p>
  if (!adapters) return <p style={{ color: "#888" }}>Loading adapters…</p>

  const deployed = adapters.filter(a => a.status === "deployed")
  const candidates = adapters.filter(a => a.status === "candidate")

  return (
    <>
      <table className="guide-table">
        <thead>
          <tr><th>Adapter</th><th>Slot</th><th>Headline metrics</th><th>Provenance</th></tr>
        </thead>
        <tbody>
          {deployed.map(a => {
            const exps = [
              a.trainingExperimentId ? `train #${a.trainingExperimentId}` : null,
              a.evalExperimentIds.length ? `eval [${a.evalExperimentIds.join(",")}]` : null,
            ].filter(Boolean).join(" · ")
            return (
              <tr key={a.uri}>
                <td><strong>{a.name}</strong></td>
                <td style={{ color: "#aaa" }}>{a.slot ?? "—"}</td>
                <td>{summarizeMetrics(a.headlineMetrics)}</td>
                <td style={{ color: "#888", fontSize: "0.82rem" }}>{exps || "—"}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {candidates.length > 0 && (
        <>
          <h3 style={{ marginTop: 18, marginBottom: 8, fontSize: "0.9rem", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.04em" }}>Candidates — not wired in</h3>
          <table className="guide-table">
            <thead>
              <tr><th>Adapter</th><th>Slot</th><th>Headline metrics</th><th>Provenance</th></tr>
            </thead>
            <tbody>
              {candidates.map(a => {
                const exps = [
                  a.trainingExperimentId ? `train #${a.trainingExperimentId}` : null,
                  a.evalExperimentIds.length ? `eval [${a.evalExperimentIds.join(",")}]` : null,
                ].filter(Boolean).join(" · ")
                return (
                  <tr key={a.uri}>
                    <td>{a.name}</td>
                    <td style={{ color: "#aaa" }}>{a.slot ?? "—"}</td>
                    <td>{summarizeMetrics(a.headlineMetrics)}</td>
                    <td style={{ color: "#888", fontSize: "0.82rem" }}>{exps || "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

export function FinetunePage() {
  const [tab, setTab] = useState<Tab>("adapters")
  const [showArchive, setShowArchive] = useState(false)

  return (
    <div className="finetune-page">
      {/* ── Pinned: current fine-tune agents status ─────────────── */}
      <div className="finetune-header" style={{ marginBottom: 16 }}>
        <section>
          <h2 style={{ marginTop: 0 }}>Current fine-tune agents</h2>
          <DeployedSlate />
        </section>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div className="finetune-tab-bar" style={{ marginBottom: 18 }}>
        <div className="studio-mode-toggle guide-mode-toggle" style={{ flexWrap: "wrap", gap: 6 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "8px 14px", lineHeight: 1.2 }}
            >
              <span style={{ fontWeight: 600 }}>{t.label}</span>
              <span style={{ fontSize: "0.7rem", opacity: 0.7, marginTop: 2 }}>{t.subtitle}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "adapters" && <AdaptersPage />}
      {tab === "voice" && <VoiceComparePage />}

      {/* ── Archive (collapsed) ─────────────────────────────────── */}
      <div style={{ marginTop: 40, borderTop: "1px solid #2a2e3c", paddingTop: 18 }}>
        <button
          onClick={() => setShowArchive(v => !v)}
          style={{
            background: "transparent",
            border: "1px solid #2a2e3c",
            color: "#888",
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: "0.78rem",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {showArchive ? "▾ Hide" : "▸ Show"} archive · retired artifacts
        </button>
        {showArchive && (
          <div style={{ marginTop: 18 }}>
            <div className="finetune-header">
              <section>
                <h3 style={{ marginTop: 0, color: "#aaa" }}>Tonal pass (retired)</h3>
                <p style={{ color: "#aaa" }}>
                  The tonal pass was a LoRA-tuned 14B model that rewrote each paragraph for voice
                  consistency. V4 (<code>howard-tonal-v4-sft-resume:v8</code>) beat V3 on every metric —
                  classifier 0.550 vs 0.422, perplexity 3086 vs 4814, 3× faster latency.
                </p>
                <p style={{ color: "#aaa" }}>
                  <strong>Auto-run retired 2026-04-16.</strong> Voice now lands at generation time via
                  per-genre voice LoRAs wired through <code>WRITER_GENRE_PACKS</code> in
                  <code>src/models/roles.ts</code> (fantasy seeds → salvatore-1988-v3). Howard primer
                  methodology was deprecated the same day: voice transfers via weights, not few-shot
                  prompts. The V4 adapter is retained on W&B Inference and invokable via
                  <code>POST /api/novel/:id/tonal-pass</code> for on-demand comparison on existing novels.
                </p>
              </section>
            </div>
            <LoraComparePage />
          </div>
        )}
      </div>
    </div>
  )
}
