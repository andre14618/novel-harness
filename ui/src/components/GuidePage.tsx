import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { marked } from "marked"
import { listDocs, getDoc, type DocEntry } from "../api"
import { ComparePage } from "./ComparePage"

marked.setOptions({ breaks: true, gfm: true })

type GuideTab = "overview" | "docs" | "compare"

export function GuidePage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const tab = (searchParams.get("tab") ?? "overview") as GuideTab
  const key = searchParams.get("key")
  const qs = key ? `?key=${key}` : ""

  // Docs tab state
  const [docsList, setDocsList] = useState<DocEntry[]>([])
  const [activeDoc, setActiveDoc] = useState<string | null>(null)
  const [docContent, setDocContent] = useState("")

  function switchTab(t: GuideTab) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (t === "overview") next.delete("tab")
      else next.set("tab", t)
      // Remove doc param when leaving docs tab
      if (t !== "docs") next.delete("doc")
      return next
    }, { replace: true })
  }

  // Load docs list on first switch to docs tab
  useEffect(() => {
    if (tab !== "docs" || docsList.length > 0) return
    listDocs()
      .then(r => {
        setDocsList(r.docs)
        const docParam = searchParams.get("doc")
        const initial = docParam && r.docs.some(d => d.filename === docParam)
          ? docParam
          : r.docs[0]?.filename ?? null
        setActiveDoc(initial)
      })
      .catch(() => {})
  }, [tab])

  // Load doc content when active doc changes
  useEffect(() => {
    if (!activeDoc) return
    setDocContent("")
    getDoc(activeDoc)
      .then(r => setDocContent(r.content))
      .catch(() => setDocContent("Error loading document."))
  }, [activeDoc])

  return (
    <>
      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div className="guide-tab-bar">
        <div className="studio-mode-toggle guide-mode-toggle">
          {(["overview", "docs", "compare"] as GuideTab[]).map(t => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => switchTab(t)}
            >
              {t === "overview" ? "Overview" : t === "docs" ? "Docs" : "Compare"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Overview ────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="guide-content">
          <section>
            <h2>What This Does</h2>
            <p>
              Novel Harness creates novels (3-30 chapters) using a beat-first pipeline of LLM agents.
              You provide a premise, genre, and characters. The system builds a world, plots the story
              with detailed scene beats and world state tracking, writes each beat with tight adherence
              checking, and validates consistency — all with your review at each step.
            </p>
            <p>
              Quality comes from the plan, not from post-hoc analysis. The planning phase outputs
              specific beats plus world state updates (facts, character states, knowledge changes).
              Deterministic checks verify the prose executes the plan faithfully. Fine-tuned 14B models
              handle high-frequency mechanical checks at low cost.
            </p>
          </section>

          <section>
            <h2>Architecture</h2>
            <pre className="guide-arch">{`
LXC 307 (192.168.1.108)
├── Orchestrator (port 3006)
│   ├── /app                     React UI
│   └── /api/*                   REST + SSE endpoints
│
├── Postgres DB (novel_harness_orchestrator)
│   ├── Novel Data
│   │   ├── novels, world_bibles, characters, story_spines
│   │   ├── chapter_outlines (beats + world state updates)
│   │   ├── chapter_drafts, chapter_summaries
│   │   ├── facts, character_states, issues, validation_passes
│   │   └── world_systems, cultures, character_cultures
│   │
│   ├── Knowledge Graph
│   │   ├── relationship_states (per-chapter snapshots → arcs)
│   │   ├── timeline_events (with causal chains)
│   │   ├── character_knowledge (with propagation tracking)
│   │   ├── event_causes (cause → effect graph)
│   │   ├── knowledge_propagation (who told whom)
│   │   └── deterministic_config (causal tuning parameters)
│   │
│   └── Operations
│       ├── runs, llm_calls, tuning_experiments, scores
│       ├── improvement_cycles, improvement_iterations
│       ├── experiment_lineage, lint_patterns
│       └── batches, batch_requests
│
└── Fine-Tuning (W&B Inference)
    └── OpenPipe/Qwen3-14B-Instruct LoRA adapters
        ├── tonal-pass v4 (deployed — pref eval confirmed 2026-04-11)
        ├── adherence-checker v4 (deployed — events+attribution, 2134 Sonnet-labeled pairs)
        ├── chapter-plan-checker v2 (deployed — 96% accuracy, 609ms, exp #178)
        └── continuity v2 (deployed — 253 pairs, 12x cost reduction, exp #175)
          `.trim()}</pre>
          </section>

          <section>
            <h2>Novel Creation Flow</h2>
            <div className="flow-diagram">
              <div className="flow-step">
                <div className="flow-num">1</div>
                <div>
                  <strong>Concept Phase</strong>
                  <p><em>World Builder</em> creates setting, rules, locations, world systems, and cultures.
                     <em>Character Agent</em> expands sketches into full profiles with cultural ties and system awareness.
                     <em>Plotter</em> creates the story spine — conflict, theme, and act structure.</p>
                  <p className="flow-agents">Agents: world-builder → character-agent + plotter (parallel)</p>
                  <p className="flow-gate">You review and approve/revise/reject each output.</p>
                </div>
              </div>

              <div className="flow-arrow">|</div>

              <div className="flow-step">
                <div className="flow-num">2</div>
                <div>
                  <strong>Planning Phase</strong>
                  <p><em>Planning Plotter</em> creates chapter-by-chapter outlines with scene beats,
                     POV characters, emotional arcs, target word counts, and <strong>world state updates</strong> —
                     facts established, character state changes, and knowledge transfers per chapter.</p>
                  <p className="flow-agents">Agent: planning-plotter</p>
                  <p className="flow-gate">You review the complete outline before drafting begins.</p>
                </div>
              </div>

              <div className="flow-arrow">|</div>

              <div className="flow-step">
                <div className="flow-num">3</div>
                <div>
                  <strong>Drafting Phase (per chapter)</strong>
                  <p>Each chapter is written beat-by-beat with tight validation:</p>
                  <div className="flow-sub">
                    <div className="flow-sub-step">
                      <strong>Per-Beat Writing Loop</strong> — For each scene beat:
                      <br /><em>Reference Resolver</em> identifies implicit references and does deterministic DB lookups.
                      <br /><em>Beat Writer</em> generates ~300-500 words of prose from the beat spec + resolved context.
                      <br /><em>Adherence Checker</em> validates the beat was executed (deterministic + single LLM call for events+attribution). Targeted rewrite on failure.
                    </div>
                    <div className="flow-sub-arrow">↓</div>
                    <div className="flow-sub-step">
                      <strong>Chapter Plan Check</strong> — Assembled chapter prose is validated against
                      the full chapter plan: setting coherence, emotional arc direction, major plot contradictions.
                      Retries the chapter if structural deviations found.
                    </div>
                    <div className="flow-sub-arrow">↓</div>
                    <div className="flow-sub-step">
                      <strong>Continuity Check</strong> — Two parallel calls (facts + state) flag inconsistencies
                      with established world-state facts and character states.
                    </div>
                    <div className="flow-sub-arrow">↓</div>
                    <div className="flow-sub-step">
                      <strong>Lint + Fix</strong> — 26 deterministic patterns flag AI tells (cliches, hedging,
                      emotional echo, rhythm homogeneity). LLM-powered fixes applied per pattern.
                    </div>
                    <div className="flow-sub-arrow">↓</div>
                    <div className="flow-sub-step">
                      <strong>Gate</strong> — You approve, revise, or reject.
                    </div>
                    <div className="flow-sub-arrow">↓</div>
                    <div className="flow-sub-step">
                      <strong>State Save</strong> — Planner's world state updates (facts, character states, knowledge)
                      written to DB tables after chapter approval.
                    </div>
                  </div>
                  <p className="flow-agents">Agents: reference-resolver, beat-writer, adherence-events,
                     chapter-plan-checker, continuity-facts, continuity-state, lint-fixer</p>
                </div>
              </div>

              <div className="flow-arrow">|</div>

              <div className="flow-step">
                <div className="flow-num">4</div>
                <div>
                  <strong>Validation Phase</strong>
                  <p>Deterministic consistency checks across all chapters. Issues trigger automatic
                     rewrites via <em>Rewriter</em>. Up to 3 passes until convergence.
                     <em>Tonal Pass</em> applies voice styling after all issues are resolved.</p>
                  <p className="flow-agents">Agents: rewriter, tonal-pass</p>
                </div>
              </div>

              <div className="flow-arrow">|</div>

              <div className="flow-step done">
                <div className="flow-num">5</div>
                <div>
                  <strong>Done</strong>
                  <p>All novel data in Postgres. Chapter prose readable via the Studio.</p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2>Beat-Level Context</h2>
            <pre className="guide-arch">{`
Beat Specification (from planner)
         │
         ├─→ Reference Resolver (deterministic + LLM)
         │   ├── Check for implicit markers ("their last", "consequences of")
         │   ├── LLM identifies needed lookups (cheap 8B model)
         │   └── Execute DB queries (recent events, relationships, knowledge)
         │
         ▼
   ┌─────────────────────────────────────────────────┐
   │           Beat Context (~500-1K tokens)         │
   │                                                 │
   │  Beat spec (description, characters, shift)     │
   │  Transition bridge (last 2-3 sentences)         │
   │  Landing target (next beat first sentence)      │
   │  Character snapshots (speech, state, relations) │
   │  Resolved references (from DB lookups)          │
   │  Setting (on beat 0 or location change)         │
   └─────────────────────────────────────────────────┘
         │
         ▼
   Beat Writer generates ~300-500 words
         │
         ▼
   Adherence Checker (pass/fail + specific issues)
          `.trim()}</pre>
            <p>
              Beat-level context replaces the semantic retrieval engine. Instead of assembling ~8.5K tokens
              via vector search, each beat gets ~500-1K tokens of tight, specific context derived from the
              plan and deterministic DB lookups. No embeddings needed.
            </p>
          </section>

          <section>
            <h2>Pages</h2>
            <div className="guide-cards">
              <div className="card">
                <h3><Link to={`/config${qs}`}>Config</Link></h3>
                <p>Per-agent model selection with temperature tuning. Changes take effect immediately.</p>
              </div>
              <div className="card">
                <h3><Link to={`/llm-calls${qs}`}>Inspector</Link></h3>
                <p>Every LLM call across the pipeline. Filter by novel/agent/chapter/beat, click to see full prompts and responses.</p>
              </div>
              <div className="card">
                <h3><Link to={`/costs${qs}`}>Costs</Link></h3>
                <p>Cost analytics by agent, provider, phase, novel, and day.</p>
              </div>
              <div className="card">
                <h3><Link to={`/experiments${qs}`}>Experiments</Link></h3>
                <p>Unified view of all tuning experiments. Scores, cost,
                   iterations, conclusions, and cross-experiment lineage.</p>
              </div>
              <div className="card">
                <h3><Link to={`/models${qs}`}>Models</Link></h3>
                <p>Searchable model registry with pricing, specs, and provider info for all available models.</p>
              </div>
              <div className="card">
                <h3><Link to={`/finetune${qs}`}>Fine-tuning</Link></h3>
                <p>Adapter changelog and LoRA comparison tool.</p>
              </div>
              <div className="card">
                <h3><button className="card-tab-link" onClick={() => switchTab("docs")}>Docs</button></h3>
                <p>Browse project documentation — lessons learned, AI-tell research, LoRA style transfer report,
                   context engineering, and more.</p>
              </div>
              <div className="card">
                <h3><button className="card-tab-link" onClick={() => switchTab("compare")}>Compare</button></h3>
                <p>Side-by-side beat and prose comparison across novel runs.</p>
              </div>
            </div>
          </section>

          <section>
            <h2>Quality Measurement</h2>
            <p>
              Quality is measured through structured checks, not LLM scoring. Each check produces
              pass/fail with specific actionable issues — no 1-10 scores.
            </p>
            <table className="guide-table">
              <thead>
                <tr><th>Check</th><th>What It Measures</th><th>Method</th><th>Runs When</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Adherence</strong></td>
                  <td>Beat execution fidelity</td>
                  <td>Deterministic (character presence, word count) + single LLM call (events+attribution)</td>
                  <td>Per beat</td>
                </tr>
                <tr>
                  <td><strong>Chapter Plan</strong></td>
                  <td>Structural coherence against plan</td>
                  <td>LLM comparison: prose vs plan (pass/fail + deviations)</td>
                  <td>Per chapter</td>
                </tr>
                <tr>
                  <td><strong>Continuity</strong></td>
                  <td>Consistency with established facts</td>
                  <td>2 parallel LLM calls (facts + character state) against world state tables</td>
                  <td>Per chapter</td>
                </tr>
                <tr>
                  <td><strong>Lint</strong></td>
                  <td>AI prose patterns</td>
                  <td>26 deterministic patterns (cliches, hedging, emotional echo, rhythm)</td>
                  <td>Per chapter</td>
                </tr>
                <tr>
                  <td><strong>Tonal Pass</strong></td>
                  <td>Voice consistency</td>
                  <td>V4 LoRA-tuned 14B (W&B Inference, <code>howard-tonal-v4-sft-resume:v8</code>). Pref eval confirmed 2026-04-11.</td>
                  <td>Post-validation</td>
                </tr>
              </tbody>
            </table>
            <p style={{ marginTop: "0.5rem", opacity: 0.7, fontSize: "0.9em" }}>
              <strong>Archived</strong>: LLM judge scoring (prose penalties, extraction scores, planning scores, pairwise comparison,
              context quality benchmark) — removed due to poor discrimination (0-33%) and lack of corrective feedback path.
            </p>
          </section>

          <section>
            <h2>Fine-Tuning Pipeline</h2>
            <p>
              High-frequency mechanical agents are fine-tuned on <strong>OpenPipe/Qwen3-14B-Instruct</strong> via
              W&B Serverless SFT (ART framework, free during public preview) + W&B Inference ($0.05/$0.22 per 1M tokens).
              Training data is built from knowledge distillation: base model extracts, human reviews and corrects
              with Claude Code, corrected outputs become training data. Always exhaust prompt-engineering wins
              (especially per-call decomposition) before committing to SFT.
            </p>
            <table className="guide-table">
              <thead>
                <tr><th>Fine-Tune Target</th><th>Task</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr><td>Adherence Checker</td><td>Beat spec vs prose (events+attribution)</td><td><strong>V4 deployed</strong> — 2,134 Sonnet-labeled pairs, 79% first-attempt pass (exp #161)</td></tr>
                <tr><td>Tonal Pass</td><td>Per-paragraph style rewriting</td><td><strong>V4 deployed</strong> — pref eval confirmed 2026-04-11 (exp #98); V3 Together AI retired</td></tr>
                <tr><td>Chapter Plan Checker</td><td>Cross-beat coherence (pass/fail)</td><td><strong>V2 deployed</strong> — 520 pairs, Sonnet teacher, 96% accuracy, 609ms (exp #178)</td></tr>
                <tr><td>Continuity</td><td>Consistency with world state</td><td><strong>V2 deployed</strong> — 253 pairs, Sonnet teacher, 12x cost reduction from 235B (exp #175)</td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2>LoRA Style Transfer</h2>
            <p>
              Standard LLM prose carries a recognizable "AI voice" even after deterministic lint fixes.
              The tonal pass uses a LoRA-tuned 14B model (Qwen3-14B-Instruct) to rewrite each paragraph for voice
              consistency — short punchy sentences, concrete sensory detail, minimal adjectives — while
              preserving all factual content and dialogue verbatim.
            </p>
            <p>
              The training pipeline uses <strong>back-translation</strong>: start with ground-truth stylized
              text, use a large LLM to produce neutral/flattened versions, then train the LoRA on
              (neutral → stylized) pairs. Training runs via W&B Serverless SFT (ART framework); adapters served
              via W&B Inference at $0.05/$0.22 per 1M tokens.
            </p>
            <p>
              V4 (<code>howard-tonal-v4-sft-resume:v8</code>) beats V3 on every metric — classifier 0.550 vs 0.422,
              perplexity 3086 vs 4814, 3× faster latency. Pref eval confirmed V4 preferred (2026-04-11).
              V3 on Together AI retired.
            </p>
            <p>
              See the full research report in <button className="card-tab-link" onClick={() => switchTab("docs")}>Docs → LoRA Style Transfer Report</button>.
            </p>
          </section>

          <section>
            <h2>Cost Management</h2>
            <p>
              Every LLM call tracks cost via registry pricing. The beat-first architecture reduces
              per-chapter costs by using cheap 14B models for high-frequency checks and reserving
              large models for writing only. Primary cost levers:
            </p>
            <table className="guide-table">
              <thead>
                <tr><th>Lever</th><th>Discount</th><th>How</th></tr>
              </thead>
              <tbody>
                <tr><td>Batch API</td><td>50% off</td><td>Queues requests, async 24h turnaround</td></tr>
                <tr><td>DeepSeek cache</td><td>95% off input</td><td>Automatic prefix caching</td></tr>
                <tr><td>OpenAI cache</td><td>90% off input</td><td>Automatic prefix caching (1024+ tokens)</td></tr>
                <tr><td>Groq cache</td><td>50% off input</td><td>Automatic prefix caching</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/* ── Docs ────────────────────────────────────────────────── */}
      {tab === "docs" && (
        <div className="docs-layout">
          <aside className="docs-sidebar">
            <h3>Docs</h3>
            {docsList.length === 0
              ? <p style={{ padding: "4px 0", color: "var(--text-tertiary)", fontSize: "0.78rem" }}>Loading…</p>
              : docsList.map(d => (
                  <button
                    key={d.filename}
                    className={`docs-item ${activeDoc === d.filename ? "active" : ""}`}
                    onClick={() => setActiveDoc(d.filename)}
                  >
                    <span className="docs-drag-handle" />
                    <span className="docs-item-title">{d.title}</span>
                  </button>
                ))
            }
          </aside>
          <main className="docs-content">
            {docContent
              ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: marked.parse(docContent) as string }} />
              : <p style={{ color: "var(--text-tertiary)" }}>Select a document</p>
            }
          </main>
        </div>
      )}

      {/* ── Compare ─────────────────────────────────────────────── */}
      {tab === "compare" && <ComparePage />}
    </>
  )
}
