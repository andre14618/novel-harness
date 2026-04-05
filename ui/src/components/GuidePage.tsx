import { Link } from "react-router-dom"

export function GuidePage() {
  const qs = window.location.search
  return (
    <>
      <h1>Guide</h1>

      <div className="guide-content">
        <section>
          <h2>What This Does</h2>
          <p>
            Novel Harness creates novels (3-30 chapters) using a pipeline of LLM agents with
            semantic context retrieval. You provide a premise, genre, and characters. The system
            builds a world, plots the story, writes each chapter with semantically retrieved context,
            and validates consistency — all with your review at each step.
          </p>
          <p>
            It's also a context engineering and benchmarking platform. The semantic retrieval engine
            uses pgvector hybrid search to assemble the right context for each scene. An autonomous
            improvement daemon iteratively tunes retrieval parameters, prompts, and context assembly
            using focused judge suites.
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
│   │   ├── chapter_outlines, chapter_drafts, chapter_summaries
│   │   ├── facts, character_states, issues, validation_passes
│   │   └── world_systems, cultures, character_cultures
│   │
│   ├── Knowledge Graph
│   │   ├── relationship_states (per-chapter snapshots → arcs)
│   │   ├── timeline_events (with causal chains)
│   │   ├── character_knowledge (with propagation tracking)
│   │   ├── event_causes (cause → effect graph)
│   │   ├── knowledge_propagation (who told whom)
│   │   └── thematic_tags (cross-chapter themes)
│   │
│   ├── Vector Search (pgvector)
│   │   ├── embedding vector(3072) on 6 tables
│   │   ├── HNSW indexes (halfvec cosine)
│   │   ├── tsvector + GIN full-text indexes
│   │   └── retrieval_config (tunable parameters)
│   │
│   └── Operations
│       ├── runs, llm_calls, tuning_experiments, scores
│       ├── improvement_cycles, improvement_iterations
│       ├── experiment_lineage, lint_patterns
│       └── batches, batch_requests
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
                <p><em>Planning Plotter</em> creates chapter-by-chapter outlines with scenes,
                   POV characters, emotional arcs, and target word counts.</p>
                <p className="flow-agents">Agent: planning-plotter</p>
                <p className="flow-gate">You review the complete outline before drafting begins.</p>
              </div>
            </div>

            <div className="flow-arrow">|</div>

            <div className="flow-step">
              <div className="flow-num">3</div>
              <div>
                <strong>Drafting Phase (per chapter)</strong>
                <p>Each chapter follows this pipeline:</p>
                <div className="flow-sub">
                  <div className="flow-sub-step">
                    <strong>Context Assembly</strong> — Hybrid RRF search (vector + keyword) retrieves
                    relevant facts, events, summaries, relationship arcs, knowledge state, and causal chains
                    from the entire novel. Fixed skeleton (scene setup, POV, character profiles, craft reminders)
                    + dynamic sections weighted by scene relevance.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Writer</strong> — Generates prose from the assembled context.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Lint + Fix</strong> — Deterministic pattern flagging + LLM-powered fixes.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Continuity Check</strong> — Flags inconsistencies with established facts.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Gate</strong> — You approve, revise, or reject.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Extraction</strong> — 4 agents in parallel: summary, facts, character state,
                    relationships + timeline + knowledge.
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Embedding</strong> — Batch embed all extracted data (text-embedding-3-large via OpenRouter).
                  </div>
                  <div className="flow-sub-arrow">↓</div>
                  <div className="flow-sub-step">
                    <strong>Graph Linker</strong> — Identifies causal chains, knowledge propagation, and thematic tags.
                  </div>
                </div>
                <p className="flow-agents">Agents: writer, continuity, summary-extractor, fact-extractor,
                   character-state, relationship-timeline, graph-linker</p>
              </div>
            </div>

            <div className="flow-arrow">|</div>

            <div className="flow-step">
              <div className="flow-num">4</div>
              <div>
                <strong>Validation Phase</strong>
                <p>Multi-pass cross-chapter consistency + prose quality checks.
                   <em>Rewriter</em> fixes issues automatically. Up to 3 passes until convergence.</p>
                <p className="flow-agents">Agents: cross-chapter-continuity, prose-quality, rewriter</p>
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
          <h2>Semantic Context Engine</h2>
          <pre className="guide-arch">{`
Scene Outline + POV Character
         │
         ├─→ Embed scene query (text-embedding-3-large)
         │
         ▼
   ┌─────────────────────────────────────────────────┐
   │           Hybrid RRF Search (per table)         │
   │                                                 │
   │  Semantic leg:  embedding <=> query (HNSW)      │
   │  Keyword leg:   tsv @@ websearch_to_tsquery     │
   │  Fusion:        1/(K + sem_rank) + 1/(K + kw)   │
   │  Boost:         characters ×2, location ×1.5    │
   │  Decay:         2^(-chaptersAgo / halfLife)      │
   └─────────────────────────────────────────────────┘
         │
   ┌─────┼─────┬──────┬────────┬───────┬──────────┐
   │     │     │      │        │       │          │
 facts events summaries states rels  knowledge
 (40)  (15)    (8)     (10)   (10)    (15)
         │
         ▼
   Graph Queries (recursive CTEs)
   ├── Causal chains (event → caused → event)
   ├── Relationship arcs (full trajectory)
   ├── Knowledge graph (who knows what, from whom)
   └── Thematic threads (cross-chapter themes)
         │
         ▼
   Context Assembly
   ├── Fixed: scene setup, POV world view, characters, craft
   └── Dynamic: sections weighted by scene relevance
         │
         ▼
   Writer Agent receives assembled context
          `.trim()}</pre>
          <p>
            All retrieval parameters are tunable via the <Link to={`/context${qs}`}>Context</Link> page
            and optimizable by the improvement daemon. The <code>retrieval_config</code> table stores
            per-novel parameters: similarity thresholds, RRF K value, per-type result limits,
            character/location boost multipliers, and recency half-life.
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
              <p>Per-agent model selection grouped by role. Changes apply immediately.
                 "Save to File" writes to <code>models/roles.ts</code>.</p>
            </div>
            <div className="card">
              <h3><Link to={`/context${qs}`}>Context</Link></h3>
              <p>Retrieval parameter tuning. Adjust similarity thresholds, RRF K, per-type limits,
                 character/location boosts, and recency decay. View context quality scores.</p>
            </div>
            <div className="card">
              <h3><Link to={`/experiments${qs}`}>Experiments</Link></h3>
              <p>Unified view of all benchmark runs and improvement cycles. Scores, cost,
                 iterations, conclusions, and cross-experiment lineage.</p>
            </div>
            <div className="card">
              <h3><Link to={`/operations${qs}`}>Operations</Link></h3>
              <p>Run benchmarks and improvement cycles. Start the daemon with target/dimension locking.</p>
            </div>
          </div>
        </section>

        <section>
          <h2>Benchmark Suites</h2>
          <table className="guide-table">
            <thead>
              <tr><th>Suite</th><th>What It Measures</th><th>Dimensions</th><th>Judges</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Context</strong></td>
                <td>Retrieval quality for the writer</td>
                <td>Relevance, Completeness, Noise, Causal Depth, Knowledge Accuracy</td>
                <td>5 focused judges, each with diagnostic output</td>
              </tr>
              <tr>
                <td>Prose</td>
                <td>Writer output quality</td>
                <td>Telling, Dead Weight, Dialogue (penalty); Prose Craft, Character Voice, Sensory (score)</td>
                <td>6 judges (3 penalty + 3 quality)</td>
              </tr>
              <tr>
                <td>Planning</td>
                <td>Chapter outline quality</td>
                <td>Beat Specificity, Dialogue Cues, Emotional Arc, Five Commandments</td>
                <td>4-5 judges, 1-10 scale</td>
              </tr>
              <tr>
                <td>Extraction</td>
                <td>State extraction accuracy</td>
                <td>Completeness, Accuracy</td>
                <td>2 judges, 1-10 scale</td>
              </tr>
              <tr>
                <td>Continuity</td>
                <td>Cross-chapter consistency</td>
                <td>Issue Detection, Fix Quality</td>
                <td>2 judges, 1-10 scale</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Improvement Daemon</h2>
          <p>
            The daemon automates: diagnose weakest dimension → propose change → benchmark → keep or revert.
            Each judge produces <strong>actionable diagnostics</strong> that flow directly to the improver agent,
            which synthesizes all judge outputs and proposes specific parameter or prompt changes.
          </p>

          <h3>Optimization Surfaces</h3>
          <table className="guide-table">
            <thead>
              <tr><th>Surface</th><th>What Changes</th><th>Measured By</th></tr>
            </thead>
            <tbody>
              <tr><td>Retrieval parameters</td><td>similarity thresholds, RRF K, boosts, limits</td><td>Context quality</td></tr>
              <tr><td>Embedding templates</td><td>Text format per source type</td><td>Context quality (recall)</td></tr>
              <tr><td>Graph linker prompt</td><td>Causal link, knowledge propagation identification</td><td>Context quality (causal depth)</td></tr>
              <tr><td>Writer prompt</td><td>Prose generation instructions</td><td>Prose quality</td></tr>
              <tr><td>Scene query template</td><td>How outlines become search queries</td><td>Context quality (precision)</td></tr>
              <tr><td>Extraction prompts</td><td>Fact, summary, state, relationship extraction</td><td>Extraction + context quality</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Cost Management</h2>
          <p>
            Every LLM call tracks cost via registry pricing. Embedding costs are negligible
            (~$0.0003/chapter). The primary cost levers:
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
