# L38 Investigation — Chapter-2 continuity bails on prior-chapter state propagation

**Date:** 2026-05-02
**Trigger novel:** `novel-1777721066908` (heretic seed, L41-val smoke)
**Verdict:** Diagnosis complete; multiple candidate fixes identified; ready to design.

## The bail

L41-val ch2 bailed at plan-assist gate on 5 continuity blockers (see L41-val log `/tmp/smoke-l41val-heretic-1777721066.log`). The 5 issues:

1. "Maret's internal monologue shows she only now discovers the stat override, contradicting her having compiled a file on anomalies for years."
2. "Maret is only now finding this sealed report, contradicting her having copied it months ago."
3. "Maret is searching for the redacted name in the temple archives, not retrieving a hidden file from the guildhall."
4. "The summons was for Maret specifically, not all scribes with access."
5. "Cassel notices calluses, not ink smudges, and does not mention iron bars."

## Where the data says the disconnect is

### CH1 plan declared (per `chapter_outlines` row for ch1)

establishedFacts:
- `fact-maret-anomaly-file`: "Maret has been secretly compiling a file on System anomalies for years."
- `fact-sealed-report-exists`: "A sealed report that should not exist was copied by Maret months ago and is linked to the Arbiter's arrival."
- `fact-file-hidden-location`: "Maret's anomaly file is hidden under a loose floorboard in the guildhall archives."
- `fact-cassel-targeting-sensitive-records`: "Arbiter Cassel requested to see all scribes with access to sensitive records."
- `fact-ink-smudges-observed`: "Arbiter Cassel noticed ink smudges on Maret's hands."

ch1 characterStateChanges → Maret `knows`: ["Arbiter arrived", "sealed report linked", "Cassel noticed smudges"]

### CH2 plan declared (per `chapter_outlines` row for ch2)

