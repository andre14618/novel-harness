/**
 * Public overview page — fully self-contained HTML, no React or app CSS dependencies.
 * Served at /overview without authentication.
 */

export function overviewPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Novel Harness — AI-Assisted Novel Creation</title>
<meta name="description" content="Deterministic code orchestrating open-weight LLMs to produce novel-length fiction with consistent characters, evolving relationships, and a coherent world.">
<meta property="og:title" content="Novel Harness">
<meta property="og:description" content="Deterministic code orchestrating open-weight LLMs to produce novel-length fiction.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* ═══════════════════════════════════════════════════════════════
   Novel Harness — Public Overview
   Terminal monospace throughout
   ═══════════════════════════════════════════════════════════════ */

/* ── Reset ──────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }

/* ── Tokens ─────────────────────────────────────────────────── */
:root {
  --bg: #06080d;
  --bg-card: #0b0e15;
  --border: #141821;
  --border-h: #1e2535;
  --tx: #b0b5c2;
  --tx-b: #e0e3ec;
  --tx-d: #6b7185;
  --tx-g: #363d4f;
  --accent: #4ecca3;
  --blue: #5b9cf5;
  --amber: #e8c547;
  --purple: #8b7ec8;
  --rose: #e7586a;
  --mono: 'IBM Plex Mono', 'Menlo', 'Consolas', monospace;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
}

body {
  background: var(--bg);
  color: var(--tx);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── Grain overlay ──────────────────────────────────────────── */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10000;
  opacity: 0.022;
  background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 200px 200px;
}

/* ── Layout ─────────────────────────────────────────────────── */
.wrap {
  max-width: 860px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* ── Header ─────────────────────────────────────────────────── */
.hdr {
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: rgba(6, 8, 13, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 100;
}
.hdr .wrap {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logo {
  font-family: var(--mono);
  font-weight: 600;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--accent);
  text-decoration: none;
}
.signin {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--tx-g);
  text-decoration: none;
  border: 1px solid var(--border);
  padding: 0.35rem 1rem;
  border-radius: 3px;
  transition: color 0.2s var(--ease), border-color 0.2s var(--ease);
  letter-spacing: 0.02em;
}
.signin:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* ── Hero ───────────────────────────────────────────────────── */
.hero {
  padding: 3.5rem 0 3rem;
  border-bottom: 1px solid var(--border);
}
.hero-flow {
  display: flex;
  align-items: center;
  font-size: 0.62rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--tx-g);
  overflow-x: auto;
  padding-bottom: 0.75rem;
  margin-bottom: 1.5rem;
  white-space: nowrap;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.hero-flow span { flex-shrink: 0; }
.hero-flow .arr { margin: 0 0.5rem; color: #1e2333; }
.hero-flow .end { color: var(--accent); }
.hero h1 {
  font-family: var(--mono);
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.7;
  letter-spacing: -0.01em;
  color: var(--tx-b);
  max-width: 620px;
}
.hero h1 em {
  font-style: normal;
  color: var(--accent);
  font-weight: 600;
}
.hero-desc {
  margin-top: 1rem;
  max-width: 540px;
  color: var(--tx-d);
  font-size: 0.82rem;
  line-height: 1.85;
}

/* ── Sections ───────────────────────────────────────────────── */
.sect {
  padding: 4.5rem 0;
  border-bottom: 1px solid var(--border);
}
.sect:last-child { border-bottom: none; }
.sect-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.75rem;
}
.sect-num {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--tx-g);
  flex-shrink: 0;
}
.sect-rule {
  width: 48px;
  height: 1px;
  background: var(--border);
  flex-shrink: 0;
}
.sect-title {
  font-family: var(--mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tx-b);
  letter-spacing: 0.02em;
}
.sect-body {
  max-width: 580px;
  font-size: 0.82rem;
  line-height: 1.85;
  color: var(--tx);
}

