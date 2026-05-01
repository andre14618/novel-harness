---
status: active
updated: 2026-04-30
---

# Feature Expansion Todo

Forward-looking product ideas that are not in the active harness roadmap yet, but are plausible extensions of the current architecture.

## Audiobook Voice Tagging And Multi-Cast TTS

### Goal

Explore whether the harness can generate a speaker-tagged audio script from finished prose, then route narration and character dialogue to different TTS voices. This supports two modes:

- **Single-narrator performance mode** — one narrator voice receives per-character delivery/style hints.
- **Multi-cast production mode** — narrator and each character route to separate voice APIs or voice IDs, then audio segments are stitched into chapter audio.

### Current Codebase Fit

The harness already has several useful inputs:

- `characters.profile_json` stores `speechPattern` and `exampleLines`.
- `src/agents/writer/beat-context.ts` injects character voice hints into each beat prompt.
- `chapter_outlines.scenes[].characters` gives likely speakers per beat.
- `src/agents/tonal-pass/run.ts` already demonstrates paragraph-level post-processing and reassembly.
- `/api/novel/:id/beats` can recover per-beat prose from `llm_calls`, although approved chapter drafts store whole-chapter text only.

Missing infrastructure:

- No TTS/audio provider integration.
- No speaker-attributed transcript or audio-script schema.
- `chapter_drafts.prose` is raw text and loses span-level speaker structure.
- Reader/export paths render raw prose only.
- Dialogue detection exists only as rough quote-density logic in the tonal pass, not speaker attribution.

### Recommended Architecture

Do not embed production tags into canonical prose. Generate a sidecar audio script artifact:

```json
{
  "chapter": 1,
  "beatIndex": 4,
  "order": 17,
  "kind": "dialogue",
  "speaker": "Mara Venn",
  "text": "Not yet.",
  "voiceId": "provider_voice_id",
  "delivery": {
    "pace": "tight",
    "emotion": "suspicious",
    "volume": "low"
  }
}
```

This keeps prose clean while enabling JSON, SSML, TTS, and stitched audio exports.

### Work Items

- [ ] **V0 tagged script export** — add an `audio-script` pass/schema that segments prose into narration/dialogue, attributes speakers using beat candidates + prose tags, stores sidecar JSON, and exports JSON/SSML. Estimated difficulty: medium, 1-3 days.
- [ ] **V1 single-narrator style tags** — map `CharacterProfile` voice data into provider-neutral delivery hints for narration engines that can vary performance by character. Estimated difficulty: medium, 3-5 days.
- [ ] **V2 multi-cast TTS generation** — add per-character voice-casting config, provider integration, per-segment audio generation, caching, chapter stitching, and progress events. Estimated difficulty: medium-high, 1-2 weeks.
- [ ] **V3 production audiobook workflow** — add manual correction UI for speaker tags, dirty-segment regeneration, cost tracking, playback/preview UI, and provider abstraction. Estimated difficulty: high, 2-4+ weeks.

### Main Risk

Speaker attribution is the hard part. The beat plan narrows candidates, but natural prose still has ambiguous cases: alternating unattributed dialogue, action-before-speech paragraphs, multi-speaker exchanges, internal thoughts, and dialogue where pronouns are the only local attribution. Expect an LLM tagger plus deterministic validation; eventually add a human correction UI before treating output as audiobook-grade.

### First Milestone

Build the sidecar tagged-script export before touching audio generation. If speaker-tagged JSON/SSML is reliable on completed novels, multi-cast TTS becomes mostly provider integration and audio stitching rather than model uncertainty.

### Rough API Cost Estimate

Assumptions for audiobook costing:

- 1,000 prose words ~= 6,000 billable text characters including spaces.
- 1,000 prose words ~= 6.7 minutes of finished narration at 150 words/minute.
- Speaker-tagging LLM cost is effectively negligible beside TTS: usually under $0.01/chapter if done with a cheap structured model; the audio synthesis dominates.

Approximate high-end/current TTS costs as of 2026-04-30:

