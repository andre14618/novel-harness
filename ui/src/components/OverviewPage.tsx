export function OverviewPage() {
  return (
    <div className="overview-page">
      <header className="overview-header">
        <div className="overview-header-inner">
          <h1>Novel Harness</h1>
          <p className="overview-tagline">
            An AI-assisted novel creation system where deterministic code controls the creative pipeline
            and LLMs serve as specialized function calls — never as autonomous agents.
          </p>
          <a href="/login" className="overview-signin">Sign in</a>
        </div>
      </header>

      <main className="overview-main">

        {/* Goal */}
        <section className="overview-section">
          <h2>Goal</h2>
          <p className="overview-desc">
            Produce novel-length fiction that reads like it was written by a human author —
            with consistent characters, evolving relationships, and a coherent world — using
            only open-weight models orchestrated by deterministic code. No
            frontier models in the production loop. Every quality dimension is measurable
            and improvable without subjective scoring.
          </p>
        </section>

        {/* How it works */}
        <section className="overview-section">
          <h2>How It Works</h2>
          <p className="overview-desc" style={{ marginBottom: "1.5rem" }}>
            A novel progresses through a state machine. Each phase uses specialized agents —
            one focused task per LLM call, with structured output schemas and deterministic validation.
            The code decides what happens next, not the model.
          </p>

          <div className="pipeline-flow">
            <Phase n={1} name="Concept" color="var(--blue)">
              <p>Three parallel agents generate the foundation from a seed premise:</p>
              <ul className="phase-details">
                <li><strong>World-builder</strong> — physical rules, history, power structures, cultures</li>
                <li><strong>Character-agent</strong> — motivations, speech patterns, relationships, secrets</li>
                <li><strong>Plotter</strong> — story spine with act structure and chapter-level arcs</li>
              </ul>
            </Phase>

            <Phase n={2} name="Planning" color="var(--accent)">
              <p>
                Each chapter is decomposed into <em>beats</em> — the atomic unit of writing.
                A beat specifies characters present, POV, setting, events that must occur,
                and world state changes (new facts, knowledge shifts, relationship updates).
                This is the contract the writer must fulfill.
              </p>
            </Phase>

            <Phase n={3} name="Drafting" color="var(--yellow)">
              <p>
                Beats are written serially with minimal, focused context per call (~850 tokens in,
                ~400 tokens out). Each beat goes through a validation gauntlet before the next one starts:
              </p>
              <ul className="phase-details">
                <li><strong>Adherence checking</strong> — 4 parallel sub-calls (events, setting, tangent, character) verify the prose fulfills the beat spec. Decomposed because a single complex checklist fails on small models.</li>
                <li><strong>Chapter plan checking</strong> — structural comparison of the full chapter against the planning output</li>
                <li><strong>Continuity checking</strong> — 2 parallel sub-calls (facts, character state) verify consistency against the accumulated world state</li>
                <li><strong>Lint</strong> — ~26 deterministic pattern detectors (cliché, hedging, emotional echo, rhythm monotony) with per-sentence LLM rewrites for violations</li>
              </ul>
              <p>Failed beats retry with the failure reason injected as context. The chapter only advances when all checks pass.</p>
            </Phase>

            <Phase n={4} name="Extraction" color="var(--accent)">
              <p>
                After a chapter is approved, structured state is extracted from the prose and
                persisted to Postgres — facts, character emotional states, relationship changes,
                timeline events, knowledge propagation. This becomes the context source for
                subsequent chapters, replacing semantic retrieval with deterministic lookups.
              </p>
            </Phase>

            <Phase n={5} name="Validation" color="var(--blue)" last>
              <p>
                Chapters that fail deterministic quality checks get rewritten.
                Once all chapters converge, a <strong>tonal pass</strong> applies a LoRA fine-tuned
                adapter (Qwen3 14B) for per-paragraph voice rewriting — transferring stylistic
                qualities from reference prose while preserving content. Dialogue is skipped.
              </p>
            </Phase>
          </div>
        </section>

        {/* Key design choices */}
        <section className="overview-section">
          <h2>Design Principles</h2>
          <div className="principles-grid">
            <div className="principle">
              <h4>Beat-First Architecture</h4>
              <p>
                Writing happens at the beat level, not the chapter level. This keeps
                context windows small, makes failures cheap to retry, and gives each
                quality check a precise scope. A chapter is just the concatenation
                of its approved beats.
              </p>
            </div>
            <div className="principle">
              <h4>Decomposed Validation</h4>
              <p>
                Complex checks are split into focused parallel calls — one question per call.
                A 14B model handling one dimension outperforms a 235B model handling five.
                This is the core insight that makes small-model pipelines viable.
              </p>
            </div>
            <div className="principle">
              <h4>No Subjective Scoring</h4>
              <p>
                LLM judges with 1-10 scales showed 0-33% discrimination in benchmarks.
                Every quality gate uses structured pass/fail checks with specific, falsifiable
                criteria. If you can't define what "better" means precisely, you can't measure it.
              </p>
            </div>
            <div className="principle">
              <h4>Multi-Provider Inference</h4>
              <p>
                Each agent slot independently selects the provider that wins for its shape.
                Creative writing on Cerebras, fast checks on Groq, fine-tuned adapters on
                W&B Inference, deep reasoning on DeepSeek. No vendor lock-in.
              </p>
            </div>
          </div>
        </section>

        {/* Skills / tech */}
        <section className="overview-section">
          <h2>Skills Applied</h2>
          <div className="skills-grid">
            <SkillGroup name="LLM Engineering" items={[
              "Multi-agent orchestration with structured output (Zod schemas)",
              "Prompt decomposition for small-model viability",
              "LoRA fine-tuning (SFT via W&B ART on Qwen3 14B)",
              "Multi-provider routing (per-agent provider selection by latency/quality)",
            ]} />
            <SkillGroup name="Backend" items={[
              "Bun runtime with TypeScript",
              "Postgres with pgvector (knowledge graph, world state)",
              "State machine architecture with deterministic control flow",
              "Real-time SSE event streaming for pipeline observability",
            ]} />
            <SkillGroup name="Infrastructure" items={[
              "Self-hosted on Proxmox LXC containers",
              "Cloudflare Tunnel for public HTTPS",
              "Tailscale mesh for internal access",
              "systemd services with automated deploys (rsync + restart)",
            ]} />
            <SkillGroup name="Quality Engineering" items={[
              "Structured benchmark framework with experiment tracking",
              "Deterministic lint system (~26 patterns sourced from craft literature)",
              "Automated improvement daemon (diagnose → propose → benchmark → keep/revert)",
              "Fine-tune distillation pipeline (oracle → synthetic data → SFT → validate)",
            ]} />
          </div>
        </section>

      </main>

      <footer className="overview-footer">
        <p>
          Built by <a href="https://andrehansel.dev">Andre Hansel</a>.
          Self-hosted on Proxmox. Served via Cloudflare Tunnel.
        </p>
      </footer>
    </div>
  )
}

function Phase({ n, name, color, last, children }: {
  n: number; name: string; color: string; last?: boolean; children: React.ReactNode
}) {
  return (
    <div className="pipeline-phase">
      <div className="phase-connector">
        <span className="phase-number" style={{ borderColor: color, color }}>{n}</span>
        {!last && <div className="phase-line" />}
      </div>
      <div className="phase-content">
        <h3>{name}</h3>
        {children}
      </div>
    </div>
  )
}

function SkillGroup({ name, items }: { name: string; items: string[] }) {
  return (
    <div className="skill-group">
      <h4>{name}</h4>
      <ul>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}
