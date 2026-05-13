---
status: active
date: 2026-05-13
---

# L110 Production Scene-Contract Rendering And Checker Headroom

Production drafting now renders populated scene-contract fields on the
beat-shaped writer path by default through
`forceRenderSceneContractWhenAvailable=true`.

This is not a promotion of `sceneCallWriterV1`, writer expansion retries, or
full scene-first call architecture. It only closes the runtime gap where
planning produced scene-contract fields but baseline drafting suppressed the
`SCENE CONTRACT` writer surface. Entries without populated scene-contract
fields still render no block, and per-novel overrides can set the flag false
for legacy no-contract comparisons.

Runtime analytical checker caps also get more output headroom after the
Rillgate draft hit a `continuity-facts` completion cap. The cap increases are
bounded to checker/reviser roles; they do not change writer prose budgets.
