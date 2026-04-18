import { useState } from "react"
import { LoraComparePage } from "./LoraComparePage"
import { AdaptersPage } from "./AdaptersPage"
import { VoiceComparePage } from "./VoiceComparePage"

type Tab = "adapters" | "voice"

const TABS: Array<{ id: Tab; label: string; subtitle: string }> = [
  { id: "adapters", label: "Adapter Changelog", subtitle: "history + status" },
  { id: "voice", label: "Voice Imprinting", subtitle: "exp #193 · capability vs tuning" },
]

export function FinetunePage() {
  const [tab, setTab] = useState<Tab>("adapters")
  const [showArchive, setShowArchive] = useState(false)

  return (
    <div className="finetune-page">
      {/* ── Pinned: current fine-tune agents status ─────────────── */}
      <div className="finetune-header" style={{ marginBottom: 16 }}>
        <section>
          <h2 style={{ marginTop: 0 }}>Current fine-tune agents</h2>
          <table className="guide-table">
            <thead>
              <tr><th>Adapter</th><th>Task</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr><td>Adherence Checker</td><td>Beat spec vs prose (events+attribution)</td><td><strong>V4 deployed</strong> — 2,134 Sonnet-labeled pairs, 79% first-attempt pass (exp #161)</td></tr>
              <tr><td>Chapter Plan Checker</td><td>Cross-beat coherence (pass/fail)</td><td><strong>V2 deployed</strong> — 520 pairs, 96% accuracy, 609ms (exp #178)</td></tr>
              <tr><td>Continuity</td><td>Consistency with world state</td><td><strong>V2 deployed</strong> — 253 pairs, 12x cost reduction from 235B (exp #175)</td></tr>
              <tr><td>Tonal Pass (auto)</td><td>Per-paragraph style rewriting</td><td style={{ color: "#888" }}><em>Retired 2026-04-16</em> — voice now lands at generation time via per-genre voice LoRAs (e.g. salvatore-1988-v3 for fantasy). On-demand <code>POST /api/novel/:id/tonal-pass</code> still works.</td></tr>
            </tbody>
          </table>
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