| Provider / model class | Public pricing basis | 1k-word chapter | 2k-word chapter | 5k-word chapter |
|---|---:|---:|---:|---:|
| ElevenLabs high-quality tiers | ~$0.17-0.18/min effective | ~$1.13-1.20 | ~$2.27-2.40 | ~$5.67-6.00 |
| Cartesia Sonic-3 | 15 credits/sec; plan-dependent ~$0.03-0.04/min | ~$0.20-0.27 | ~$0.40-0.53 | ~$1.00-1.33 |
| Deepgram Aura-2 | $0.030 / 1k chars | ~$0.18 | ~$0.36 | ~$0.90 |
| Google Chirp 3 HD | $30 / 1M chars | ~$0.18 | ~$0.36 | ~$0.90 |
| MiniMax Speech 2.8 Turbo / HD | $60 / $100 per 1M chars | ~$0.36 / ~$0.60 | ~$0.72 / ~$1.20 | ~$1.80 / ~$3.00 |
| Google Gemini TTS Flash/Pro class | token-priced audio, roughly $0.015-0.03/min plus tiny text input | ~$0.10-0.20 | ~$0.20-0.40 | ~$0.50-1.00 |
| OpenAI realtime audio used as TTS | output audio token-priced; rough ~$0.03-0.10/min depending model | ~$0.20-0.65 | ~$0.40-1.30 | ~$1.00-3.25 |

Multi-cast does not inherently multiply cost if each text segment is synthesized once. Cost still tracks total characters/minutes. It increases implementation complexity, provider calls, caching needs, and likely regeneration spend during QA. Budget 10-30% extra for retries, alternate takes, and corrected speaker tags during early experiments.

MiniMax-specific notes: `speech-2.8-hd` and `speech-2.8-turbo` support emotion controls, interjection tags, speed/volume/pitch, voice modification, system voices, cloned voices, and mixed timbre weights. The T2A HTTP API caps `text` at under 10,000 characters per request and recommends streaming for inputs over 3,000 characters, so audiobook chapters should be segmented anyway. Rapid voice cloning is listed at ~$1.50 per voice and voice design at ~$3 per voice.

## Brute-Force Branching And Multi-Candidate Draft Search

### Goal

Use cheap parallel API calls as a deliberate search strategy instead of asking one
LLM call to be the canonical novelist. The harness should be able to generate many
candidate premises, plans, chapter sketches, or beat drafts; validate them against
the same contract; then rank, compare, or present branches for human review.

This is a future feature, not an immediate runtime change. The active prerequisite
is a reliable plan-to-beat obligation contract and deterministic coverage
validation.

### What Has Merit

- **Parallel plan ideation** — generate 5-15 distinct outline concepts from the
  same premise/directives, then filter for promise clarity, causal escalation,
  character pressure, ending shape, and obligation coverage.
- **Parallel chapter/beat-contract variants** — for a locked story spine, generate
  multiple chapter skeletons or beat expansions, then select the one with the
  strongest mechanical coverage and dramatic turn structure.
- **Multiple beat drafts from the same obligation packet** — cheap and useful when
  the beat is important, but only if the candidates are judged against the same
  writer-visible obligations and continuity surface.
- **Branch-level drafting** — draft top-K full branches or chapters rather than
  parallelizing adjacent beats inside one canonical chapter.
- **Human review as selection, not micromanagement** — show the user meaningfully
  different branches and let them choose direction before expensive downstream
  drafting.

### Pushback / Risks

- Do not parallel-write dependent beats of one canonical chapter independently by
  default. Later beats depend on exact prior prose texture, transitions, reveals,
  and line-level commitments.
- More candidates do not help without a good validator. Brute force amplifies bad
  scaffolding if every branch shares the same hidden-metadata failure.
- LLM judges can collapse to average taste. Prefer deterministic filters first,
  pairwise/reasoning judges second, and human review for high-level taste.
- Do not use generic prose scores as the selector. Select on story promises,
  causal clarity, obligation coverage, novelty of direction, and concrete failure
  modes.
- Keep candidate generation branch-scoped. Avoid merging fragments from many
  branches unless a later synthesizer has an explicit plan-diff contract.

### Recommended Architecture

```text
premise/directives
  -> N concept/story-spine candidates
  -> deterministic contract validation
  -> cheap structural filters
  -> reasoning pairwise or tournament judge
  -> human branch picker or auto-select top K
  -> draft selected branch candidates
  -> obligation/adherence/entity checks
  -> compare or consolidate
```

The important distinction is **search over coherent branches**, not random
parallel prose chunks. Each branch should carry its own plan ID, obligation IDs,
surface fingerprint, cost, and verdict history.

### Work Items

- [ ] **V0 candidate plan sampler** — generate N story-spine/chapter-outline
  candidates for one seed, persist them as branch artifacts, and show compact
  branch summaries for review. Estimated difficulty: medium, 2-4 days after the
  obligation validator exists.
- [ ] **V1 deterministic branch filters** — score branch artifacts for schema
  validity, beat floor, obligation coverage, payoff integrity, orphan counts,
  overload counts, and unsupported new-entity pressure. Estimated difficulty:
  medium, 2-4 days.
