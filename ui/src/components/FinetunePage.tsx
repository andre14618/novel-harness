import { useState } from "react"
import { LoraComparePage } from "./LoraComparePage"
import { AdaptersPage } from "./AdaptersPage"

type Tab = "adapters" | "lora"

export function FinetunePage() {
  const [tab, setTab] = useState<Tab>("adapters")

  return (
    <div className="finetune-page">
      {/* ── Overview header ─────────────────────────────────────── */}
      <div className="finetune-header">
        <section>
          <h2>Fine-Tuning Pipeline</h2>
          <p>
            High-frequency mechanical agents are fine-tuned on <strong>OpenPipe/Qwen3-14B-Instruct</strong> via
            W&B Serverless SFT (ART framework) + W&B Inference ($0.05/$0.22 per 1M tokens).
            Training data comes from knowledge distillation: base model extracts, human reviews with Claude Code,
            corrected outputs become SFT pairs. Prompt-engineering wins (especially per-call decomposition)
            are exhausted before committing to SFT.
          </p>
          <table className="guide-table">
            <thead>
              <tr><th>Adapter</th><th>Task</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr><td>Adherence Checker</td><td>Beat spec vs prose (events+attribution)</td><td><strong>V4 deployed</strong> — 2,134 Sonnet-labeled pairs, 79% first-attempt pass (exp #161)</td></tr>
              <tr><td>Tonal Pass</td><td>Per-paragraph style rewriting</td><td><strong>V4 deployed</strong> — pref eval confirmed 2026-04-11 (exp #98); V3 retired</td></tr>
              <tr><td>Chapter Plan Checker</td><td>Cross-beat coherence (pass/fail)</td><td><strong>V2 deployed</strong> — 520 pairs, 96% accuracy, 609ms (exp #178)</td></tr>
              <tr><td>Continuity</td><td>Consistency with world state</td><td><strong>V2 deployed</strong> — 253 pairs, 12x cost reduction from 235B (exp #175)</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>LoRA Style Transfer</h2>
          <p>
            The tonal pass uses a LoRA-tuned 14B model to rewrite each paragraph for voice
            consistency — short punchy sentences, concrete sensory detail, minimal adjectives — while
            preserving all factual content and dialogue verbatim.
          </p>
          <p>
            Training uses <strong>back-translation</strong>: start with ground-truth stylized
            text, use a large LLM to produce neutral/flattened versions, then train on
            (neutral → stylized) pairs. Adapters served via W&B Inference.
          </p>
          <p>
            V4 (<code>howard-tonal-v4-sft-resume:v8</code>) beats V3 on every metric — classifier 0.550 vs 0.422,
            perplexity 3086 vs 4814, 3x faster latency. See the Adapters changelog and LoRA Compare tab below.
          </p>
        </section>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div className="finetune-tab-bar">
        <div className="studio-mode-toggle guide-mode-toggle">
          {(["adapters", "lora"] as Tab[]).map(t => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t === "adapters" ? "Adapters" : "LoRA Compare"}
            </button>
          ))}
        </div>
      </div>

      {tab === "adapters" ? <AdaptersPage /> : <LoraComparePage />}
    </div>
  )
}
