---
status: active
updated: 2026-04-11 (chapter-plan eval complete, exp #158)
---

# Teacher Selection Strategy

Reference document for choosing oracle models to generate SFT training labels. Covers what we know, what failed, and the current best-practice protocol.

---

## The Core Question

For each pipeline agent you want to fine-tune, you need a teacher: a model whose outputs become the training labels. The teacher's calibration directly shapes the student's behavior. Getting the teacher wrong produces a well-trained model that replicates the wrong judgment.

---

## Failure Mode: Mixed Teachers per Flag (V3 Adherence)

**Experiment**: exp #145 (V3 training), exp #146 (V3 eval)

**Setup**: Selected per-flag best teachers by synthetic accuracy — Kimi K2.5 for events (95% synthetic), gpt-oss for character (100% synthetic), 235B for setting/tangent.

**Result**: V3 regressed vs V2 (94.4% vs 95.2% overall). Critical collapse on FAIL_MISSING_SUBTLE: 78.6% → 55.4% (−23pp). Events recall dropped 86.6% → 74.1%.

**Root cause**: Synthetic evals use unambiguous injected failures — beats completely removed, settings blatantly swapped. Every competent model scores 85–100% on those. The synthetic eval cannot distinguish calibration on *marginal* production cases: prose that partially covers a beat, character behavior that's *arguably* consistent.

On marginal cases, Kimi K2.5 is more lenient than 235B on subtle missing events. When you mix them as teachers, the student inherits:
- K2.5's lenient threshold for events
- 235B's stricter threshold for setting/tangent
- An incoherent decision boundary

**The lesson**: Synthetic benchmark accuracy ≠ teacher quality. Different teachers have different calibration thresholds on marginal cases. Mixing them within a single task produces inconsistent training signal that breaks the student's decision boundary.

**What NOT to do**: Select teachers per-flag based on synthetic accuracy. This is the V3 failure pattern.

---

## What Works: Single Consistent Teacher

**V2 adherence (235B, single teacher)**: 90% oracle agreement on 64 production pairs (exp #135). Consistent threshold across all 4 call types. The student learned one coherent judgment standard.

**Continuity (Sonnet, single teacher)**: 98% accuracy on 120 pairs. 235B was failing at 90% of WARNINGs — Sonnet replaced it entirely, not mixed with it.

**Rule**: For each task, use **one model** as teacher for **all** labels in that task. Switching teachers across dimensions/variants within a task breaks calibration consistency.

---

## Holistic Sonnet Teacher — The Hypothesis

**Background**: Sonnet has been evaluated as a teacher on two tasks:

| Task | Sonnet Accuracy | Notes |
|------|----------------|-------|
| Adherence (all 4 calls) | 96.5% overall (exp #147) | +1.3pp over 235B; tangent 100% vs 235B's ~80%; FAIL_MISSING_SUBTLE 87.2% |
| Continuity | 98% (exp #150) | 235B misses 90% of WARNINGs — Sonnet is the only viable teacher |
| Chapter-plan | **UNTESTED** (exp pending) | Sonnet eval launched 2026-04-11 |

**The hypothesis**: Use Sonnet as a single consistent teacher across ALL analytical checker tasks (adherence, chapter-plan, continuity). One model, one calibration standard, $0 cost via Claude Code subagents.

**Why this is NOT the V3 failure**: V3 mixed K2.5/gpt-oss/235B per-flag *within* a task. Sonnet as a holistic teacher means one model handles all labels for a given task consistently. The calibration is uniform.

**Risk**: Sonnet is slightly worse than 235B on events (94.9% vs 235B ~97% on that call type). Training on Sonnet events labels could slightly regress events detection while dramatically improving tangent (+31pp). Net effect is task-dependent and requires eval.

**Decision gate**: Do not adopt Sonnet as adherence teacher unless:
1. Sonnet-labeled adapter improves on all current V2 weak spots (FAIL_MISSING_SUBTLE, FAIL_CHAR, FAIL_TANGENT_HARD)
2. Sonnet-labeled adapter does NOT regress on current V2 strengths (events 98%)

---

## Teacher Ladder — Known Results Per Task

### Adherence Checker (4-call decomposed)

| Model | Overall | Events | Setting | Tangent | Character | Notes |
|-------|---------|--------|---------|---------|-----------|-------|
| 235B (V2 teacher) | ~95% | ~97% | ~95% | ~80% | ~88% | Single teacher; V2 production |
| Sonnet 4.6 | 96.5% | 94.9% | 100% | 100% | 93.3% | exp #147; below V2.1 threshold |
| Kimi K2.5 | 95% events | — | — | — | — | exp #140; V3 events teacher — DISCONFIRMED as multi-teacher |
| gpt-oss-120b | — | — | — | — | 100% | exp #140; V3 character teacher — DISCONFIRMED |

**V2 adapter weak spots** (trained on 235B labels):
- FAIL_MISSING_SUBTLE: 78.6%
- FAIL_TANGENT_HARD: 69.0%
- FAIL_CHAR: 85.7%

**Why Sonnet is interesting for V3**: Sonnet hits 100% on tangent (vs V2 adapter's 69%) and 87.2% on FAIL_MISSING_SUBTLE (vs V2 adapter's 78.6%). These are exactly the weak spots.

**Path to adherence V3 (Sonnet teacher)**:
1. ~~Take the 7,541 V3 curated training pairs (same inputs as V2, different labels)~~ **DONE — 7,540 pairs relabeled (exp #159, 2026-04-11)**
2. Run Sonnet on all pairs via Claude Code subagents ($0)
3. Train on Sonnet-labeled outputs
4. Eval against production test set: must improve tangent and FAIL_MISSING_SUBTLE without regressing events

### Chapter-Plan Checker (single flat call)

| Model | Overall | PASS variants | FAIL variants | Notes |
|-------|---------|--------------|--------------|-------|
| gpt-oss-120b | 88.2% | ~95% | ~80% | exp #158; 229 pairs — reliable baseline |
| Qwen 235B | 81% | 100% | 47% (FAIL_MISSING_BEAT 10%) | exp #119 |
| GLM-5 | 89% | 100% | 80% | exp #144; 0 errors — but 20s latency, unusable |
| Kimi K2 | 84% | 100% | 67% (FAIL_MISSING_BEAT 10%) | exp #144 |
| Qwen3-14B base | 53% | 100% | 5% (rubber-stamp) | exp #107 |
| **Sonnet 4.6** | **94.3%** | **100%** | **~89%** | **exp #158; 229 pairs, 25 scenarios — WINNER** |

> **exp #119 note**: gpt-oss's original 90% figure (80 pairs) was from a smaller eval. The definitive head-to-head at 229 pairs (exp #158) puts gpt-oss at 88.2% vs Sonnet 94.3%.

**exp #144 contamination**: gpt-oss scored only 75% in exp #144 with 19 errors (24% failure rate) — caused by `maxTokens: 768` truncation. GLM-5's 89% (0 errors) is a legitimate finding but GLM-5's 20s latency makes it unusable.

**Decision (2026-04-11, exp #158):** Sonnet is the chapter-plan teacher. Switch for V2 data collection.

Key variant findings:
- **PASS_REORDER**: Sonnet 100% vs gpt-oss 82.8% — gpt-oss over-literal on reordering
- **FAIL_REVERSED_ARC**: Sonnet 89.7% vs gpt-oss 82.8%
- **PASS_PARAPHRASE**: Sonnet 100% vs gpt-oss 96.4%
- **FAIL_MISSING_BEAT**: Both low (67.9% / 46.4%) — 12 GT labeling errors identified; not a teacher quality issue
- All other variants: Sonnet ≥ gpt-oss

V1 adapter (exp #154) was trained on gpt-oss labels with ~12% error rate on PASS_REORDER and FAIL_REVERSED_ARC. Treat V1 as a pilot.

### Continuity Checker

| Model | Overall | VAR_BLOCKER | VAR_WARNING | VAR_NIT | VAR_TRAP | Notes |
|-------|---------|------------|------------|---------|----------|-------|
| Qwen 235B | ~10-35%* | ~95% | ~10% | ~35% | ~90% | exp #117/#118; catastrophic on soft violations |
| Sonnet 4.6 | 98% | 100% | ~95% | ~95% | ~100% | exp #150; clear winner |

*235B figures estimated from "misses 90% of WARNINGs and 65% of NITs" finding

**Decision**: Sonnet is the only viable teacher for continuity. 235B cannot be used.

---

## Data Sufficiency

### What the adherence-checker baseline tells us

The adherence V2 adapter (90% oracle agreement) used 8,524 curated training examples, 2 epochs, ~8,500 gradient steps. This is the calibration point for "what does it take to distill an analytical checker into 14B."

### Current training runs vs this baseline

| Task | Training Examples | Grad Steps | Complexity | Sufficiency |
|------|-----------------|------------|-----------|-------------|
| Adherence V2 | 8,524 | ~8,500 | Medium (4-call binary) | **Baseline** |
| Chapter-plan V1 | 197 | ~591 | High (multi-beat reasoning) | Likely underpowered |
| Continuity V1 | 120 | ~360 | Medium (fact contradiction) | Borderline |

**The problem**: 197 examples for a complex structural reasoning task (chapter-plan) is ~43× less training signal than the adherence baseline on a harder task. V1 adapters should be treated as pilots that tell you *which variants the model learned* — not as production-ready replacements.

### Minimum viable datasets (estimated from adherence playbook)

| Task | V1 (pilot) | V2 (viable) | V3 (robust) |
|------|-----------|------------|------------|
| Chapter-plan | 200 pairs | 500 pairs | 1,000+ pairs |
| Continuity | 120 pairs | 300 pairs | 600+ pairs |
| Adherence | 8,524 (current) | + targeted FAIL_MISSING_SUBTLE/FAIL_CHAR augmentation | + GRPO reward loop |

**How to reach V2 for chapter-plan**: 
1. Add 20+ more scenarios to the generator (currently 25, target 45+) 
2. Label with Sonnet (if Sonnet accuracy ≥ 88%, else gpt-oss with maxTokens fix)
3. Combine with V1 data → ~500+ pairs

**How to reach V2 for continuity**:
1. Add 10 more scenarios to generator + VAR_WARNING_2 variant per scenario → 180+ pairs
2. Relabel with Sonnet (same pipeline)

---

## Teacher Selection Protocol

For any new fine-tune candidate:

1. **Pick candidate teachers** — include the current production model, 235B as baseline, and Sonnet (since it's $0 via subagents).

2. **Run synthetic accuracy eval** — spawn subagents to evaluate N pairs per teacher. This tells you who's in range, not who to pick.

3. **Collect production disagreements** — on actual novel runs, identify pairs where candidate teacher disagrees with current teacher. Hand-label a sample of those disagreements. This is the real teacher quality signal.

4. **Select a single teacher** — whichever model wins step 3 on the variants that matter. Never split across variants for a single task.

5. **Validate with a pilot training run** — train on 200-400 examples, eval the adapter. A cheap training run will confirm or deny the teacher quality faster than any benchmark.

---

## Sonnet as Universal Teacher — Current Status (2026-04-11)

| Task | Sonnet Accuracy | Decision |
|------|----------------|---------|
| Adherence | 96.5% (exp #147) | V3-sonnet: 7,540 pairs relabeled, training submitted (exp #159) |
| Chapter-plan | **94.3% (exp #158)** | **Sonnet adopted** — V2 data uses Sonnet labels |
| Continuity | 98% (exp #150) | Sonnet adopted — V1 training in progress (exp #155) |
| Reference-resolver | N/A — task retired | Llama 8B sufficient |

**Sonnet is now the universal teacher across all analytical checkers.**

- One teacher, one calibration standard
- $0 labeling cost via Claude Code subagents
- Easy to regenerate/augment any dataset

This is a stronger position than per-task teacher hunting and avoids repeating the V3 multi-teacher failure. The architecture holds:

| Checker | Production Oracle | Adapter Status |
|---------|-----------------|----------------|
| Adherence | W&B Qwen3-14B V2 | In production; V3-sonnet training submitted (exp #159) |
| Chapter-plan | gpt-oss-120b | V1 in training (exp #154); V2 with Sonnet labels next |
| Continuity | Qwen 235B | V1 in training (exp #155) |