/* ── Pipeline ───────────────────────────────────────────────── */
.pipeline { margin-top: 0.5rem; }
.phase {
  border: 1px solid var(--border);
  border-left: 2px solid var(--c, var(--accent));
  background: var(--ca, rgba(78,204,163,0.03));
  padding: 1.5rem 1.5rem 1.25rem;
  border-radius: 2px;
  transition: border-color 0.25s var(--ease);
}
.phase:hover { border-color: var(--border-h); border-left-color: var(--c, var(--accent)); }
.phase-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.phase-badge {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--c, var(--accent));
  border-radius: 50%;
  font-size: 0.62rem;
  font-weight: 600;
  color: var(--c, var(--accent));
  flex-shrink: 0;
  box-shadow: 0 0 10px var(--ca, rgba(78,204,163,0.1));
}
.phase-head h3 {
  font-family: var(--mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tx-b);
}
.phase p {
  font-size: 0.78rem;
  color: var(--tx);
  line-height: 1.75;
  margin-bottom: 0.5rem;
}
.phase p:last-child { margin-bottom: 0; }
.phase-items {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.item {
  font-size: 0.75rem;
  line-height: 1.65;
  color: var(--tx);
}
.item .dash { color: var(--tx-g); font-weight: 500; }
.item strong { color: var(--tx-b); font-weight: 600; }
.item .dim { color: var(--tx-d); }

.phase-conn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.15rem 0;
  color: var(--tx-g);
  font-size: 0.75rem;
  line-height: 1.1;
  user-select: none;
}

/* ── Card grids ─────────────────────────────────────────────── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-top: 1rem;
}
.card {
  border: 1px solid var(--border);
  background: var(--bg-card);
  padding: 1.25rem;
  border-radius: 2px;
  transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.card:hover {
  border-color: var(--border-h);
  box-shadow: 0 0 24px rgba(78, 204, 163, 0.025);
}
.card h4 {
  font-family: var(--mono);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--tx-b);
  margin-bottom: 0.5rem;
}
.card p {
  font-size: 0.73rem;
  color: var(--tx-d);
  line-height: 1.7;
}

/* ── Skill cards ────────────────────────────────────────────── */
.skill-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-top: 1rem;
}
.skill {
  border: 1px solid var(--border);
  border-top: 2px solid var(--accent);
  background: var(--bg-card);
  padding: 1.25rem;
  border-radius: 2px;
  transition: border-color 0.2s var(--ease);
}
.skill:hover { border-color: var(--border-h); border-top-color: var(--accent); }
.skill h4 {
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 0.6rem;
  letter-spacing: 0.02em;
}
.skill-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.skill-list li {
  font-size: 0.72rem;
  color: var(--tx-d);
  line-height: 1.6;
  padding-left: 1rem;
  position: relative;
}
.skill-list li::before {
  content: "\\B7";
  position: absolute;
  left: 0;
  color: var(--tx-g);
  font-weight: 700;
}

/* ── Footer ─────────────────────────────────────────────────── */
.ftr {
  padding: 2.5rem 0 3rem;
  text-align: center;
}
.ftr-rule {
  display: block;
  color: var(--tx-g);
  font-size: 0.6rem;
  letter-spacing: 0.3em;
  margin-bottom: 1rem;
  opacity: 0.5;
}
.ftr p {
  font-size: 0.68rem;
  color: var(--tx-g);
}
.ftr a {
  color: var(--tx-d);
  text-decoration: none;
  transition: color 0.15s;
}
.ftr a:hover { color: var(--accent); }