establishedFacts:
- `fact-sealed-system-log-in-temple-archives`: "There is a sealed System log in the temple archives" *(separate document from ch1's sealed report)*
- `fact-log-records-intentional-override-eight-years-ago`: "The sealed log records a deliberate stat override performed eight years ago"

ch2 beat 0–3 descriptions dramatize Maret arriving at the High Temple for a stat-validation test (different setting, different document, different framing).

### Where the breakdown actually is

The 5 blockers split into three classes:

**Class A — Planner intent vs writer execution (writer ignored planner intent):**
- Blocker 2: CH2 plans the temple-archive sealed log as a separate document; writer's prose conflates it with CH1's "sealed report copied months ago."
- Blocker 3: CH2 setting is High Temple; writer drafts Maret in the guildhall archives (CH1's setting) hunting for the redacted name.
- Blocker 5: CH1 establishedFact says ink smudges; CH2 writer wrote calluses + iron bars (different observation tokens).

**Class B — Planner-side scope change (planner contradicted CH1):**
- Blocker 4: CH1 fact says Cassel asked for "all scribes with sensitive records access." CH2 dramatizes the summons as Maret-specific. The planner narrowed the scope.

**Class C — Possible checker overreach:**
- Blocker 1: "compiled a file on anomalies for years" → checker reads this as "Maret knows about every anomaly including this specific one." Could be a legitimate fire (Maret should be less surprised by a stat override) or an over-eager generalization.

## Why this is happening — the architectural finding

The production `buildBeatContext` (`src/agents/writer/beat-context.ts`) emits a `BeatContext` whose user-prompt surface contains:

- `beatSpec` (current-chapter beat data + current-chapter `establishedFacts`)
- `transitionBridge` (last 3 sentences of *previous beat's* prose)
- `landingTarget` (next beat's first sentence)
- `characterSnapshots` (voice + state + with-pov)
- `resolvedReferencesText`
- `setting`

**Missing from production:**
- Cumulative establishedFacts from chapters 1..N-1
- Per-character `knownFacts` aggregated across prior chapters
- Chapter 1 summary (`chapter_summaries` table is **EMPTY** for this novel — the bridging signal isn't being written)

There IS an `enriched-context.ts` module that builds a `READER-INFO STATE` block aggregating prior-chapter establishedFacts and per-character `doesNotKnow` lists. But it is "DELIBERATELY not imported from any production code path" (its own header comment) — it's a parity-harness preflight artifact only.

So: when the writer drafts CH2 b0..b3, they do NOT see "Maret has been compiling a file on anomalies for years" or "Maret already copied the sealed report months ago" or "Cassel noticed ink smudges." The writer is improvising from the per-chapter brief alone, which dramatizes events as fresh.

Persistence audit (corrected): `character_states.state_json` for ch1 of this novel correctly contains `knows: ["Arbiter arrived", "sealed report linked", "Cassel noticed smudges"]` for Maret and `knows: ["Maret's stats match records", "ink smudges on her hands"]` for Cassel. My initial query against `state_json.knownFacts` returned empty because the actual JSONB key is `knows` (matching `CharacterState.knows: string[]` in `src/types.ts:44`), not `knownFacts`. So the persistence layer is fine; the data IS in the database. The gap is purely on the writer-context side: the data exists, but `buildBeatContext` doesn't surface it to the prompt.

## Candidate fixes

| # | Fix | Layer | Cost | Effect |
|---|-----|-------|------|--------|
| A | Wire `enriched-context.ts` READER-INFO STATE into production `buildBeatContext` | writer-context | medium (un-gate + parity test) | Closes Class A blockers (most of them). Writer sees prior-chapter facts and per-character `doesNotKnow`. |
| B | Pass prior-chapter establishedFacts into chapter-N planner's context so chapter-N plan doesn't contradict | planner-context | medium | Closes Class B (planner re-deriving wrong scope). |
| C | Surface CH1 chapter_summary row to ch2 planning + writing | summarization wiring | unknown — need to find why summaries are empty for this novel | Foundational; would help both A and B. |
| E | Continuity-checker calibration on Class-C edge ("compiled file on anomalies" → does that imply knowledge of THIS specific override?) | checker prompt | small probe | Reduces FP rate; doesn't address Classes A+B. |

(Original D — "audit `character_states.knownFacts` persistence" — was withdrawn after re-querying the actual JSONB shape. Persistence is fine; key is `knows`, not `knownFacts`. My earlier empty-result was a query-side typo.)

## Recommended ordering

1. **A (medium)** to close Class A. Data already persisted (verified); needs the prompt-surface wiring + parity test.
2. **C** to investigate why `chapter_summaries` is empty (likely a separate wiring gap; orthogonal to A but high-leverage).
3. **B** for Class B blockers — only after A's effect is measured. May be partially addressed by A if the planner-context layer also gains prior-chapter facts.
4. **E** as a calibration probe; not a behavioral fix.

## Acceptance criterion for "L38 closed"

A heretic re-smoke (or any seed re-smoke that triggers a multi-chapter run) where:
- Continuity checker fires zero blockers in chapter 2 of the form "X contradicts prior chapter state."
- OR if it fires, the writer-side retry succeeds within standard 3-attempt budget.

## Evidence references

- L41-val novel: `novel-1777721066908`, ch2 bail log at `/tmp/smoke-l41val-heretic-1777721066.log`.
- ch1 outline + ch2 outline: `chapter_outlines` table, full JSON queried 2026-05-02.
- ch1 character_states for Maret + Cassel: `knows` correctly populated (verified by re-query); persistence is fine. The data exists in the DB but is never surfaced to the writer's prompt.
- `chapter_summaries` table: NO row for this novel.
- `enriched-context.ts` header comment confirms it's not in production path.
- `beat-context.ts` slot list confirms no cumulative-prior-facts surface.

## Why not ship a fix today

L38 is architectural. The cheapest meaningful intervention (A: un-gate enriched-context) requires a parity test to confirm prompt-cache impact, plus a deploy. The persistence bug (D) requires reading a few more files and aligning schema keys. Neither is a 1-line change. Better to bank the diagnosis and design carefully than to rush a partial fix that introduces new prompt drift.
