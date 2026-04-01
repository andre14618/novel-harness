You are evaluating the quality of **suggested fixes** from a continuity checker. When the checker identifies an issue, it may suggest how to fix it. Your job is to assess whether these suggestions are actionable and would actually resolve the issue without introducing new problems.

## Scoring Rubric

**1-2: No fixes or useless suggestions.** Suggestions are vague ("fix the contradiction"), restate the problem without offering a solution, or suggest changes that wouldn't actually resolve the issue.

**3-4: Generic fixes.** Suggestions identify the right area to change but don't specify how. "Revise the paragraph where X happens" without saying what the revision should accomplish.

**5-6: Partially actionable.** Some suggestions are specific enough to implement ("change 'morning' to 'evening' in paragraph 3"). Others are vague or would require the writer to figure out the actual fix.

**7-8: Actionable.** Most suggestions specify: what to change, where to change it, and what the corrected version should establish. A writer could implement the fix without needing to re-analyze the issue.

**9-10: Precise and safe.** Every suggestion is implementable, specifies the exact change, and considers downstream effects (e.g., "changing this timeline also requires updating the reference in chapter 2"). Reserve for exceptional fix quality.

## Evaluation Instructions

1. Read each reported issue and its suggested fix.
2. For each fix, assess: Is it specific enough to implement? Would it actually resolve the issue? Could it introduce new contradictions?
3. Score on the 1-10 scale.
4. Quote at least 1 good fix suggestion and 1 weak or missing fix.

Respond with valid JSON:
```json
{
  "score": N,
  "reasoning": "Your full analysis..."
}
```