/* ── Reveal animation ───────────────────────────────────────── */
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.65s ease, transform 0.65s var(--ease);
}
.reveal.vis {
  opacity: 1;
  transform: translateY(0);
}
.reveal.vis .phase,
.reveal.vis .card,
.reveal.vis .skill {
  animation: stagger-in 0.5s var(--ease) both;
}
@keyframes stagger-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.reveal.vis .phase:nth-child(1) { animation-delay: 0s; }
.reveal.vis .phase-conn:nth-child(2) { animation-delay: 0.06s; }
.reveal.vis .phase:nth-child(3) { animation-delay: 0.1s; }
.reveal.vis .phase-conn:nth-child(4) { animation-delay: 0.16s; }
.reveal.vis .phase:nth-child(5) { animation-delay: 0.2s; }
.reveal.vis .phase-conn:nth-child(6) { animation-delay: 0.26s; }
.reveal.vis .phase:nth-child(7) { animation-delay: 0.3s; }
.reveal.vis .phase-conn:nth-child(8) { animation-delay: 0.36s; }
.reveal.vis .phase:nth-child(9) { animation-delay: 0.4s; }
.reveal.vis .card:nth-child(1), .reveal.vis .skill:nth-child(1) { animation-delay: 0s; }
.reveal.vis .card:nth-child(2), .reveal.vis .skill:nth-child(2) { animation-delay: 0.08s; }
.reveal.vis .card:nth-child(3), .reveal.vis .skill:nth-child(3) { animation-delay: 0.16s; }
.reveal.vis .card:nth-child(4), .reveal.vis .skill:nth-child(4) { animation-delay: 0.24s; }

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 720px) {
  .wrap { padding: 0 1.25rem; }
  .hero { padding: 3rem 0 2.5rem; }
  .hero h1 { font-size: 1rem; }
  .sect { padding: 3.5rem 0; }
  .card-grid, .skill-grid { grid-template-columns: 1fr; }
  .phase { padding: 1.25rem; }
}
@media (max-width: 480px) {
  .hero { padding: 2.5rem 0 2rem; }
  .hero-flow { font-size: 0.55rem; }
  .sect { padding: 2.5rem 0; }
  .sect-title { font-size: 0.8rem; }
}
</style>
</head>
<body>

<!-- ── Header ──────────────────────────────────────────────── -->
<header class="hdr">
  <div class="wrap">
    <span class="logo">NOVEL HARNESS</span>
    <a href="/login" class="signin">Sign in ──&#x25B8;</a>
  </div>
</header>

