export function ContextEngineeringPage() {
  return (
    <div className="ce-page">
      <h1>Context Engineering</h1>
      <p className="ce-subtitle">
        How information flows from the plan through DB lookups into each beat's LLM prompt.
        Every context slot is deterministic — no embeddings, no retrieval ranking, no fuzzy search.
      </p>

      {/* ── Pipeline flow (SVG) ──────────────────────────────── */}
      <section className="ce-section">
        <h2>Pipeline Data Flow</h2>
        <p className="ce-desc">
          Each phase must complete before the next begins. After a chapter is approved,
          the planner's declared state is saved to DB for the next chapter's beat context.
        </p>
        <PipelineSVG />
      </section>

      {/* ── Beat context assembly ────────────────────────────── */}
      <section className="ce-section">
        <h2>Beat Context Assembly</h2>
        <p className="ce-desc">
          Each beat receives ~500-1,000 tokens of targeted context. No embeddings, no vector search.
          Every slot is either copied from the plan or fetched via a deterministic DB query.
        </p>

        <div className="ce-beat-flow">
          {/* Left: inputs */}
          <div className="ce-beat-inputs">
            <h3>Data Sources</h3>

            <div className="ce-input-group">
              <div className="ce-input-group-label">From Plan</div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--plan" />
                Beat spec (number, POV, setting, description, characters)
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--plan" />
                Landing target (next beat's first sentence)
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--plan" />
                Target word count (chapter target / beat count)
              </div>
            </div>

            <div className="ce-input-group">
              <div className="ce-input-group-label">From Previous Beat</div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--prose" />
                Transition bridge (last 2-3 sentences of prose)
              </div>
            </div>

            <div className="ce-input-group">
              <div className="ce-input-group-label">From DB</div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--db" />
                Character snapshots (speech, goals, avoids, internal conflict)
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--db" />
                Character emotional state (from character_states)
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--db" />
                Relationship dynamics (trust level, tension — from relationship_states)
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--db" />
                Knowledge constraints (what character doesn't know)
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--db" />
                Setting details (sensory — beat 0 or location change only)
              </div>
            </div>

            <div className="ce-input-group">
              <div className="ce-input-group-label">From Reference Resolver</div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--ref" />
                Recent events involving beat characters
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--ref" />
                Location-specific events
              </div>
              <div className="ce-input-item">
                <span className="ce-dot ce-dot--ref" />
                Character knowledge on referenced topics
              </div>
              <div className="ce-input-item ce-input-item--note">
                Deterministic marker detection + Llama 3.1 8B fallback.
                Max 3 lookups per beat.
              </div>
            </div>
          </div>

          {/* Center: assembly */}
          <div className="ce-beat-assembly">
            <div className="ce-assembly-arrow" />
            <div className="ce-assembly-box">
              <h3>Assembled Prompt</h3>
              <div className="ce-slot"><span className="ce-slot-num">1</span> BEAT SPEC</div>
              <div className="ce-slot"><span className="ce-slot-num">2</span> TRANSITION BRIDGE</div>
              <div className="ce-slot"><span className="ce-slot-num">3</span> LANDING TARGET</div>
              <div className="ce-slot"><span className="ce-slot-num">4</span> CHARACTERS</div>
              <div className="ce-slot"><span className="ce-slot-num">5</span> RESOLVED REFERENCES</div>
              <div className="ce-slot ce-slot--conditional"><span className="ce-slot-num">6</span> SETTING <span className="ce-cond">if beat 0 or location change</span></div>
              <div className="ce-token-budget">~500-1,000 tokens</div>
            </div>
          </div>

          {/* Right: output */}
          <div className="ce-beat-output">
            <div className="ce-output-arrow" />
            <div className="ce-output-box">
              <h3>Beat Writer</h3>
              <div className="ce-output-detail">DeepSeek V4 Flash</div>
              <div className="ce-output-detail">~391 tokens out, ~2.1s</div>
              <div className="ce-output-result">300-500 words of prose</div>
            </div>
            <div className="ce-output-arrow" />
            <div className="ce-output-box ce-output-box--check">
              <h3>Adherence Check</h3>
              <div className="ce-output-detail">Deterministic + bounded V4 Flash</div>
              <div className="ce-output-detail">character presence, events, attribution</div>
              <div className="ce-output-result ce-output-result--retry">fail &rarr; targeted rewrite with specific issues</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Deliberate omissions ─────────────────────────────── */}
      <section className="ce-section">
        <h2>Deliberate Omissions</h2>
        <p className="ce-desc">
          What the beat context does NOT include, and why.
        </p>
        <div className="ce-omissions">
          <div className="ce-omission">
            <div className="ce-omission-what">emotionalShift</div>
            <div className="ce-omission-why">Naming emotions biases toward telling. The beat description encodes emotional trajectory through action.</div>
          </div>
          <div className="ce-omission">
            <div className="ce-omission-what">World systems / facts / timeline</div>
            <div className="ce-omission-why">Too broad for per-beat context. Reserved for chapter-level continuity checking where the full state table is needed.</div>
          </div>
          <div className="ce-omission">
            <div className="ce-omission-what">Embeddings / vector search</div>
            <div className="ce-omission-why">Infrastructure exists but disabled. Deterministic DB lookups are cheaper, faster, and more predictable than RRF retrieval.</div>
          </div>
          <div className="ce-omission">
            <div className="ce-omission-what">Full character backstory</div>
            <div className="ce-omission-why">Only the speech pattern, behavioral drivers, current state, and POV relationship are included. Full profiles bloat context without improving prose.</div>
          </div>
        </div>
      </section>

      {/* ── State feedback loop ──────────────────────────────── */}
      <section className="ce-section">
        <h2>State Feedback Loop</h2>
        <p className="ce-desc">
          After each chapter is approved, the planner's declared state changes are persisted.
          These become available to the next chapter's beat context via DB lookups.
        </p>

        <div className="ce-state-tables">
          <h3>DB Tables Feeding Beat Context</h3>
          <table className="guide-table">
            <thead>
              <tr><th>Table</th><th>What It Stores</th><th>Used By</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>character_states</code></td>
                <td>Emotional state, knowledge gaps per chapter</td>
                <td>Character snapshot (state, doesn't-know)</td>
              </tr>
              <tr>
                <td><code>relationship_states</code></td>
                <td>Trust level, dynamic, tension per pair per chapter</td>
                <td>Character snapshot (relationship to POV)</td>
              </tr>
              <tr>
                <td><code>character_knowledge</code></td>
                <td>What character knows, source (witnessed, told, deduced)</td>
                <td>Reference resolver (knowledge lookups)</td>
              </tr>
              <tr>
                <td><code>timeline_events</code></td>
                <td>Events with participants, witnesses, consequences</td>
                <td>Reference resolver (recent events, location events)</td>
              </tr>
              <tr>
                <td><code>facts</code></td>
                <td>Established world facts per chapter</td>
                <td>Continuity checker (chapter-level)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   SVG Pipeline Diagram
   ════════════════════════════════════════════════════════════════════ */

/** Rounded-rect node with 1-2 lines of text */
function N({ x, y, w, h, type, label, sub, sub2 }: {
  x: number; y: number; w: number; h: number
  type: string; label: string; sub?: string; sub2?: string
}) {
  const lines = sub2 ? 3 : sub ? 2 : 1
  const ly = lines === 1 ? y + h / 2 + 4 : lines === 2 ? y + 17 : y + 14
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} className={`cn cn--${type}`} />
      <text x={x + w / 2} y={ly} textAnchor="middle" className="cn-t">{label}</text>
      {sub && <text x={x + w / 2} y={ly + 14} textAnchor="middle" className="cn-s">{sub}</text>}
      {sub2 && <text x={x + w / 2} y={ly + 27} textAnchor="middle" className="cn-s">{sub2}</text>}
    </g>
  )
}

/** Arrow line (auto-orient marker) */
function A({ x1, y1, x2, y2, kind }: {
  x1: number; y1: number; x2: number; y2: number; kind?: string
}) {
  const cls = kind === "retry" ? "ca ca--retry" : kind === "feedback" ? "ca ca--feedback" : "ca"
  const mid = kind === "retry" ? "arr-red" : kind === "feedback" ? "arr-accent" : "arr"
  return <line x1={x1} y1={y1} x2={x2} y2={y2} className={cls} markerEnd={`url(#${mid})`} />
}

/** Curved path arrow */
function P({ d, kind }: { d: string; kind?: string }) {
  const cls = kind === "retry" ? "ca ca--retry" : kind === "feedback" ? "ca ca--feedback" : "ca"
  const mid = kind === "retry" ? "arr-red" : kind === "feedback" ? "arr-accent" : "arr"
  return <path d={d} fill="none" className={cls} markerEnd={`url(#${mid})`} />
}

/** Phase number circle */
function Pn({ cx, cy, n }: { cx: number; cy: number; n: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={10} className="cp-circle" />
      <text x={cx} y={cy + 4} textAnchor="middle" className="cp-num">{n}</text>
    </g>
  )
}

function PipelineSVG() {
  // ── Vertical layout constants ──────────────────────────────────
  const W = 920           // viewBox width
  const PX = 40           // phase rect x
  const PW = 835          // phase rect width
  const MID = PX + PW / 2 // horizontal center

  // Phase y-positions
  const p1y = 42, p1h = 110
  const p2y = 175, p2h = 90
  const p3y = 288, p3h = 90
  const p4y = 401, p4h = 225
  const p5y = 650, p5h = 90

  // Node vertical positions (inside each phase)
  const n1y = p1y + 30, n1h = 55
  const n2y = p2y + 25, n2h = 50
  const n3y = p3y + 25, n3h = 50
  const n5y = p5y + 25, n5h = 48

  return (
    <svg viewBox={`0 0 ${W} 760`} className="ce-svg" role="img" aria-label="Pipeline data flow diagram">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10z" fill="var(--border-strong)" />
        </marker>
        <marker id="arr-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10z" fill="var(--red)" />
        </marker>
        <marker id="arr-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10z" fill="var(--accent)" />
        </marker>
      </defs>

      {/* ── Legend ──────────────────────────────────────────────── */}
      <g>
        <rect x={PX} y={4} width={PW} height={28} rx={4} className="cl-bg" />
        {/* Input */}
        <rect x={55} y={10} width={14} height={14} rx={3} className="cn cn--source" />
        <text x={75} y={21} className="cl-t">Input</text>
        {/* Agent */}
        <rect x={155} y={10} width={14} height={14} rx={3} className="cn cn--agent" />
        <text x={175} y={21} className="cl-t">Agent / LLM</text>
        {/* Store */}
        <rect x={305} y={10} width={14} height={14} rx={3} className="cn cn--store" />
        <text x={325} y={21} className="cl-t">DB Store</text>
        {/* Output */}
        <rect x={435} y={10} width={14} height={14} rx={3} className="cn cn--output" />
        <text x={455} y={21} className="cl-t">Output / Prose</text>
        {/* Blocking */}
        <rect x={585} y={10} width={14} height={14} rx={3} className="cn cn--blocking" />
        <text x={605} y={21} className="cl-t">Blocking Check</text>
        {/* Warning */}
        <rect x={735} y={10} width={14} height={14} rx={3} className="cn cn--warn" />
        <text x={755} y={21} className="cl-t">Warning</text>
      </g>

      {/* ── Phase 1: World Building ───────────────────────────── */}
      <rect x={PX} y={p1y} width={PW} height={p1h} rx={8} className="cs-ph" />
      <Pn cx={PX + 20} cy={p1y + 16} n={1} />
      <text x={PX + 36} y={p1y + 20} className="cs-title">World Building</text>
      <text x={PX + PW - 10} y={p1y + 20} textAnchor="end" className="cs-meta">runs once per novel</text>

      <N x={55} y={n1y} w={185} h={n1h} type="source" label="Seed / Premise" sub="genre, characters, constraints" />
      <A x1={240} y1={n1y + n1h / 2} x2={292} y2={n1y + n1h / 2} />
      <N x={292} y={n1y} w={215} h={n1h} type="agent" label="Concept Agents" sub="world-builder, character, plotter" />
      <A x1={507} y1={n1y + n1h / 2} x2={555} y2={n1y + n1h / 2} />
      <N x={555} y={n1y} w={305} h={n1h} type="store" label="World Bible + Characters" sub="locations, rules, speech patterns, goals" />

      {/* connector 1→2 */}
      <A x1={MID} y1={p1y + p1h} x2={MID} y2={p2y} />

      {/* ── Phase 2: Planning ─────────────────────────────────── */}
      <rect x={PX} y={p2y} width={PW} height={p2h} rx={8} className="cs-ph" />
      <Pn cx={PX + 20} cy={p2y + 16} n={2} />
      <text x={PX + 36} y={p2y + 20} className="cs-title">Planning</text>
      <text x={PX + PW - 10} y={p2y + 20} textAnchor="end" className="cs-meta">runs once per novel</text>

      <N x={120} y={n2y} w={260} h={n2h} type="agent" label="Planning Plotter" sub="reads world bible + characters" />
      <A x1={380} y1={n2y + n2h / 2} x2={440} y2={n2y + n2h / 2} />
      <N x={440} y={n2y - 3} w={400} h={n2h + 6} type="store" label="Chapter Outlines" sub="beats, POV, setting, target words" sub2="+ establishedFacts, stateChanges, knowledge" />

      {/* connector 2→3 */}
      <A x1={MID} y1={p2y + p2h} x2={MID} y2={p3y} />

      {/* ── Phase 3: Drafting ─────────────────────────────────── */}
      <rect x={PX} y={p3y} width={PW} height={p3h} rx={8} className="cs-ph cs-ph--active" />
      <Pn cx={PX + 20} cy={p3y + 16} n={3} />
      <text x={PX + 36} y={p3y + 20} className="cs-title">Drafting</text>
      <text x={PX + PW - 10} y={p3y + 20} textAnchor="end" className="cs-meta">per chapter, beat-by-beat</text>

      <N x={100} y={n3y} w={310} h={n3h} type="agent" label="Beat Writing Loop" sub="resolve → context → write → adherence" />
      <A x1={410} y1={n3y + n3h / 2} x2={480} y2={n3y + n3h / 2} />
      <N x={480} y={n3y} w={230} h={n3h} type="output" label="Chapter Prose" sub="assembled from all beats" />

      {/* connector 3→4 */}
      <A x1={MID} y1={p3y + p3h} x2={MID} y2={p4y} />

      {/* ── Phase 4: Validation ───────────────────────────────── */}
      <rect x={PX} y={p4y} width={PW} height={p4h} rx={8} className="cs-ph" />
      <Pn cx={PX + 20} cy={p4y + 16} n={4} />
      <text x={PX + 36} y={p4y + 20} className="cs-title">Validation</text>
      <text x={PX + PW - 10} y={p4y + 20} textAnchor="end" className="cs-meta">per chapter</text>

      {/* Parallel section label */}
      <text x={MID} y={p4y + 38} textAnchor="middle" className="cs-ann">plan check + continuity run in parallel</text>

      {/* Fork lines from center down to the two checks */}
      <line x1={MID} y1={p4y + 42} x2={MID} y2={p4y + 52} className="ca" />
      <line x1={200} y1={p4y + 52} x2={720} y2={p4y + 52} className="ca" />
      <A x1={200} y1={p4y + 52} x2={200} y2={p4y + 60} />
      <A x1={660} y1={p4y + 52} x2={660} y2={p4y + 60} />

      {/* Plan Check — blocking */}
      <N x={60} y={p4y + 60} w={285} h={58} type="blocking" label="Plan Check" sub="prose vs plan structure" sub2="DeepSeek V4 Flash thinking" />

      {/* Continuity — warning */}
      <N x={520} y={p4y + 60} w={285} h={58} type="warn" label="Continuity" sub="facts + character states" sub2="DeepSeek V4 Flash (2 parallel calls)" />

      {/* Retry arrow from Plan Check → back up to Phase 3 */}
      <P d={`M 60,${p4y + 89} L 25,${p4y + 89} Q 18,${p4y + 89} 18,${p4y + 82} L 18,${p3y + n3h / 2 + n3y - p3y + 8} Q 18,${p3y + n3h / 2 + n3y - p3y} 26,${p3y + n3h / 2 + n3y - p3y}`} kind="retry" />
      <text x={14} y={p4y + 10} className="cs-retry-label" textAnchor="middle" transform={`rotate(-90, 14, ${(p3y + p4y + 89) / 2})`}>fail → beat-targeted rewrite or reviser</text>

      {/* Rejoin + sequential label */}
      <line x1={200} y1={p4y + 118} x2={200} y2={p4y + 128} className="ca" />
      <line x1={660} y1={p4y + 118} x2={660} y2={p4y + 128} className="ca" />
      <line x1={200} y1={p4y + 128} x2={720} y2={p4y + 128} className="ca" />
      <A x1={MID} y1={p4y + 128} x2={MID} y2={p4y + 140} />
      <text x={MID} y={p4y + 152} textAnchor="middle" className="cs-ann">then lint runs sequentially</text>

      {/* Lint section */}
      <N x={50} y={p4y + 160} w={215} h={50} type="agent" label="Lint Detect" sub="26 patterns + echo + rhythm" />
      <A x1={265} y1={p4y + 185} x2={305} y2={p4y + 185} />
      <rect x={305} y={p4y + 158} width={280} height={54} rx={6} className="cn cn--lint" />
      <text x={445} y={p4y + 176} textAnchor="middle" className="cn-t">3-Pass Auto-Fix</text>
      <text x={445} y={p4y + 190} textAnchor="middle" className="cn-s">1. deterministic  2. LLM/sentence</text>
      <text x={445} y={p4y + 202} textAnchor="middle" className="cn-s">3. LLM/rhythm (235B, ~1-8 calls)</text>
      <A x1={585} y1={p4y + 185} x2={625} y2={p4y + 185} />
      <N x={625} y={p4y + 160} w={200} h={50} type="output" label="Fixed Prose" sub="overwrites draft in place" />

      {/* connector 4→5 */}
      <A x1={MID} y1={p4y + p4h} x2={MID} y2={p5y} />

      {/* ── Phase 5: Approval + Extraction ────────────────────── */}
      <rect x={PX} y={p5y} width={PW} height={p5h} rx={8} className="cs-ph" />
      <Pn cx={PX + 20} cy={p5y + 16} n={5} />
      <text x={PX + 36} y={p5y + 20} className="cs-title">Approval + State Save</text>
      <text x={PX + PW - 10} y={p5y + 20} textAnchor="end" className="cs-meta">per chapter — feeds next chapter</text>

      <N x={55} y={n5y} w={185} h={n5h} type="output" label="Approved Chapter" />
      <A x1={240} y1={n5y + n5h / 2} x2={290} y2={n5y + n5h / 2} />
      <N x={290} y={n5y - 2} w={270} h={n5h + 4} type="store" label="savePlannedState()" sub="planner-declared state → DB" />
      <A x1={560} y1={n5y + n5h / 2} x2={610} y2={n5y + n5h / 2} />
      <N x={610} y={n5y} w={250} h={n5h} type="store" label="DB State Tables" sub="facts, states, knowledge, relationships" />

      {/* ── Feedback loop: DB Tables → back to Phase 3 ────────── */}
      <P d={`M ${860},${n5y + n5h / 2} L ${878},${n5y + n5h / 2} Q ${888},${n5y + n5h / 2} ${888},${n5y + n5h / 2 - 10} L ${888},${p3y + p3h / 2 + 8} Q ${888},${p3y + p3h / 2} ${878},${p3y + p3h / 2}`} kind="feedback" />
      <text x={892} y={(p3y + p3h / 2 + n5y + n5h / 2) / 2 + 4} className="cs-feedback-label" textAnchor="middle" transform={`rotate(90, 892, ${(p3y + p3h / 2 + n5y + n5h / 2) / 2 + 4})`}>feeds next chapter's beat context</text>
    </svg>
  )
}
