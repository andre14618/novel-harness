import { Link } from "react-router-dom"

export function GuidePage() {
  const qs = window.location.search
  return (
    <>
      <h1>Overview</h1>

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
            Deterministic checks verify the prose executes the plan faithfully. Fine-tuned 9B models
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
├── Fine-Tuning (W&B Inference)
│   └── OpenPipe/Qwen3-14B-Instruct LoRA adapters
│       ├── tonal-pass v4 (trained, W&B) / v3 (live, Together AI)
│       ├── adherence-checker (4-call decomposed shipped; SFT deferred)
│       ├── chapter-plan-checker (SFT next; gpt-oss-120b teacher)
│       ├── continuity (blocked — no reliable teacher yet)
│       └── reference-resolver (removed; 14B already 97.5% recall)
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
                    <br /><em>Adherence Checker</em> validates the beat was executed (deterministic + 4-call LLM check: events / setting / tangent / character). Retries on failure.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Chapter Plan Check</strong> — Assembled chapter prose is validated against
                    the full chapter plan: all beats represented, characters present, emotional arc intact,
                    no unplanned events. Retries the chapter if structural deviations found.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Continuity Check</strong> — Flags inconsistencies with established facts and character states.
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
                    are saved to DB tables. Optionally, LLM extractors also run for verification.
                    Configurable via <code>pipeline.extractionMode</code> (plan, extract, or both).
                  </div>
                </div>
                <p className="flow-agents">Agents: reference-resolver, beat-writer, adherence-checker,
                   chapter-plan-checker, continuity, lint-fixer</p>
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
                <p>All novel data in Postgres. Chapter prose also saved to <code>output/novel-*/chapter-*.md</code>.</p>
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
              <h3><Link to={`/${qs}`}>Novels</Link></h3>
              <p>Start a new novel with custom input or a seed file. View, resume, or archive existing novels.</p>
            </div>
            <div className="card">
              <h3>Pipeline View</h3>
              <p>Real-time timeline of a novel run. Every LLM call shows tokens, latency, cost.
                 Gate panels appear inline for approval decisions.</p>
            </div>
            <div className="card">
              <h3><Link to={`/config${qs}`}>Config</Link></h3>
              <p>Three tabs: <strong>Models</strong> (per-agent model selection), <strong>Context</strong> (retrieval
                 parameter tuning — similarity thresholds, RRF K, boosts, limits), and <strong>Causal</strong> (deterministic
                 link scoring weights and thresholds).</p>
            </div>
            <div className="card">
              <h3><Link to={`/experiments${qs}`}>Experiments</Link></h3>
              <p>Unified view of all benchmark runs and improvement cycles. Scores, cost,
                 iterations, conclusions, and cross-experiment lineage.</p>
            </div>
            <div className="card">
              <h3><Link to={`/operations${qs}`}>Operations</Link></h3>
              <p>Run benchmarks and improvement cycles. Start the daemon with target/dimension locking.
                 Batch status monitoring.</p>
            </div>
            <div className="card">
              <h3><Link to={`/models${qs}`}>Models</Link></h3>
              <p>Searchable model registry with pricing, specs, and provider info for all available models.</p>
            </div>
            <div className="card">
              <h3><Link to={`/docs${qs}`}>Docs</Link></h3>
              <p>Browse project documentation — lessons learned, AI-tell research, LoRA style transfer report,
                 world knowledge graph, and more.</p>
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
                <td>Deterministic (character presence, word count, dialogue) + LLM verification</td>
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
                <td>LLM check against world state tables</td>
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
                <td>LoRA-tuned 14B model (per-paragraph rewrite). V4 on W&B Inference validated; V3 on Together AI still live pending switchover.</td>
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
            (especially per-call decomposition) before committing to SFT — exp #122 closed half the adherence-checker
            gap with a prompt change alone.
          </p>
          <table className="guide-table">
            <thead>
              <tr><th>Fine-Tune Target</th><th>Task</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr><td>Tonal Pass</td><td>Per-paragraph style rewriting</td><td>V4 trained &amp; validated on W&B Inference; V3 (Together AI) still live pending switchover</td></tr>
              <tr><td>Chapter Plan Checker</td><td>Plan vs assembled prose (pass/fail)</td><td>SFT next — gpt-oss-120b teacher validated (90%); per-beat decomposition disconfirmed (regression)</td></tr>
              <tr><td>Adherence Checker</td><td>Beat spec vs prose (pass/fail)</td><td>4-call decomposed prompt shipped in production — SFT deferred pending validation at scale</td></tr>
              <tr><td>Continuity</td><td>Consistency with world state</td><td>Blocked — no reliable teacher (235B misses 90% of warnings)</td></tr>
              <tr><td>Reference Resolver</td><td>Identify needed DB lookups from beat</td><td>Removed from roadmap — 14B already at 97.5% recall, no deficit to train against</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Autoresearcher</h2>
          <p>
            Autonomous improvement loop: diagnose weakest quality signal → propose change → test → keep or revert.
            Focused on deterministic quality signals — adherence pass rates, plan check rates, lint counts,
            extraction precision/recall.
          </p>

          <h3>Optimization Surfaces</h3>
          <table className="guide-table">
            <thead>
              <tr><th>Surface</th><th>Count</th><th>What Changes</th><th>Measured By</th></tr>
            </thead>
            <tbody>
              <tr><td>Agent prompts</td><td>12</td><td>Planning, writing, checking, extraction agents</td><td>Adherence/plan check pass rates</td></tr>
              <tr><td>Generation parameters</td><td>8</td><td>Temperature, max tokens per agent</td><td>Output quality metrics</td></tr>
              <tr><td>Deterministic config</td><td>6</td><td>Causal link scoring weights and thresholds</td><td>Graph accuracy</td></tr>
              <tr><td>Context format templates</td><td>6</td><td>How facts/events/states render in context</td><td>Writer adherence</td></tr>
              <tr><td>Model assignments</td><td>3</td><td>Which model runs each agent role</td><td>Visible in registry, not daemon-tunable</td></tr>
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
            (neutral → stylized) pairs. This works because LLMs are better at removing style than
            adding it — the neutral versions are high quality, and the stylized versions are real
            source prose. Training runs via W&B Serverless SFT (ART framework); adapters are served
            via W&B Inference at $0.05/$0.22 per 1M tokens.
          </p>
          <p>
            V4 (howard-tonal-v4-sft-resume:v8) beats V3 on every metric — classifier 0.550 vs 0.422,
            perplexity 3086 vs 4814, 3× faster latency. V3 on Together AI remains live pending the switchover.
          </p>
          <p>
            See the full research report in <Link to={`/docs${qs}${qs ? "&" : "?"}doc=lora-style-transfer-report.md`}>Docs</Link> for
            methodology, training results, and next steps.
          </p>
        </section>

        <section>
          <h2>Cost Management</h2>
          <p>
            Every LLM call tracks cost via registry pricing. The beat-first architecture reduces
            per-chapter costs by using cheap 8B/9B models for high-frequency checks and reserving
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
    </>
  )
}
