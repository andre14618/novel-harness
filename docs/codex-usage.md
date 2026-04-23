---
status: active
kind: tooling-guide
---

# Codex Plugin Usage

Codex (via the `openai/codex-plugin-cc` Claude Code plugin) is now installed. This doc defines *when* Codex earns its keep in our workflow. Default remains Claude; Codex is added where a different-model-family second voice is load-bearing, not everywhere.

## When to use Codex

### 1. Adversarial review of experiment charters — **primary reviewer**

- Command: `/charter-review <charter-path>` (wraps `/codex:adversarial-review --background`).
- Rule: every fine-tune charter must have a Codex GREEN verdict before training spend (per §11.8 of `experiment-design-rules.md`).
- Opus `experiment-adversary` subagent is fallback only — runs when Codex quota is exhausted, or when a YELLOW/RED verdict needs a second opinion.
- Why Codex beats Opus here: different model family → genuine divergence. Claude reviewing Claude is an echo chamber.

### 2. Pre-commit code review of the harness itself — **recommended for large changes**

- Command: `/codex:review --background` on uncommitted changes, or `/codex:review --base main --background` on a branch.
- Threshold: any commit touching `src/orchestrator/`, `src/phases/`, `src/harness/`, `src/db/` that changes >100 lines. Smaller targeted edits don't need it.
- Not for: prompt-file edits (no logic to review), `scripts/hallucination/*.ts` one-off analysis scripts.

### 3. Adversarial design review of architectural proposals — **when stakes justify**

- Command: `/codex:adversarial-review --background challenge <specific-claim>`
- Use for: new agent designs, fine-tuning strategy changes, big refactors, provider swaps. Frame the focus text as "challenge the chosen approach vs. <named alternative>" — adversarial review works best with a concrete counterfactual to pressure-test against.
- Not for: incremental prompt tweaks or daemon iteration — too expensive per unit of signal.

### 4. Parallel investigations via `/codex:rescue`

- Run Codex on a time-boxed investigation in the background while Claude continues foreground work.
- Fits: flaky test diagnosis, "why did this regress" across wide commit history, deep-dive into third-party lib behavior.
- Doesn't fit: anything requiring interactive iteration with the user — the background shape makes that slow.

## When NOT to use Codex

- **Routine agent-prompt iteration.** Already covered by Claude + the deterministic checks. Adding Codex doubles cost for noise.
- **Training-data generation.** A second model family for synthesis just adds another confound to distribution match (§11.4) — prefer ensembling different Claude temperatures or intentional writer diversity (§6.1) over model-family mixing for data gen.
- **Automatic review gate (`--enable-review-gate`).** The plugin's own docs warn it "may drain usage limits quickly" and creates long-running loops. Our review events should be explicit (pre-experiment charter, pre-merge code review), not per-turn.
- **Any action the harness already gates deterministically.** If a lint check catches the issue, that's cheaper and more reliable than a GPT call.

## Invocation patterns

### Charter review (primary path)

```
/charter-review docs/charters/<name>.md
```

Runs `/codex:adversarial-review --background` with the charter + `docs/experiment-adversary-prompt.md` as focus. Use `/codex:status` and `/codex:result` to collect the verdict.

### Branch review before PR

```
/codex:review --base main --background
```

### Pressure-test a proposal

```
/codex:adversarial-review --background \
  challenge whether switching the writer slot from DeepSeek V3.2 to Claude Haiku \
  is worth the provider-diversity loss given the prefix-caching implications
```

### Delegated investigation

```
/codex:rescue --background investigate why halluc-leak-salvatore-v2 \
  generalizes to style rather than the vocabulary list
```

### Do not enable

```
/codex:setup --enable-review-gate   ← do not run
```

## Budget and quota

- Codex usage consumes the ChatGPT subscription quota. Track it — if we start hitting limits on routine charter reviews, that's a signal the review cadence is too high (revisit §11.7 stop-rule, not the Codex budget).
- Fallback to Opus `experiment-adversary` subagent when quota is exhausted; Anthropic quota and OpenAI quota rarely exhaust at the same time, so the fallback is real.

## Verdict disagreement — load-bearing

If Codex and Opus disagree on a charter verdict (e.g. Codex GREEN, Opus RED, or vice versa), **do not average**. Record both verdicts in charter §10. Disagreement between model families usually flags a methodological ambiguity Codex or Opus sees that the other misses — resolve by specifying the ambiguous axis in the charter, not by picking a winner.
