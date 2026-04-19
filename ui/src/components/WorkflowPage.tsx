/**
 * WorkflowPage — visual map of the Claude+Codex orchestration workflow
 * captured in .claude/skills/implement-ticket.md. The source of truth
 * is the skill doc; this page is a human-readable dashboard.
 *
 * Structure:
 *   1. Swim-lane timeline (who does what in what order)
 *   2. Phase reference (-1 through 12)
 *   3. Codex entry points (3 per ticket)
 *   4. Parallel dispatch pattern
 *   5. Exit triggers (9 conditions that halt + escalate)
 *   6. Artifacts + file map
 */

type Actor = "user" | "claude" | "subagent" | "codex" | "lxc"

interface Phase {
  num: number | "-1" | "0"
  name: string
  actors: Actor[]       // primary actor(s) during this phase
  kind: "setup" | "plan" | "review" | "impl" | "gate" | "ship" | "close"
  summary: string
  notes?: string[]
}

const PHASES: Phase[] = [
  {
    num: "-1",
    name: "Session start",
    actors: ["claude"],
    kind: "setup",
    summary: "Read .claude/session-handoff.md, list in-flight registry, verify each, check todo.md priorities.",
    notes: [
      "Mandatory session-start receipt: `session-start: handoff ✓ in-flight ✓ todo ✓`",
      "Prune ghost registry entries via `bun scripts/lib/in-flight.ts prune`",
    ],
  },
  {
    num: "0",
    name: "Create tuning_experiment",
    actors: ["claude", "lxc"],
    kind: "setup",
    summary: "MANDATORY before any code work. Register experiment row; export EXPERIMENT_ID; add in-flight registry entry if launching anything background.",
    notes: [
      "CLAUDE.md rule 1: every experiment goes in the DB",
      "Experiment types: charter / validation_sweep / sft_training / checker-eval / infrastructure",
    ],
  },
  {
    num: 1,
    name: "Plan",
    actors: ["claude"],
    kind: "plan",
    summary: "Goal + non-goals, file ownership slices, green/red work split, concrete exit criteria.",
    notes: ["Green = safe to dispatch speculatively; red = blocked until Codex PASS"],
  },
  {
    num: 2,
    name: "Codex plan-triage",
    actors: ["codex"],
    kind: "review",
    summary: "30-sec routing call: green/red/mixed + ≤3 reasons + 1 blocker. NO patch suggestions. Strict I/O contract prevents drift into mini-review.",
  },
  {
    num: 3,
    name: "Codex plan review",
    actors: ["codex"],
    kind: "review",
    summary: "Full plan review at gpt-5.4 --effort high. 3-8 min. Returns PASS / CHANGE / NEEDS-WORK.",
  },
  {
    num: 4,
    name: "Parallel subagent dispatch",
    actors: ["subagent"],
    kind: "impl",
    summary: "Sonnet subagents fire in parallel on disjoint file slices. Single message, multiple Agent tool calls.",
    notes: [
      "Every prompt: exact scope + Codex decisions + test requirements + commit contract + report-back shape",
      "Default to 2-4 parallel subagents for decomposable work",
    ],
  },
  {
    num: 5,
    name: "Preflight (blocking)",
    actors: ["claude"],
    kind: "gate",
    summary: "Runs on the aggregated commit set. Halts on failure.",
    notes: [
      "bun test src/ (pre-existing fails allowlisted)",
      "bunx tsc --noEmit (pre-existing errors allowlisted)",
      "Migration-path test if sql/ moved",
      "Invariants: restart state, seam-recheck symmetry, subscribe-before-start, branch-symmetric emit, body-already-used",
      "Two failures on same root cause → escalate",
    ],
  },
  {
    num: 6,
    name: "Codex implementation review",
    actors: ["codex"],
    kind: "review",
    summary: "Two parts in one thread: narrow-question block (3-4 binary questions) + full-diff review. Commit-pinned: every prompt cites `git show <sha>`.",
    notes: [
      "Hot vs cold tiering: coupling, NOT line count",
      "Cold → full-diff + narrow (state, retries, gates, persistence, restart, async)",
      "Hot → narrow only (leaf-local, deterministic)",
    ],
  },
  {
    num: 7,
    name: "Fix + re-review",
    actors: ["claude", "codex"],
    kind: "impl",
    summary: "Fix only Codex-flagged issues. Re-review ONCE on the fix delta. HIGH after first fix → halt.",
  },
  {
    num: 8,
    name: "Deploy",
    actors: ["claude", "lxc"],
    kind: "ship",
    summary: "yes y | bash scripts/deploy-lxc.sh. Verify service restart + migrations + orphan sweep.",
    notes: ["Two deploy failures → escalate"],
  },
  {
    num: 9,
    name: "Validate",
    actors: ["lxc"],
    kind: "gate",
    summary: "Deterministic check preferred; organic novel run for integration coverage. Pass gate declared in the plan. Ambiguous → escalate.",
  },
  {
    num: 10,
    name: "Docs subagent (parallel)",
    actors: ["subagent"],
    kind: "impl",
    summary: "Runs IN PARALLEL with Phase 9 validation wall-clock. Updates docs/current-state.md, docs/todo.md, docs/lessons-learned.md.",
  },
  {
    num: 11,
    name: "Session retrospective",
    actors: ["claude"],
    kind: "close",
    summary: "Write docs/sessions/YYYY-MM-DD-{slug}.md per TEMPLATE.md. Mandatory telemetry frontmatter.",
  },
  {
    num: 12,
    name: "Session close",
    actors: ["claude"],
    kind: "close",
    summary: "Overwrite .claude/session-handoff.md with current in-flight + pending Codex + unresolved decisions + recent architectural decisions + commit chain.",
  },
]

