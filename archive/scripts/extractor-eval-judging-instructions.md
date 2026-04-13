# Extractor Eval — Sonnet-as-Judge Content Accuracy

**Goal:** Measure whether each extractor adapter captures the same *information* as the Sonnet ground truth, regardless of wording, granularity, or structure. Word-overlap F1 is a bad metric for this — two descriptions of the same event using different words score 0%. We need semantic judgment.

---

## Prerequisites

Run the prep script on the LXC to generate eval batch files:

```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && /home/andre/.bun/bin/bun scripts/prep-extractor-eval-batches.ts"
```

This produces: `/tmp/extractor-eval/{agent}-eval.json` — one file per agent, each containing ~25 eval pairs with `groundTruth`, `adapterOutput`, and `prose` (first 3000 chars for reference).

---

## Step 1: Spawn one subagent per agent

Spawn **4 subagents** (one per extractor). Each reads its eval file and judges every pair.

---

### A. Fact Extractor Judge

```
You are judging the content accuracy of a fact-extractor LoRA adapter against Sonnet-reviewed ground truth.

Read /tmp/extractor-eval/fact-extractor-eval.json. Each entry has:
- `idx`: sample index
- `groundTruth`: the Sonnet-reviewed correct output (object with `facts` array)
- `adapterOutput`: the adapter's output (object with `facts` array)
- `prose`: first 3000 chars of the source chapter (for verification)

For EACH entry, compare the adapter's extracted facts against the ground truth facts. Judge:

1. **Information recall** — For each ground truth fact, is the same information present in the adapter output? It may be worded differently, split across two facts, or merged with another fact. The question is: would a writer using these facts have the same continuity-critical information? Score: count of ground truth facts whose information is captured.

2. **Information precision** — For each adapter fact, is it grounded in the prose? Is it continuity-critical (would forgetting it cause an error 3 chapters later)? Score: count of adapter facts that are valid and useful.

3. **Hallucinations** — Does the adapter produce any facts NOT supported by the prose? Count these separately.

4. **Category accuracy** — For matched facts, does the adapter assign the same category? Count matches and mismatches.

Output one JSON object per line to /tmp/extractor-eval/fact-extractor-judge.jsonl:
{"idx": <idx>, "ground_count": <n>, "adapter_count": <n>, "info_recall": <n facts captured>, "info_precision": <n valid adapter facts>, "hallucinations": <n>, "category_matches": <n>, "category_mismatches": <n>, "notes": "<brief note on major differences>"}

After all entries, print a summary: average info_recall%, info_precision%, hallucination rate.
```

---

### B. Summary Extractor Judge

```
You are judging the content accuracy of a summary-extractor LoRA adapter against Sonnet-reviewed ground truth.

Read /tmp/extractor-eval/summary-extractor-eval.json. Each entry has:
- `idx`: sample index
- `groundTruth`: Sonnet-reviewed correct output (object with `summary`, `keyEvents`, `emotionalState`, `openThreads`)
- `adapterOutput`: adapter's output (same shape)
- `prose`: first 3000 chars of the source chapter

For EACH entry, judge these dimensions:

1. **Summary coverage** — Does the adapter summary capture the same major events as the ground truth summary? Not word-for-word — same events, same character actions, same revelations. Score 0-3: 0=missing major events, 1=captures <50% of events, 2=captures >50% but misses some, 3=captures all major events.

2. **Key events match** — For each ground truth keyEvent, is the same event present in the adapter's keyEvents (may be worded differently)? Count matched vs missed.

3. **Emotional state accuracy** — Does the adapter's emotionalState reflect the same tone/mood as the ground truth? Score: 0=wrong, 1=partially right, 2=correct.

4. **Open threads match** — For each ground truth openThread, is the same unresolved tension present in the adapter output? Count matched vs missed.

5. **Fabrications** — Does the adapter summary contain events that didn't happen in the prose? Count these.

Output one JSON object per line to /tmp/extractor-eval/summary-extractor-judge.jsonl:
{"idx": <idx>, "summary_coverage": <0-3>, "key_events_ground": <n>, "key_events_matched": <n>, "emotional_accuracy": <0-2>, "open_threads_ground": <n>, "open_threads_matched": <n>, "fabrications": <n>, "notes": "<brief note>"}

After all entries, print averages for each metric.
```

---

### C. Character State Judge

