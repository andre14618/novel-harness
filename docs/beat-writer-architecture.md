---
status: superseded
superseded-by: docs/decisions.md "Writer LoRA runtime route removed" (exp #272, 2026-04-30) and the post-2026-04-21 fine-tune-free direction
updated: 2026-04-16
---

# Beat-Writer Architecture — Constraint-Load Design

> **Superseded 2026-05-01:** This design thread was anchored on a 14B writer-LoRA runtime that no longer exists. Salvatore writer-LoRA routing, tonal/voice LoRA generation, and the corpus-leak checker were retired from runtime in exp #272 (2026-04-30). The current beat writer is DeepSeek V4 Flash with the base beat-writer prompt and full runtime context; the "push complexity upstream" thesis is now expressed through planner stable-IDs and writer-visible beat obligations rather than writer-side fine-tuning. Treat the analysis below as historical background.

Living design doc capturing the thread from the 2026-04-16 session. Thesis: the beat writer is being asked to juggle too many constraints for a 14B LoRA, and the fix is to strip, consolidate, and push complexity upstream (to the planner) rather than downstream (to the writer).

Ties together several conclusions from `docs/voice-lora-salvatore.md`, `docs/pipeline-14b-consolidation.md`, and the v3 probe (exp #199) + 18-brief Phase C.3 comparison.

---

## 1. The problem — diagnosed 2026-04-16

v3 probe on `fantasy-echo-mage` got chapters 1 and 2 through on second-round retries but failed on chapter 3 after 6 attempts across 2 restart rounds. Chapter 3's blocker: continuity violation — writer pulled `Helix` into a tower scene when the plan had Helix at the extraction point. Helix wasn't in the beat's listed characters.

**This is a writer-adherence bug, not a voice bug.** Caught by continuity checker, but the writer made the mistake. Adding a smarter planner doesn't fix it — the plan correctly excluded Helix. The writer ignored that.

### 18-brief Phase C.3 comparison

With n=18 original-character briefs:

| | Δ-sum (cell, delta-of-means) | Δ-sum (per-row avg) | per-row std |
|---|---:|---:|---:|
| v2 | 0.283 | 1.324 | 0.415 |
| **v3** | 0.209 | 1.343 | 0.526 |
| v4 (1 epoch) | 0.310 | — | — |
| v5 (no rename aug) | 0.295 | — | — |

The cell metric (0.209) makes v3 look cleanly better. Per-row (1.343) shows v3 roughly tied with v2 with **higher variance** (std 0.526 vs 0.415). Some beats land great, others land wild. Sensory density swings 0.3 to 2.8+ (std 1.21).

**Variance is the real story.** v3 is not a clear voice-quality win over v2; it's a production-integration win (probe reaches chapter 3, retries converge on chapters 1-2).

### What the writer is being asked to do, per beat

Nine constraints in a single forward pass:

1. Write in Salvatore voice
2. Execute the beat's dramatic function
3. Use exactly the listed characters, not others
4. Not echo the transition bridge (trained in v3)
5. Land toward the landing target
6. Respect character emotional/relationship state
7. Avoid trained lore (Drizzt/Underdark/etc.)
8. Avoid AI-fiction patterns
9. Hit ~100-300 words

14B instruction-tuned base reliably handles 3-5 constraints; beyond that, one-shot misses compound. The voice LoRA concentrates capacity on #1 (and partially #2). Everything else crowds it out.

---

## 2. Strip strategy — what's load-bearing given a solid beat outline

Evaluated every field in `src/agents/writer/beat-context.ts::buildBeatContext`. Rule: "would removing this field change the prose given the beat description is already solid?"

### Per-character CHARACTERS section — strip 6 of 8 fields

Today (production):
```
{Name}:
  Voice: {speechPattern}           ← keep
  Drives: {goals}                  ← keep
  Avoids: {avoids}                 ← STRIP (negative space, rarely load-bearing)
  Conflict: {internalConflict}     ← STRIP (overlaps with Drives)
  State: {emotionalState}          ← STRIP (redundant with tone/beat description)
  With {pov}: [trust] dynamic      ← STRIP (runtime, not in v3 training, rarely load-bearing)
    Tension: {tension}             ← STRIP (same)
  Doesn't know: {first 2}          ← STRIP (planner bakes into summary when crucial)
```

Collapsed to one line per character:
```
CHARACTERS:
{Name}: {Voice} — {Drives}
```

Example: `Senna: Precise, clipped; a scarred catalog of spells. — Prove she can still absorb one more.`

From ~12 lines → 1 line per character. 3-character scene: ~36 lines → ~3 lines.

### Other fields

| field | verdict |
|---|---|
| BEAT N of M | keep (pacing) |
| POV | keep |
| Setting: (inline) | keep |
| beat.description | keep (THE beat) |
| Characters present | keep (adherence-checker uses it) |
| TRANSITION BRIDGE (non-scene-start) | keep (v3 training fixed regurgitation) |
| LANDING TARGET | keep (1 line, pacing hint) |
| Resolved references | strip when empty (conditional) |
| SETTING: block at bottom | strip duplicate of inline Setting:; keep only `Sensory:` line when non-empty |

### Token budget

User prompt drops from ~800–1000 tokens to ~500–700 per beat. ~30% more attention budget for the beat-description and bridge.

---

## 3. The deeper move — planner authors per-beat drives

*2026-04-16 (Andre)* — observation that the planner should emit situational per-beat drives instead of the writer translating stable character traits into beat-specific actions.

Today's pattern (stable trait):
- `character.speechPattern`: "Formal, measured"
- `character.goals`: "Live with honor on the surface despite his drow heritage"
- **Writer** has to translate → what does this character want *in THIS scene*?

Proposed pattern (per-beat drive):
- Planner emits, as part of the beat brief:
  - `Senna this beat: trying to absorb Reseth's final spell without being erased`
  - `Vorlis this beat: watching for the handler signal and preparing to bolt`
- **Writer** gets situation-specific drives; less translation work.

Why this is a bigger deal than it looks:
- Writer capacity freed for prose quality, not character-situational inference
- Planner has full-chapter context; writer only sees the current beat. The translation should happen where the context is.
- Per-beat drive is one line of plan output. Cheap for the planner; expensive for the writer to reconstruct.
- Mirrors how human novelists think ("what does this character want from THIS scene").

This is a planner-side change (new field in the beat output schema), not a writer-side change. Orthogonal to the compact-context work but natural extension: once we strip runtime state, the per-beat drive lives in its place, authored by a smart model upstream.

**Status:** Proposal. Not implemented yet. Implementation gate: see whether compact-context alone moves probe success rate first.

---

## 4. Implementation plan

### Compact mode (ship now)

Single commit in `src/agents/writer/beat-context.ts`:

- Add `compactMode?: boolean` to `BeatContextInput`
- When compact:
  - `formatCharacterSnapshot` → one line per character (`{Name}: {voice} — {goals}`)
  - Skip `State`, `With`, `Tension`, `Doesn't know` lines
  - Skip duplicate SETTING section; keep `Sensory:` when available and non-empty
  - Skip empty resolved-references string
- Compact mode only activates when `resolveWriterPack(genre)` returns a pack (voice LoRA route); DeepSeek writer stays on full context.

Exit criteria: v3 probe re-run with compact context shows:
- Same or better voice fidelity
- Same or better chapter-3 adherence rate
- Ideally: chapter 3 converges with same/fewer retries

### Planner-authored per-beat drives (proposal)

Defer until compact-mode probe lands. If compact alone fixes chapter 3, we may not need this layer. If not, we gain:
- New `per_beat_drives: { [charName]: string }` field in `ChapterOutline.scenes[].brief`
- Planning-plotter prompt gets an extra instruction: "for each character in the beat, author a one-line drive specific to this beat"
- `beat-context.ts` reads per-beat drive when present; falls back to stable character.goals otherwise

---

## 5. Open architectural questions

### Decomposition vs simplification

**Simplification** (this doc): fewer fields, tighter plans, write in one pass. Cheaper per beat. Works if 14B can handle the simpler shape.

**Decomposition** (considered earlier): two-pass writing — smart-model plotter-writer produces neutral-voice adherent prose; 14B voice-polish rewrites it in Salvatore voice. More expensive per beat (~2× calls) but each call is narrower.

We're betting on simplification first. If compact mode + planner-drives still doesn't make the 14B writer reliable enough, decomposition becomes the next architectural move.

### When to stop stripping

Some fields that *feel* removable are load-bearing in specific cases:
- `Tension` matters when a scene's whole point is the fissure between two characters
- `Doesn't know` matters in dramatic-irony scenes
- `Avoids` matters in characters whose behavior is defined by what they refuse to do

For those cases, the planner should be authoring the critical detail into the **beat description or per-beat drive**, not relying on the character sheet being threaded through. That's the cleaner pattern: load-bearing information appears in the beat, not in a separately-assembled character sheet.

### Plan granularity — real fiction uses ≤3 active named characters per beat

*2026-04-16 (Andre)* — observation: the planner is emitting beats with 4+ named characters all taking active roles. Real fiction rarely does this. Natural structure:
- **1 POV character** + typically 1-2 antagonists / interlocutors actively speaking or acting
- **Collective nouns** for groups: "the guards," "the wererats," "the army," "the cultists." The writer doesn't juggle individual identities for a group.
- **Named characters present but passive** = marginal — they can be off-page or referenced without being individuated

Our chapter-plan-checker defines "required fact" as anything the planner established. That compounds: planner names 5 characters → 5 voice snapshots → 5 required behaviors → writer must juggle. Real authors don't plan that way. They pick the 2-3 who matter and aggregate the rest.

**Planner-side principle to enforce (proposed):**
- Max 3 **named active** characters per beat
- Any additional characters in scene become a **collective noun** in the brief ("the extraction team," "the tower's cultists")
- Planner prompt gets an explicit instruction + CRITICAL marker (235B-class models need bad examples to follow non-obvious constraints per `docs/lessons-learned.md`)

This is orthogonal to the writer-side strip and per-beat-drives work — it operates upstream at the plan stage, making beats inherently easier to execute.

### Tiered escape-valve architecture

*2026-04-16 (Andre)* — third major proposal: a two-tier writer stack.

- **Tier 1 (default, cheap):** Qwen3-14B + voice LoRA on W&B Inference. Handles the common case at ~$0.003/chapter.
- **Tier 2 (escape valve, on-demand):** a mid-size (32B–200B) voice-tuned model on GPU rental (RunPod / Modal), invoked when Tier 1 fails a beat after N retries. ~$0.05–0.20/chapter when fired.

Why a self-hosted mid-size rather than DeepSeek SaaS as the escape valve:
- **Own the voice tuning.** DeepSeek V4 Flash SaaS can't be voice-LoRA'd; Tier 2 should preserve voice quality, not just adherence.
- **Cheaper per call at sustained throughput** than DeepSeek on output-heavy workloads.
- **Flexibility** to swap base model as the open-weights landscape evolves.

Candidate Tier 2 bases:
- **Qwen3-32B dense** (Groq has it; could rent + tune)
- **Qwen3-30B-A3B** (W&B has it — though cold-start earlier; MoE with 3B active params)
- **Qwen3-235B A22B** (larger MoE, more capability; Cerebras already serves it)
- **Llama 3.3 70B** (well-supported on RunPod/Modal)

**When to invoke Tier 2:** trigger after ≥2 failed drafting-phase restarts for a specific chapter. Tier 2 takes over for remaining attempts. Failing chapters are the minority (probably <10% of chapters), so the marginal rental cost stays low. Amortizes GPU keep-warm cost across many novels per hour.

**Status:** Proposal only. Gated on proving Tier 1 alone can't reach production reliability on diverse seeds. If compact-context + planner granularity + per-beat drives get Tier 1 to ~90% chapter approval rate, we may not need Tier 2. If we're stuck at ~60%, Tier 2 becomes the path.

### Tonal range vs capability ceiling

v3 works for chapters where the beat has 1–2 characters and 1–2 required events. Chapter 3 in the probe had complex climactic beats (Senna absorbing a reality-warping spell, Helix appearing for extraction, Reseth's monologue) — 4+ characters, 3+ events per beat. That's where it struggled.

If after compact mode we still see "simple beats work, complex beats fail," the diagnosis is capability ceiling, not context noise. Resolution would be one of:
- **Shrink beats at plan time** (smaller units, more of them)
- **Decompose per §5.1** above
- **Accept the ceiling** and keep voice LoRA for single-character interiority / two-character dialogue scenes, bigger writer for multi-character climaxes

---

## 6. Running decisions / thread history

Keep this section as a bullet log so anyone picking this up cold can follow the thread.

- **2026-04-16** — v3 shipped (exp #196), initial Phase C.3 alarmed on 5-gram Jaccard 0.822 → diagnosed as eval contamination, clean val shows 0.023 max (well below v2's 0.033). v3 generalizes normally.
- **2026-04-16** — v3 original-mode Δ-sum regressed to 0.99 (n=6) but on expanded 18-brief set drops to 0.21, slightly beating v2's 0.28. Per-row picture: variance is the real story, not centroid shift.
- **2026-04-16** — v4 (1 epoch) + v5 (no rename aug) parallel retrains both regress vs v3. The v3 recipe is the right recipe; the data/epochs aren't too much.
- **2026-04-16** — v3 probe reaches chapter 3 (v2 died on chapter 2). Chapter 3 fails on continuity issue (writer added character not in brief). Diagnosis: writer-adherence bug, not voice bug.
- **2026-04-16** — 9-constraint analysis. Decision: strip non-load-bearing fields from writer prompt for voice-LoRA route. Compact mode spec'd.
- **2026-04-16** — Per-beat drives proposal from Andre. Defer until compact-mode probe lands.
- **2026-04-16 · exp #200** — Compact-mode probe **REGRESSED**. Chapter 1 failed 3 rounds × 3 attempts = 9 total attempts, worse than standard v3 (5 attempts to pass). Root cause: aggressive strip removed load-bearing information flow from planner → writer:
  - `Avoids:` field was carrying per-chapter planner requirements (e.g., "Senna avoids mirrors"). Writer then had Senna look in a mirror, failing the chapter-plan check on that required fact.
  - Resolved-references (stripped entirely in compact mode) expanded named entities with knowledge-graph facts (e.g., "Tower of Reseth" → "[built atop a dormant fault line that activated six years ago]"). Writer couldn't establish the fault-line backstory because the fact wasn't in the prompt.
  - Continuity checks passed across all attempts — so stripping wasn't causing character drift. It was causing **required-fact misses** (a plan-check failure mode, not a continuity-check one).
  - Conclusion: constraint count isn't the bottleneck; **planner-declared facts that live in character-sheet fields** are load-bearing because the planner uses those fields as a side-channel to require prose behaviors. Stripping those fields severs the side-channel.
  - Next move: revise strip to be **narrower** — keep Avoids + resolved references. Strip only State/With/Tension/Doesn't-know (genuinely runtime-only, rarely load-bearing) and the duplicate SETTING block. Re-probe.
- **2026-04-16 · exp #201 — VICTORY.** Narrow-strip v3 probe on `fantasy-echo-mage` passed **all three chapters in 5 total attempts**: ch1 attempt 1, ch2 attempt 1, ch3 attempt 3. Compare: exp #199 (v3 full ctx) needed 5 for ch1 + 4 for ch2 + failed ch3; exp #200 (aggressive strip) failed ch1 in 9 attempts. **The narrow strip was the right balance.** v3 voice LoRA does not have a hard capability ceiling on complex beats — it was context-noise-bound, not capability-bound. Per-beat-drives / plan-granularity / tiered-escape-valve proposals all deferred; they're potential future cleanups but not needed for production viability.
- **2026-04-16 · exp #202 — ABORTED.** Howard-primer diagnostic probe; killed after Andre's directive to retire Howard methodology. Superseded by exp #201 verdict anyway (narrow strip worked, so the DeepSeek-capability diagnostic wasn't needed).
- **2026-04-16 — Howard methodology RETIRED.** Salvatore becomes the only primer we maintain; per-genre voice LoRAs replace universal primer. See `docs/decisions.md` "Howard primer/tonal-pass methodology retired" for scope.
- **2026-05-01 — writer LoRA runtime routing RETIRED.** The Salvatore LoRA path is now historical; fantasy seeds supply planner structural priors only, and all genres use the base DeepSeek V4 Flash beat-writer route. See `docs/decisions.md` "Writer LoRA runtime route removed; fantasy now supplies structural priors only".

Each new probe + result gets a line here.

---

## 7. Pointers

- Writer-side context builder: `src/agents/writer/beat-context.ts`
- Writer routing: `src/models/roles.ts::WRITER_GENRE_PACKS` + `resolveWriterPack`
- System prompt (v3-current): `src/agents/writer/beat-writer-system-salvatore.md`
- Planning-plotter (would author per-beat drives): `src/agents/planning-plotter/`
- Voice LoRA post-mortem: `docs/voice-lora-salvatore.md` §8 (v2 probe) + §9 (v3 + eval infra)
- 14B consolidation tier reframe: `docs/pipeline-14b-consolidation.md` Tier 4
- Eval infrastructure: `docs/eval-infrastructure.md`
- Lessons: `docs/lessons-learned.md` — "Voice LoRAs must train on the prompt shape they'll see in production" (2026-04-16)