const ACTOR_STYLES: Record<Actor, { label: string; color: string; bg: string }> = {
  user:     { label: "User",     color: "#b891ff", bg: "rgba(184, 145, 255, 0.12)" },
  claude:   { label: "Claude",   color: "#6bb3ff", bg: "rgba(107, 179, 255, 0.12)" },
  subagent: { label: "Subagent", color: "#5fcf87", bg: "rgba(95, 207, 135, 0.12)" },
  codex:    { label: "Codex",    color: "#ff9b42", bg: "rgba(255, 155, 66, 0.14)" },
  lxc:      { label: "LXC/DB",   color: "#9fa5b3", bg: "rgba(159, 165, 179, 0.10)" },
}

const KIND_STYLES: Record<Phase["kind"], { label: string; borderColor: string }> = {
  setup:  { label: "SETUP",  borderColor: "#9fa5b3" },
  plan:   { label: "PLAN",   borderColor: "#6bb3ff" },
  review: { label: "REVIEW", borderColor: "#ff9b42" },
  impl:   { label: "IMPL",   borderColor: "#5fcf87" },
  gate:   { label: "GATE",   borderColor: "#e74c3c" },
  ship:   { label: "SHIP",   borderColor: "#b891ff" },
  close:  { label: "CLOSE",  borderColor: "#9fa5b3" },
}

const EXIT_TRIGGERS = [
  "Codex plan review returns an architectural blocker",
  "Codex impl review has HIGH findings after ONE fix pass",
  "Scope expands outside declared file ownership",
  "Preflight fails twice on same root cause",
  "Deploy fails twice",
  "Validation ambiguous or exceeds time budget",
  "Ticket completes and loop would need to pick a new backlog item",
  "Quota or wall-clock budget exceeded",
  "Canonical docs disagree with current code in a load-bearing way",
]

const TELEMETRY_FIELDS = [
  { name: "wall_clock_min", desc: "Session duration in minutes" },
  { name: "codex_reviews", desc: "Total Codex calls (plan-triage + plan-review + impl-review + narrow-Qs)" },
  { name: "rework_passes", desc: "Fix-commits that followed a Codex CHANGE / NEEDS-WORK / HIGH finding" },
  { name: "bugs_caught_by_codex", desc: "Real bugs Codex flagged that unit tests missed" },
  { name: "bugs_caught_by_preflight", desc: "Real bugs preflight (tests + typecheck + invariants) caught pre-Codex" },
  { name: "bugs_escaped_to_prod", desc: "Bugs discovered after deploy" },
  { name: "preflight_false_positives", desc: "Preflight halts that turned out to be non-bugs (allowlist candidates)" },
]