```
You are judging the content accuracy of a character-state LoRA adapter against Sonnet-reviewed ground truth.

Read /tmp/extractor-eval/character-state-eval.json. Each entry has:
- `idx`: sample index
- `groundTruth`: Sonnet-reviewed correct output (object with `characters` array, each having name, location, emotionalState, knows, doesNotKnow)
- `adapterOutput`: adapter's output (same shape)
- `prose`: first 3000 chars of the source chapter

For EACH entry, match characters by name (case-insensitive), then judge per character:

1. **Character coverage** — Did the adapter include all characters from ground truth? Did it include extra characters not in ground truth?

2. **Location accuracy** — For each matched character, does the adapter's location match the ground truth? Not exact string — same place. Score per character: 0=wrong, 1=correct.

3. **Emotional state accuracy** — Does the adapter's emotionalState convey the same emotional tone? Score per character: 0=wrong, 1=partially right, 2=correct.

4. **Knows accuracy** — For each ground truth `knows` item, is the same knowledge captured in the adapter's `knows` array (may be worded differently)? Count matched vs missed per character.

5. **DoesNotKnow accuracy** — Same comparison for `doesNotKnow`. These create dramatic tension — are the same information gaps captured?

Output one JSON object per line to /tmp/extractor-eval/character-state-judge.jsonl:
{"idx": <idx>, "ground_chars": <n>, "adapter_chars": <n>, "chars_matched": <n>, "location_correct": <n>, "location_total": <n>, "emotional_correct": <n>, "emotional_total": <n>, "knows_matched": <n>, "knows_ground_total": <n>, "doesnotknow_matched": <n>, "doesnotknow_ground_total": <n>, "notes": "<brief note>"}

After all entries, print averages: character recall, location accuracy%, emotional accuracy%, knows recall%, doesNotKnow recall%.
```

---

### D. Relationship Timeline Judge

```
You are judging the content accuracy of a relationship-timeline LoRA adapter against Sonnet-reviewed ground truth.

Read /tmp/extractor-eval/relationship-timeline-eval.json. Each entry has:
- `idx`: sample index
- `groundTruth`: Sonnet-reviewed correct output (object with relationshipChanges, timelineEvents, knowledgeGains, awarenessChanges)
- `adapterOutput`: adapter's output (same shape)
- `prose`: first 3000 chars of the source chapter

For EACH entry, judge these 4 sections:

1. **Relationship changes** — For each ground truth relationship change, is the same pair captured with a similar dynamic/shift? Is the trust level the same or within one step? Count matched vs missed. Flag any adapter relationships not in ground truth.

2. **Timeline events** — For each ground truth event, is the same event present in the adapter output (may be worded differently, may be split or merged)? Does it have the right participants? Count matched vs missed.

3. **Knowledge gains** — For each ground truth knowledge gain, is the same information present in the adapter output? Is the source (witnessed/told/deduced/etc) correct? Is isFalse correct for false beliefs? Count matched vs missed.

4. **Awareness changes** — For each ground truth awareness change, is the same system/level shift captured? Count matched vs missed.

Output one JSON object per line to /tmp/extractor-eval/relationship-timeline-judge.jsonl:
{"idx": <idx>, "rel_ground": <n>, "rel_matched": <n>, "events_ground": <n>, "events_matched": <n>, "knowledge_ground": <n>, "knowledge_matched": <n>, "awareness_ground": <n>, "awareness_matched": <n>, "extra_items": <n items in adapter not in ground truth>, "notes": "<brief note>"}

After all entries, print per-section recall% and overall content accuracy.
```

---

## Step 2: Collect results

After all 4 subagents finish:

```bash
for agent in fact-extractor summary-extractor character-state relationship-timeline; do
  echo "=== $agent ==="
  [ -f "/tmp/extractor-eval/${agent}-judge.jsonl" ] && wc -l "/tmp/extractor-eval/${agent}-judge.jsonl"
done
```

---

## Step 3: Aggregate

Read each `*-judge.jsonl` and compute overall content accuracy per adapter. The key metrics are:

- **fact-extractor:** info_recall% (are ground truth facts captured?) and hallucination count
- **summary-extractor:** summary_coverage average (0-3 scale) and key_events recall%
- **character-state:** knows recall% and doesNotKnow recall% (these drive continuity)
- **relationship-timeline:** per-section recall% (events and knowledge are most important)

**Deploy threshold:** >=80% content recall on training data. Below that, the adapter needs more data or hyperparameter tuning before production use.