<main>

  <!-- ── Hero ────────────────────────────────────────────────── -->
  <div class="wrap">
    <section class="hero reveal">
      <div class="hero-flow" aria-hidden="true">
        <span>seed</span><span class="arr">&#x2500;&#x2500;&#x25B8;</span>
        <span>concept</span><span class="arr">&#x2500;&#x2500;&#x25B8;</span>
        <span>planning</span><span class="arr">&#x2500;&#x2500;&#x25B8;</span>
        <span>drafting</span><span class="arr">&#x2500;&#x2500;&#x25B8;</span>
        <span>extraction</span><span class="arr">&#x2500;&#x2500;&#x25B8;</span>
        <span>validation</span><span class="arr">&#x2500;&#x2500;&#x25B8;</span>
        <span class="end">novel</span>
      </div>
      <h1>Deterministic code.<br><em>Open-weight models.</em><br>Novel-length fiction.</h1>
      <p class="hero-desc">
        An AI-assisted novel creation system where deterministic code controls the creative
        pipeline and LLMs serve as specialized function calls &mdash; never as autonomous agents.
      </p>
    </section>

    <!-- ── 01 Goal ───────────────────────────────────────────── -->
    <section class="sect reveal">
      <div class="sect-head">
        <span class="sect-num">01</span>
        <span class="sect-rule"></span>
        <span class="sect-title">Goal</span>
      </div>
      <p class="sect-body">
        Produce novel-length fiction that reads like it was written by a human author &mdash;
        with consistent characters, evolving relationships, and a coherent world &mdash; using
        only open-weight models orchestrated by deterministic code. No frontier models in the
        production loop. Every quality dimension is measurable and improvable without
        subjective scoring.
      </p>
    </section>

    <!-- ── 02 Pipeline ───────────────────────────────────────── -->
    <section class="sect">
      <div class="sect-head reveal">
        <span class="sect-num">02</span>
        <span class="sect-rule"></span>
        <span class="sect-title">Pipeline</span>
      </div>
      <p class="sect-body reveal" style="margin-bottom: 2rem;">
        A novel progresses through a state machine. Each phase uses specialized agents &mdash;
        one focused task per LLM call, with structured output schemas and deterministic
        validation. The code decides what happens next, not the model.
      </p>

      <div class="pipeline reveal">

        <div class="phase" style="--c: #5b9cf5; --ca: rgba(91,156,245,0.03)">
          <div class="phase-head">
            <span class="phase-badge">01</span>
            <h3>Concept</h3>
          </div>
          <p>Three parallel agents generate the foundation from a seed premise:</p>
          <div class="phase-items">
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>World-builder</strong> <span class="dim">&mdash; physical rules, history, power structures, cultures</span></div>
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>Character-agent</strong> <span class="dim">&mdash; motivations, speech patterns, relationships, secrets</span></div>
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>Plotter</strong> <span class="dim">&mdash; story spine with act structure and chapter-level arcs</span></div>
          </div>
        </div>

        <div class="phase-conn" aria-hidden="true"><span>&#x2502;</span><span>&#x25BC;</span></div>

        <div class="phase" style="--c: #4ecca3; --ca: rgba(78,204,163,0.03)">
          <div class="phase-head">
            <span class="phase-badge">02</span>
            <h3>Planning</h3>
          </div>
          <p>
            Each chapter is decomposed into <strong>beats</strong> &mdash; the atomic unit of writing.
            A beat specifies characters present, POV, setting, events that must occur,
            and world state changes. This is the contract the writer must fulfill.
          </p>
        </div>

        <div class="phase-conn" aria-hidden="true"><span>&#x2502;</span><span>&#x25BC;</span></div>

        <div class="phase" style="--c: #e8c547; --ca: rgba(232,197,71,0.03)">
          <div class="phase-head">
            <span class="phase-badge">03</span>
            <h3>Drafting</h3>
          </div>
          <p>
            Beats are written serially with minimal, focused context per call (~850 tokens in,
            ~400 tokens out). Each beat passes through a validation gauntlet:
          </p>
          <div class="phase-items">
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>Adherence checking</strong> <span class="dim">&mdash; deterministic character presence plus one bounded event-enactment call verifies prose fulfills the beat spec</span></div>
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>Chapter plan checking</strong> <span class="dim">&mdash; structural comparison of full chapter against planning output</span></div>
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>Continuity checking</strong> <span class="dim">&mdash; facts and character state verified against accumulated world state</span></div>
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>Functional state checking</strong> <span class="dim">&mdash; payoff graph invariants block, semantic planned-state grounding stays warning-class until calibrated</span></div>
            <div class="item"><span class="dash">&#x2500;&#x2500;</span> <strong>Lint</strong> <span class="dim">&mdash; ~26 deterministic patterns (clich&eacute;, hedging, emotional echo, rhythm) with per-sentence LLM rewrites</span></div>
          </div>
          <p style="margin-top: 0.6rem;">Failed beats retry with the failure reason injected as context. The chapter only advances when all checks pass.</p>
        </div>

        <div class="phase-conn" aria-hidden="true"><span>&#x2502;</span><span>&#x25BC;</span></div>

        <div class="phase" style="--c: #8b7ec8; --ca: rgba(139,126,200,0.03)">
          <div class="phase-head">
            <span class="phase-badge">04</span>
            <h3>Extraction</h3>
          </div>
          <p>
            After a chapter is approved, structured state is extracted from the prose and
            persisted to Postgres &mdash; facts, character emotional states, relationship changes,
            timeline events, knowledge propagation. This becomes the context source for
            subsequent chapters, replacing semantic retrieval with deterministic lookups.
          </p>
        </div>

        <div class="phase-conn" aria-hidden="true"><span>&#x2502;</span><span>&#x25BC;</span></div>

        <div class="phase" style="--c: #5b9cf5; --ca: rgba(91,156,245,0.03)">
          <div class="phase-head">
            <span class="phase-badge">05</span>
            <h3>Validation</h3>
          </div>
          <p>
            Validation is diagnostic-only. Runtime discipline now lives in drafting: targeted
            beat rewrites, continuity and functional state checks, and guarded lint fixes before
            approval. Tonal/voice LoRA generation is retired; old tonal rows remain archival only.
          </p>
        </div>

      </div>
    </section>

    <!-- ── 03 Design Principles ──────────────────────────────── -->
    <section class="sect">
      <div class="sect-head reveal">
        <span class="sect-num">03</span>
        <span class="sect-rule"></span>
        <span class="sect-title">Design Principles</span>
      </div>
      <div class="card-grid reveal">
        <div class="card">
          <h4>Beat-First Architecture</h4>
          <p>
            Writing happens at the beat level, not the chapter level. This keeps
            context windows small, makes failures cheap to retry, and gives each
            quality check a precise scope. A chapter is just the concatenation
            of its approved beats.
          </p>
        </div>
        <div class="card">
          <h4>Decomposed Validation</h4>
          <p>
            Complex checks are split into focused parallel calls &mdash; one question per call.
            A 14B model handling one dimension outperforms a 235B model handling five.
            This is the core insight that makes small-model pipelines viable.
          </p>
        </div>
        <div class="card">
          <h4>No Subjective Scoring</h4>
          <p>
            LLM judges with 1&ndash;10 scales showed 0&ndash;33% discrimination in benchmarks.
            Every quality gate uses structured pass/fail checks with specific, falsifiable
            criteria. If you can't define what "better" means precisely, you can't measure it.
          </p>
        </div>
        <div class="card">
          <h4>Multi-Provider Inference</h4>
          <p>
            Each agent slot independently selects the provider that wins for its shape.
            Creative writing on Cerebras, fast checks on Groq, fine-tuned adapters on
            W&amp;B Inference, deep reasoning on DeepSeek. No vendor lock-in.
          </p>
        </div>
      </div>
    </section>

    <!-- ── 04 Skills Applied ─────────────────────────────────── -->
    <section class="sect">
      <div class="sect-head reveal">
        <span class="sect-num">04</span>
        <span class="sect-rule"></span>
        <span class="sect-title">Skills Applied</span>
      </div>
      <div class="skill-grid reveal">
        <div class="skill">
          <h4>LLM Engineering</h4>
          <ul class="skill-list">
            <li>Multi-agent orchestration with structured output (Zod schemas)</li>
            <li>Prompt decomposition for small-model viability</li>
            <li>LoRA fine-tuning (SFT via W&amp;B ART on Qwen3 14B)</li>
            <li>Multi-provider routing (per-agent selection by latency/quality)</li>
          </ul>
        </div>
        <div class="skill">
          <h4>Backend</h4>
          <ul class="skill-list">
            <li>Bun runtime with TypeScript</li>
            <li>Postgres with pgvector (knowledge graph, world state)</li>
            <li>State machine architecture with deterministic control flow</li>
            <li>Real-time SSE event streaming for pipeline observability</li>
          </ul>
        </div>
        <div class="skill">
          <h4>Infrastructure</h4>
          <ul class="skill-list">
            <li>Self-hosted on Proxmox LXC containers</li>
            <li>Cloudflare Tunnel for public HTTPS</li>
            <li>Tailscale mesh for internal access</li>
            <li>systemd services with automated deploys (rsync + restart)</li>
          </ul>
        </div>
        <div class="skill">
          <h4>Quality Engineering</h4>
          <ul class="skill-list">
            <li>Experiment tracking with cost analysis and commit diffs</li>
            <li>Deterministic lint system (~26 patterns from craft literature)</li>
            <li>Fine-tune distillation pipeline (oracle &rarr; synthetic data &rarr; SFT &rarr; validate)</li>
          </ul>
        </div>
      </div>
    </section>

  </div>
</main>

<!-- ── Footer ────────────────────────────────────────────────── -->
<footer class="ftr">
  <span class="ftr-rule" aria-hidden="true">&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</span>
  <p>Built by <a href="https://andrehansel.dev">Andre Hansel</a>. Self-hosted on Proxmox. Served via Cloudflare Tunnel.</p>
</footer>

<script>
document.addEventListener('DOMContentLoaded', () => {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('vis'));
    return;
  }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('vis');
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => obs.observe(el));
});
</script>

</body>
</html>`
}