export function WorkflowPage() {
  return (
    <div className="ce-page">
      <h1>Workflow: Claude ↔ Codex Orchestration</h1>
      <p className="ce-subtitle">
        How a ticket moves from "approved" to "deployed + retrospective-written" in the novel-harness session pattern.
        Source of truth: <code>.claude/skills/implement-ticket.md</code>. This page is the human-readable dashboard;
        the skill doc is authoritative on behavior.
      </p>

      {/* ── At-a-glance ─────────────────────────────────────────────── */}
      <section className="ce-section">
        <h2>At a glance</h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.75rem",
          fontSize: "0.78rem",
        }}>
          <StatCard label="Phases per ticket" value="13" detail="Phase −1 through Phase 12" />
          <StatCard label="Codex touch points" value="3" detail="triage (30s), plan review, impl review" />
          <StatCard label="Parallel dispatch lanes" value="2–4" detail="Sonnet subagents, disjoint files" />
          <StatCard label="Blocking gates" value="2" detail="Preflight + Codex impl review" />
          <StatCard label="Exit triggers" value="9" detail="See bottom of page" />
          <StatCard label="Telemetry fields" value="7" detail="Mandatory in every retrospective" />
        </div>
      </section>

      {/* ── Actor legend ─────────────────────────────────────────────── */}
      <section className="ce-section">
        <h2>Actors</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.78rem" }}>
          {(Object.keys(ACTOR_STYLES) as Actor[]).map(a => (
            <span key={a} style={{
              padding: "0.3rem 0.6rem",
              border: `1px solid ${ACTOR_STYLES[a].color}`,
              background: ACTOR_STYLES[a].bg,
              color: ACTOR_STYLES[a].color,
              borderRadius: "3px",
              fontFamily: "var(--font-mono)",
            }}>
              {ACTOR_STYLES[a].label}
            </span>
          ))}
        </div>
      </section>

      {/* ── Swim-lane timeline ──────────────────────────────────────── */}
      <section className="ce-section">
        <h2>Phase timeline</h2>
        <p className="ce-desc">
          Phases run top to bottom. Color-coded by the primary actor. Parallel boxes on the same row mean
          genuine parallelism (e.g., Phase 10 docs subagent overlaps Phase 9 validation wall-clock).
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {PHASES.map(p => <PhaseRow key={p.num} phase={p} />)}
        </div>
      </section>

      {/* ── Codex entry points ──────────────────────────────────────── */}
      <section className="ce-section">
        <h2>Where Codex enters the loop</h2>
        <p className="ce-desc">
          Codex is called 3 times per ticket, each with a different shape. No "standing thread" yet — every
          call is fresh context with a commit-pinned <code>git show &lt;sha&gt;</code> reference.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.75rem" }}>
          <CodexCard
            phase="Phase 2 — Plan-triage"
            shape="30-sec routing"
            input="Plan bullets + touched files + tests + exit criteria"
            output="green / red / mixed + ≤3 reasons + ≤1 blocker"
            constraint="NO patch suggestions. Hard stop on uncertainty."
          />
          <CodexCard
            phase="Phase 3 — Plan review"
            shape="3-8 min full review"
            input="Complete plan doc + relevant context"
            output="PASS / CHANGE / NEEDS-WORK with corrections"
            constraint="Inline corrections applied to plan doc before dispatch."
          />
          <CodexCard
            phase="Phase 6 — Implementation review"
            shape="Hot (narrow) or cold (full-diff + narrow)"
            input="Commit SHAs + narrow questions tied to risk classes"
            output="HIGH / MEDIUM / LOW findings + verdict + confidence %"
            constraint="Tier by coupling, not line count. gates/retries/state = cold."
          />
        </div>
      </section>

      {/* ── Parallel dispatch pattern ───────────────────────────────── */}
      <section className="ce-section">
        <h2>Parallel dispatch</h2>
        <p className="ce-desc">
          CLAUDE.md rule 10: decomposable implementation work goes to multiple Sonnet subagents in a single message.
          Today's Round A (3 subagents) + Round B (3 subagents) each completed in ~15-30 min wall-clock instead
          of a sequential 60-90 min.
        </p>
        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "4px",
          padding: "1rem",
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          lineHeight: "1.8",
        }}>
          <div>Claude writes ONE message containing N Agent tool calls ↓</div>
          <div style={{ paddingLeft: "1.5rem", color: "var(--text-secondary)" }}>
            {`├── subagent A (file slice 1) → commit`}
          </div>
          <div style={{ paddingLeft: "1.5rem", color: "var(--text-secondary)" }}>
            {`├── subagent B (file slice 2) → commit`}
          </div>
          <div style={{ paddingLeft: "1.5rem", color: "var(--text-secondary)" }}>
            {`└── subagent C (file slice 3) → commit`}
          </div>
          <div>↓</div>
          <div>Claude aggregates commits → ONE preflight → ONE Codex impl review</div>
          <div style={{ marginTop: "0.75rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>
            Per-subagent Codex reviews are a missed speed lever. Review runs ONCE on the aggregated diff.
          </div>
        </div>
      </section>

      {/* ── Exit triggers ───────────────────────────────────────────── */}
      <section className="ce-section">
        <h2>Exit triggers (halt + escalate)</h2>
        <p className="ce-desc">
          Any one of these stops the loop and returns control to the user. Output token:
          <code> DONE | NEEDS_HUMAN_DECISION | NEEDS_SCOPE_RESET | NEEDS_DEBUGGING</code>.
        </p>
        <ol style={{ fontSize: "0.78rem", lineHeight: "1.7", color: "var(--text-primary)", paddingLeft: "1.5rem" }}>
          {EXIT_TRIGGERS.map(t => <li key={t}>{t}</li>)}
        </ol>
      </section>

      {/* ── Telemetry ───────────────────────────────────────────────── */}
      <section className="ce-section">
        <h2>Telemetry (mandatory in every retrospective)</h2>
        <p className="ce-desc">
          Per docs/sessions/TEMPLATE.md frontmatter. Zero values are valid; missing fields are not.
          Goal: stop making workflow decisions on vibes; build a dataset.
        </p>
        <table style={{
          width: "100%",
          fontSize: "0.78rem",
          borderCollapse: "collapse",
          fontFamily: "var(--font-mono)",
        }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}>
              <th style={{ padding: "0.4rem 0.5rem" }}>Field</th>
              <th style={{ padding: "0.4rem 0.5rem" }}>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {TELEMETRY_FIELDS.map(f => (
              <tr key={f.name} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "0.4rem 0.5rem", color: "var(--accent)" }}>{f.name}</td>
                <td style={{ padding: "0.4rem 0.5rem", color: "var(--text-secondary)" }}>{f.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Artifacts ────────────────────────────────────────────────── */}
      <section className="ce-section">
        <h2>Artifact map</h2>
        <p className="ce-desc">Where each piece of the scaffolding lives in the repo.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "0.75rem", fontSize: "0.78rem" }}>
          <ArtifactCard
            path=".claude/skills/implement-ticket.md"
            purpose="Canonical workflow doc (13 phases + exit triggers + discipline). Source of truth; this page renders a dashboard over it."
          />
          <ArtifactCard
            path=".claude/session-handoff.md"
            purpose="Short living state doc overwritten at session close. Next session reads it FIRST."
          />
          <ArtifactCard
            path=".claude/in-flight/active.json"
            purpose="Per-machine registry of background runs. Gitignored (runtime state). Schema: run_id, pid, host_boot_id, verify_pattern, exp_id, log_path."
          />
          <ArtifactCard
            path="scripts/lib/in-flight.ts"
            purpose="Registry helper. CLI: list / add / remove / prune. Prune cross-checks via pgrep + host_boot_id — removes ghosts."
          />
          <ArtifactCard
            path="docs/sessions/TEMPLATE.md"
            purpose="Session retrospective template. 7 mandatory telemetry fields in frontmatter."
          />
          <ArtifactCard
            path="docs/decisions.md"
            purpose="Append-only architectural decision log. Every experiment that produces a design choice lands an entry citing the experiment ID."
          />
          <ArtifactCard
            path="docs/patterns/"
            purpose="Class-of-bug pattern docs. A pattern that recurs across 2+ sessions gets elevated here with back-links."
          />
          <ArtifactCard
            path="tuning_experiments (DB)"
            purpose="Every experiment row links commit_hash + commits + Codex thread IDs. Queryable via harness.experiments API. CLAUDE.md rule 1."
          />
          <ArtifactCard
            path="GET /api/health/debug-flags"
            purpose="Orchestrator env visibility. Benchmark scripts probe this BEFORE starting to detect contamination from prior campaigns."
          />
        </div>
      </section>

      <section className="ce-section" style={{ paddingBottom: "2rem" }}>
        <h2>Origin</h2>
        <p className="ce-desc">
          Workflow pattern emerged across the 2026-04-19 non-blind-retry + V2-interceptor session.
          Codex strategic consultation threads <code>a65ba6ef7290fdf25</code> (5-lever analysis) and{" "}
          <code>ad350aa657ec1c9b1</code> (overhaul validation) validated the shape. Experiments #237 (charter),
          #238/#239 (validation). Commits captured in{" "}
          <a href="/app/docs?doc=decisions.md" style={{ color: "var(--accent)" }}>docs/decisions.md entry "Round A + Round B architecture"</a>.
        </p>
      </section>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{
      padding: "0.75rem",
      background: "var(--bg-surface)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "4px",
    }}>
      <div style={{ color: "var(--text-tertiary)", fontSize: "0.70rem", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)", margin: "0.25rem 0" }}>{value}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{detail}</div>
    </div>
  )
}

