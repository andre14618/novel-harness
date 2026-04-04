import { Link } from "react-router-dom"

export function GuidePage() {
  return (
    <>
      <h1>Guide</h1>

      <div className="guide-content">
        <section>
          <h2>What This Does</h2>
          <p>
            Novel Harness creates short stories (3 chapters, one per act) using a pipeline of LLM agents.
            You provide a premise, genre, and characters. The system builds a world, plots the story, writes
            each chapter, and validates consistency — all with your review at each step.
          </p>
          <p>
            It's also a benchmarking and tuning platform. You can measure how well different models perform
            at writing, planning, and extraction, then systematically improve the prompts that drive them.
          </p>
        </section>

        <section>
          <h2>Novel Creation Flow</h2>
          <div className="flow-diagram">
            <div className="flow-step">
              <div className="flow-num">1</div>
              <div>
                <strong>Start</strong>
                <p>Enter a premise, genre, and 2-4 characters — or pick a seed file.</p>
                <p className="flow-agents">No agents involved</p>
              </div>
            </div>

            <div className="flow-arrow">|</div>

            <div className="flow-step">
              <div className="flow-num">2</div>
              <div>
                <strong>Concept Phase</strong>
                <p>Three agents run in parallel: <em>World Builder</em> creates the setting, rules, and locations.
                   <em>Character Agent</em> expands sketches into full profiles with backstory, traits, and relationships.
                   <em>Plotter</em> creates the story spine — central conflict, theme, and 3-act structure.</p>
                <p className="flow-agents">Agents: world-builder, character-agent, plotter</p>
                <p className="flow-gate">You review and approve/revise/reject each output.</p>
              </div>
            </div>

            <div className="flow-arrow">|</div>

            <div className="flow-step">
              <div className="flow-num">3</div>
              <div>
                <strong>Planning Phase</strong>
                <p>The <em>Planning Plotter</em> takes the world, characters, and story spine and creates
                   chapter-by-chapter outlines with scenes, POV characters, emotional arcs, and target word counts.</p>
                <p className="flow-agents">Agent: planning-plotter</p>
                <p className="flow-gate">You review the complete outline before drafting begins.</p>
              </div>
            </div>

            <div className="flow-arrow">|</div>

            <div className="flow-step">
              <div className="flow-num">4</div>
              <div>
                <strong>Drafting Phase</strong>
                <p>Each chapter is written sequentially. The <em>Writer</em> generates prose from the outline,
                   world bible, character profiles, and facts from prior chapters. The <em>Continuity Checker</em>
                   flags inconsistencies. After each chapter you can approve, revise (with notes), or reject.</p>
                <p>After approval, <em>extractors</em> pull out facts, summaries, and character states
                   to feed context into subsequent chapters.</p>
                <p className="flow-agents">Agents: writer, continuity, summary-extractor, fact-extractor, character-state</p>
                <p className="flow-gate">You review each chapter draft with continuity issues highlighted.</p>
              </div>
            </div>

            <div className="flow-arrow">|</div>

            <div className="flow-step">
              <div className="flow-num">5</div>
              <div>
                <strong>Validation Phase</strong>
                <p>Multi-pass cross-chapter consistency check. The <em>Cross-Chapter Continuity</em> agent
                   checks all chapters together for contradictions. <em>Prose Quality</em> flags issues
                   per chapter. If issues are found, the <em>Rewriter</em> fixes them automatically.
                   Repeats up to 3 passes until convergence.</p>
                <p className="flow-agents">Agents: cross-chapter-continuity, prose-quality, rewriter</p>
                <p className="flow-gate">Automatic — no human review needed.</p>
              </div>
            </div>

            <div className="flow-arrow">|</div>

            <div className="flow-step done">
              <div className="flow-num">6</div>
              <div>
                <strong>Done</strong>
                <p>Final chapters saved to <code>output/novel-*/chapter-*.md</code>.
                   Total cost and token usage shown in the timeline.</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2>Pages</h2>
          <div className="guide-cards">
            <div className="card">
              <h3><Link to={`/${window.location.search}`}>Novel List</Link></h3>
              <p>Start a new novel with custom input or a seed file. View, resume, or archive existing novels.
                 Novels with pending approval gates show a "waiting" badge.</p>
            </div>
            <div className="card">
              <h3>Pipeline View</h3>
              <p>Real-time conversational timeline of a novel run. Each agent step shows which model is being used,
                 and every LLM call displays tokens, latency, throughput, and cost. Gate panels appear inline
                 for approve/revise/reject decisions. Running total of cost shown at the bottom.</p>
            </div>
            <div className="card">
              <h3><Link to={`/config${window.location.search}`}>Config</Link></h3>
              <p>Change which model each agent uses. Grouped by role: writers, planners, extractors, validators,
                 judges, benchmark, improvement. Changes apply immediately — even mid-run. Model pricing shown
                 per agent. "Save to File" writes changes permanently to <code>models/roles.ts</code>.</p>
            </div>
            <div className="card">
              <h3><Link to={`/experiments${window.location.search}`}>Experiments</Link></h3>
              <p>Unified view of all benchmark runs and improvement cycles. Grouped by target/dimension.
                 Shows scores, cost, iteration counts, conclusions. Click to expand for per-variant scores,
                 cost breakdown, and lineage links to related experiments.</p>
            </div>
          </div>
        </section>

        <section>
          <h2>Benchmarking &amp; Improvement</h2>
          <p>
            The <Link to={`/operations${window.location.search}`}>Operations Panel</Link> runs benchmarks and improvement cycles.
            Both produce experiments — there's no functional difference. An experiment is: run an agent,
            measure the output, record scores.
          </p>

          <h3>Benchmark Suites</h3>
          <table className="guide-table">
            <thead>
              <tr><th>Suite</th><th>Tests</th><th>Dimensions</th><th>Scoring</th></tr>
            </thead>
            <tbody>
              <tr><td>Prose</td><td>Writer agent</td><td>Penalty-based (issue counts)</td><td>Lower = better</td></tr>
              <tr><td>Planning</td><td>Planning plotter</td><td>Beat Specificity, Dialogue Cues, Emotional Arc</td><td>1-10</td></tr>
              <tr><td>Extraction</td><td>Summary, fact, character-state extractors</td><td>Completeness, Accuracy</td><td>1-10</td></tr>
              <tr><td>Continuity</td><td>Cross-chapter continuity</td><td>Issue Detection, Fix Quality</td><td>1-10</td></tr>
            </tbody>
          </table>

          <h3>Improvement Cycles</h3>
          <p>
            An improvement cycle automates: diagnose weakest dimension → propose prompt change → benchmark → keep or revert.
            By default, cycles are <strong>dimension-locked</strong> — they stay focused on one target/dimension for all
            iterations instead of scattering across dimensions. This produces structured, comparable data.
          </p>
          <p>
            Cross-experiment linking automatically connects experiments on the same target/dimension.
            The proposer sees conclusions from prior experiments, so it knows what's been tried and what worked.
          </p>
        </section>

        <section>
          <h2>Cost Management</h2>
          <p>
            Every LLM call computes cost from the model registry pricing (tokens × $/1M).
            Cost is stored in the <code>llm_calls</code> Postgres table and displayed in the
            pipeline timeline (per-call), experiments page (per-experiment), and config page (per-model).
          </p>

          <h3>Batch API (50% off)</h3>
          <p>
            The primary cost lever. Queues requests and submits via provider batch APIs (OpenAI, Groq).
            Async with up to 24h turnaround. Toggle with <code>--batch</code> flag or <code>LLM_TRANSPORT=batch</code>.
            Saves 50% on both input and output tokens.
          </p>

          <h3>Provider Prefix Caching (automatic)</h3>
          <p>
            OpenAI and DeepSeek automatically cache repeated prompt prefixes at the provider level —
            no code or transport intervention needed. When requests share the same system prompt,
            cached input tokens are discounted (OpenAI: 90% off, DeepSeek: 95% off).
            The harness structures prompts with static instructions first and variable content last,
            so caching happens naturally. Batch and cache discounts stack.
          </p>

          <table className="guide-table">
            <thead>
              <tr><th>Provider</th><th>Cache Discount</th><th>Batch Discount</th><th>Min Tokens</th></tr>
            </thead>
            <tbody>
              <tr><td>OpenAI</td><td>90% off input</td><td>50% off all</td><td>1024</td></tr>
              <tr><td>DeepSeek</td><td>95% off input</td><td>—</td><td>None</td></tr>
              <tr><td>Groq</td><td>50% off input</td><td>50% off all</td><td>—</td></tr>
              <tr><td>Cerebras</td><td>—</td><td>—</td><td>—</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Model Configuration</h2>
          <p>
            Each agent has a default model assignment in <code>models/roles.ts</code>.
            The <Link to={`/config${window.location.search}`}>Config page</Link> lets you change any agent's
            provider, model, and temperature via dropdowns. Changes take effect on the next <code>callAgent()</code>
            invocation — even during an active novel run or improvement cycle.
          </p>
          <p>
            Overrides are in-memory by default (cleared on server restart). Click "Save to File" to write
            them permanently to <code>models/roles.ts</code>, making them the new defaults.
          </p>
        </section>

        <section>
          <h2>Architecture</h2>
          <pre className="guide-arch">{`
LXC 307 (192.168.1.108)
├── Orchestrator (port 3006)
│   ├── /app                  React UI (all pages)
│   │   ├── /app/             Novel list + creation
│   │   ├── /app/:novelId     Pipeline timeline
│   │   ├── /app/config       Agent model configuration
│   │   ├── /app/experiments  Unified experiment history
│   │   ├── /app/operations   Benchmark runner, improvement daemon
│   │   ├── /app/dashboard    Batch status, daemon status
│   │   └── /app/guide        This page
│   └── /api/*                REST + SSE endpoints
├── Postgres DB (novel_harness_orchestrator)
│   ├── tuning_experiments, runs, generations, scores
│   ├── llm_calls (with cost tracking)
│   ├── improvement_cycles, improvement_iterations
│   ├── experiment_lineage (cross-experiment linking)
│   └── lint_patterns, lint_issues, batches
└── Per-novel SQLite (output/novel-*/novel.db)
    ├── novels, world_bibles, characters, story_spines
    ├── chapter_outlines, chapter_drafts, chapter_summaries
    ├── facts, character_states, issues, validation_passes
    └── (LLM calls tracked centrally in Postgres)
          `.trim()}</pre>
        </section>
      </div>
    </>
  )
}
