# L12: Expanded Synthetic Hallucination Panel — Per-class Matrix

**Date:** 2026-05-01  
**Experiment:** #327  
**phase_eval_runs.id:** 73  
**Checker:** halluc-ungrounded v1 + NER prepass (AND-gate, production default as of exp #322)  
**Script:** `scripts/hallucination/run-expanded-class-panel.ts`  
**Panel:** `scripts/hallucination/expanded-fail-classes-panel.jsonl`  
**Results:** `/tmp/expanded-class-panel-results.20260502T041940.jsonl` (on LXC)  
**Cost:** $0.0027 total (DeepSeek V4 Flash, 27 fixtures × ~$0.0001 each)

---

## 1. Panel Composition

27 fixtures across 7 classes:

| Class                     | FAIL rows | PASS controls | Total |
|---------------------------|-----------|---------------|-------|
| title-surname             | 3         | 1             | 4     |
| named-institution         | 3         | 1             | 4     |
| named-place-realm         | 3         | 1             | 4     |
| named-artifact            | 3         | 1             | 4     |
| named-historical-event    | 3         | 1             | 4     |
| plural-faction            | 3         | 1             | 4     |
| generic-document-fp-control | 0       | 3             | 3     |
| **TOTAL**                 | **18**    | **9**         | **27** |

All FAIL fixtures introduce named entities that are absent from every grounded source
(bible, from_brief, derived_outline_fact, derived_prior_beat, allowed_new_entities).
All PASS controls have the named entity present in at least one grounded source.
The generic-document-fp-control class contains 3 known FP-cluster phrases (from exp #304)
that must NOT fire on either NER or LLM.

Setting: Civic-fantasy bureaucratic drama. Single POV character (Cassel), consistent
world-bible (Civic Archive, Lowport, the Vaulted Quarter, the Watch).

---

## 2. Per-class Recall/Precision Matrix

Checker configuration: v1 + NER prepass (AND-gate). Final `pass` = NER fires ∩ LLM fires
(blocker) OR NER-only-warning OR LLM-only-blocker.

| class                       | N_fail | N_pass | TP | FP | FN | TN | recall | precision | F1   |
|-----------------------------|--------|--------|----|----|----|----|---------|-----------+------|
| title-surname               | 3      | 1      | 3  | 0  | 0  | 1  | 100%    | 100%      | 100% |
| named-institution           | 3      | 1      | 3  | 0  | 0  | 1  | 100%    | 100%      | 100% |
| named-place-realm           | 3      | 1      | 2  | 0  | 1  | 1  | 67%     | 100%      | 80%  |
| named-artifact              | 3      | 1      | 2  | 0  | 1  | 1  | 67%     | 100%      | 80%  |
| named-historical-event      | 3      | 1      | 3  | 0  | 0  | 1  | 100%    | 100%      | 100% |
| plural-faction              | 3      | 1      | 2  | 0  | 1  | 1  | 67%     | 100%      | 80%  |
| generic-document-fp-control | 0      | 3      | 0  | 0  | 0  | 3  | —       | —         | —    |
| **TOTAL**                   | **18** | **9**  | 15 | 0  | 3  | 9  | **83%** | **100%**  | **91%** |

- **FP = 0 across all classes** — no grounded pass controls were incorrectly flagged.
- **Generic-document FP controls: 0 fires** — all 3 known FP phrases ("the reconciliation
  report", "the porter's testimony", "the master archivist") passed cleanly on both NER
  and LLM. The FP guard from exp #304 holds.

---

## 3. Residual FN Analysis

3 missed hallucinations (FN), all doubles (both NER and LLM passed):

### FN 1: `named-place-fail-02` — "Crown of Hyran"

```
prose: The Envoy had come from the Crown of Hyran — a realm Cassel understood only in
       the abstract...
```

**Root cause:** "Crown of Hyran" uses an "X of Y" connector pattern with a lowercase
preposition. NER's `capitalized-multi-word` extractor uses consecutive-capitalized-word
detection; "of" breaks the sequence. The `suffix-class` extractor doesn't fire because
"Hyran" is not a known suffix and "Crown" is a common English word. LLM also missed it —
likely because "Crown" is ambiguous (it could be a generic noun).

**Structural gap:** `X of Y` realm/artifact names where X is a common noun (Crown, Vale,
Sigil, etc.) are a blind spot for both NER and LLM. The LLM system prompt does list
"named places, regions, cities, holds, kingdoms, realms, dominions" as FAIL candidates,
but the capitalisation pattern doesn't trigger sufficient LLM attention at temp=0.1.

### FN 2: `named-artifact-fail-03` — "the Sigil of Eight"

```
prose: The argument hinged on whether possession of the Sigil of Eight constituted legal
       authority...
```

**Root cause:** Article-prefixed ("the") + "X of N" pattern. NER does not extract
article-prefixed phrases. "Eight" is a number-word — the NER suffix-class list doesn't
include numeric ordinals. LLM missed it entirely (no LLM issues returned).

**Structural gap:** Article-prefixed named artifacts using "the N of X" patterns with
number-word tails are invisible to NER and have below-threshold LLM salience at T=0.1.

### FN 3: `plural-faction-fail-03` — "the Veiled Eight"

```
prose: The Veiled Eight had not been an official body for sixty years — dissolved by
       charter after the scandals of the reform era...
```

**Root cause:** Article-prefixed faction name where the second word is a number-word
("Eight"). NER doesn't extract article-prefixed phrases; "Veiled Eight" without "the"
might be extracted but the full phrase starts with a lowercase article. LLM also passed —
the sentence introduces the faction as a historical dissolved body rather than an active
new entity, which may have triggered the "past-tense reference" pass heuristic.

**Structural gap:** Number-word tail factions ("the Veiled Eight", "the Council of Seven")
fall outside NER suffix-class coverage and have ambiguous LLM salience when framed as
historical background rather than active introductions.

---

## 4. Key Findings

### What works (100% recall classes)

- **title-surname:** "Master Orin", "Mistress Ilara", "Captain Kessrin" — all caught by
  NER `title-pair` class + LLM confirmed. The `title-pair` NER extractor is highly reliable.
- **named-institution:** "Office of Structural Integrity", "Bureau of Civic Truth",
  "Council of Forty-Seven Tongues" — all caught. Likely via NER `suffix-class` (Office,
  Bureau, Council) + LLM confirmed.
- **named-historical-event:** "the Three Days' War", "the Quiet Reckoning",
  "the Year of Fallen Axes" — all caught (probably LLM-only since NER doesn't extract
  article-prefixed phrases; LLM treats these as named events reliably).

### What doesn't work (67% recall classes)

Three classes at 67% recall share a structural pattern: **"X of Y" or "the X of Y"
connective names with common-word X and/or number-word Y**:

- `named-place-realm` FN: "Crown of Hyran"
- `named-artifact` FN: "the Sigil of Eight"
- `plural-faction` FN: "the Veiled Eight"

NER blind spots:
1. `X of Y` multi-word spans where "of" breaks consecutive-capitalisation detection.
2. Article-prefixed phrases ("the X") — NER sentence-initial + article filter.
3. Number-word tails (Eight, Seven, Three) not in suffix-class vocabulary.

LLM blind spots (at T=0.1):
1. Historical/dissolved framings ("had not been an official body for sixty years")
   may trigger the "generic reference in context" pass heuristic.
2. Common-word X ("Crown", "Sigil") with lowercase connector — ambiguous as generic noun.

---

## 5. Recommended Next Actions

### Highest priority: NER expansion for "X of Y" + number-word classes

The 3 FN cases all follow the same structural pattern. Two NER extensions would close them:

1. **Add `x-of-y-capitalized` NER class:** Extract 2-3 word spans matching
   `CapitalizedWord + of + CapitalizedWord` (ignoring sentence-initial).
   This catches "Crown of Hyran", "Council of Forty-Seven", "Vale of Whispers".

2. **Add number-word to suffix-class vocabulary:** Treat English number-words
   (Eight, Seven, Forty, etc.) as valid faction/artifact suffixes when preceded
   by a Capitalized Word. Catches "the Veiled Eight", "the Council of Seven".

3. **Remove article-prefix filter for suffix-class matches:** When a phrase
   after "the " starts with a Capitalized Word + known suffix (Order, Concord,
   etc.) or number-word, extract it despite the leading article.

### Per-class blocker thresholds (next §7 item)

With this matrix:
- Classes at 100% recall (title-surname, institution, historical-event): safe to promote
  NER+LLM to strict blocker for those classes without recall cost.
- Classes at 67% recall (place-realm, artifact, plural-faction): the FN pattern is
  structurally predictable — fix NER first, then re-eval before promoting to blocker.
- Generic-document FP controls: 0 FP — current system does not erroneously block
  generic role/document phrases. FP guard holds.

### Asymmetric voting (next §7 item)

The 3 FNs are LLM-only (not caught by NER either). Asymmetric voting (NER-fire = auto
blocker) would not have helped here — the NER prepass didn't fire on these FNs.
The bottleneck is NER extractor coverage, not the LLM/NER voting policy.
Fix NER first; asymmetric voting is the right next step once NER covers these patterns.

---

## 6. Baseline Comparison

| Metric        | exp #302 (Veyr Dominion only, v3 no NER) | L12 (v1+NER, 6 classes) |
|---------------|------------------------------------------|------------------------|
| N fixtures    | 5                                        | 27                     |
| Recall        | 0% (0/5)                                 | 83% (15/18)            |
| Precision     | —                                        | 100% (0 FP)            |
| F1            | 0%                                       | 91%                    |

The exp #302 result (0% recall on Veyr Dominion) was caused by the ungrounded entity being
a proper noun in a direct LLM-produced context. The v1+NER combination substantially
improves recall (0% → 83%) while holding precision at 100% across all classes.