function PhaseRow({ phase }: { phase: Phase }) {
  const kindStyle = KIND_STYLES[phase.kind]
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "48px 90px 1fr auto",
      gap: "0.75rem",
      alignItems: "flex-start",
      padding: "0.75rem",
      background: "var(--bg-surface)",
      border: "1px solid var(--border-subtle)",
      borderLeft: `3px solid ${kindStyle.borderColor}`,
      borderRadius: "3px",
      fontSize: "0.78rem",
    }}>
      <div style={{
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        color: "var(--accent)",
        fontSize: "1rem",
      }}>
        {phase.num}
      </div>
      <div>
        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{phase.name}</div>
        <div style={{ marginTop: "0.25rem", fontSize: "0.68rem", color: "var(--text-tertiary)", letterSpacing: "0.04em" }}>{kindStyle.label}</div>
      </div>
      <div>
        <div style={{ color: "var(--text-secondary)", lineHeight: "1.6" }}>{phase.summary}</div>
        {phase.notes && (
          <ul style={{ margin: "0.4rem 0 0 1rem", padding: 0, color: "var(--text-tertiary)", fontSize: "0.72rem", lineHeight: "1.6" }}>
            {phase.notes.map(n => <li key={n}>{n}</li>)}
          </ul>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {phase.actors.map(a => (
          <span key={a} style={{
            padding: "0.15rem 0.5rem",
            background: ACTOR_STYLES[a].bg,
            color: ACTOR_STYLES[a].color,
            border: `1px solid ${ACTOR_STYLES[a].color}`,
            borderRadius: "2px",
            fontFamily: "var(--font-mono)",
            fontSize: "0.68rem",
            textAlign: "center",
          }}>
            {ACTOR_STYLES[a].label}
          </span>
        ))}
      </div>
    </div>
  )
}