- [ ] **V2 branch comparison harness** — add pairwise/tournament plan judging with
  quote-required rationale and stable branch metadata. Estimated difficulty:
  medium-high, 4-7 days.
- [ ] **V3 multi-draft beat/chapter candidates** — for selected high-value beats or
  chapters, generate multiple drafts from the same obligation packet and choose
  via deterministic checks plus pairwise comparison. Estimated difficulty:
  medium-high, 1-2 weeks.
- [ ] **V4 branch UI** — let the user compare branches, pin a direction, and either
  discard or preserve alternate branches as idea inventory. Estimated difficulty:
  high, 2-4 weeks.

### First Milestone

Build plan-branch sampling, not prose-branch sampling. It is cheaper, easier to
validate, and gives the human more leverage. Prose brute force should wait until
the planner can produce a complete writer-visible obligation contract.

## Prose Quality Improvement Track

### Goal

After the runtime contract is stable, improve the actual reading experience of the
drafted prose: sentence quality, scene vividness, emotional texture, dialogue,
pacing, paragraph rhythm, and anti-generic specificity. This should come after the
plan/obligation/runtime work because prettier prose cannot compensate for a weak
story contract, hidden state, or unfair checkers.

### Sequencing Rule

Do this after the active runtime items:

- reliable planner-authored beat obligations.
- deterministic obligation coverage validation.
- branch-level candidate plan search.
- stable current-surface checker calibration.
- basic branch/draft selection workflow.

### What Has Merit

- **Multi-draft prose search for important beats** — generate several candidate
  versions from the same obligation packet, then select for obligation completion,
  specificity, rhythm, and character voice.
- **Targeted prose pass, not full-chapter rewrite** — improve local weaknesses in
  paragraph/sentence windows while preserving accepted content and continuity.
- **Prompt/method sweeps before fine-tuning** — try established LLMs with better
  prompt shape, examples, beat-local constraints, candidate selection, and rewrite
  windows before spending on SFT/LoRA.
- **Voice and dialogue panels** — sample dialogue-heavy beats and compare speaker
  distinctiveness, subtext, and line-level tension.
- **Scene vividness variants** — ask for alternate sensory/physical grounding
  treatments for beats that pass obligations but read flat.
- **Corpus-informed prose diagnostics** — use published-fiction baselines to flag
  measurable AI tells without turning normal prose habits into false positives.

### Pushback / Risks

- Do not revive generic 1-10 prose judges. They have historically failed to
  discriminate useful differences.
- Do not run full-chapter LLM rewrites as the default quality fix; they introduce
  collateral drift and are usually worse than beat-level or paragraph-window
  rewrite/selection.
- Do not optimize prose before the plan contract is stable. High-quality sentences
  attached to a weak or incoherent plan are wasted spend.
- Do not let style checkers become story blockers. Prose-quality findings should
  guide selection or targeted revision, not override story logic.

### Work Items

- [ ] **V0 prose-quality rubric refresh** — define concrete, quote-required
  dimensions that survived prior lessons: specificity, dialogue pressure,
  physical grounding, sentence rhythm, POV texture, and cliché/AI-tell density.
  Estimated difficulty: medium, 2-4 days.
- [ ] **V1 multi-draft beat selector** — generate K candidate drafts for selected
  high-value beats from the same obligation packet, run deterministic checks, then
  compare survivors with pairwise reasoning. Estimated difficulty: medium-high,
  1-2 weeks.
- [ ] **V2 prompt/method sweep** — compare prompt variants, example/no-example
  modes, candidate counts, and established LLM routes on the same beat-obligation
  packet before considering fine-tuning. Estimated difficulty: medium, 3-5 days.
- [ ] **V3 targeted local revision pass** — revise only failing paragraphs or beat
  windows, preserving accepted prose outside the window. Estimated difficulty:
  medium-high, 1-2 weeks.
- [ ] **V4 prose A/B harness** — compare complete chapter/draft variants after the
  story contract passes, using pairwise reasoning plus human review. Estimated
  difficulty: medium-high, 1-2 weeks.
- [ ] **V5 human taste calibration set** — collect preferred/poor passages from
  generated drafts and use them to calibrate future selectors. Estimated
  difficulty: high, ongoing.

### First Milestone

Do not start with a global rewriter. Start with multi-draft selection on a small
set of important beats after the obligation validator is reliable. Selection is
safer than rewriting because bad candidates can be discarded without damaging the
accepted draft.