function CodexCard({ phase, shape, input, output, constraint }: {
  phase: string; shape: string; input: string; output: string; constraint: string;
}) {
  return (
    <div style={{
      padding: "0.9rem",
      background: "var(--bg-surface)",
      border: `1px solid ${ACTOR_STYLES.codex.color}`,
      borderRadius: "4px",
      fontSize: "0.76rem",
    }}>
      <div style={{ fontWeight: 700, color: ACTOR_STYLES.codex.color, marginBottom: "0.3rem" }}>{phase}</div>
      <div style={{ color: "var(--text-tertiary)", fontSize: "0.7rem", marginBottom: "0.6rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{shape}</div>
      <div style={{ display: "grid", gap: "0.4rem" }}>
        <FieldLine label="in" value={input} />
        <FieldLine label="out" value={output} />
        <FieldLine label="constraint" value={constraint} />
      </div>
    </div>
  )
}

function FieldLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: "0.4rem", lineHeight: "1.5" }}>
      <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>{label}</span>
      <span style={{ color: "var(--text-secondary)" }}>{value}</span>
    </div>
  )
}

function ArtifactCard({ path, purpose }: { path: string; purpose: string }) {
  return (
    <div style={{
      padding: "0.8rem",
      background: "var(--bg-surface)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "3px",
    }}>
      <div style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: "0.76rem", marginBottom: "0.4rem", wordBreak: "break-all" }}>
        {path}
      </div>
      <div style={{ color: "var(--text-secondary)", lineHeight: "1.6" }}>{purpose}</div>
    </div>
  )
}
