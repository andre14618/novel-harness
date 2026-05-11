import type { BeatContext } from "./beat-context"

export interface StoryRefCounts {
  total: number
  threadIds: number
  promiseIds: number
  payoffIds: number
}

export function countStoryRefs(ctx: BeatContext): StoryRefCounts {
  const threadIds = new Set<string>()
  const promiseIds = new Set<string>()
  const payoffIds = new Set<string>()
  const add = (kind: "thread" | "promise" | "payoff", value?: string): void => {
    if (!value) return
    if (kind === "thread") threadIds.add(value)
    else if (kind === "promise") promiseIds.add(value)
    else payoffIds.add(value)
  }

  const capsules = ctx.characterContextCapsules
  for (const id of capsules?.activeThreadIds ?? []) add("thread", id)
  for (const id of capsules?.activePromiseIds ?? []) add("promise", id)
  for (const id of capsules?.activePayoffIds ?? []) add("payoff", id)
  for (const card of capsules?.cards ?? []) {
    for (const id of card.activeThreadIds) add("thread", id)
    for (const id of card.activePromiseIds) add("promise", id)
    for (const id of card.activePayoffIds) add("payoff", id)
  }

  for (const item of [
    ...ctx.beatSpec.obligations.mustEstablish,
    ...ctx.beatSpec.obligations.mustPayOff,
    ...ctx.beatSpec.obligations.mustTransferKnowledge,
    ...ctx.beatSpec.obligations.mustShowStateChange,
    ...ctx.beatSpec.obligations.mustNotReveal,
  ]) {
    add("thread", item.threadId)
    add("promise", item.promiseId)
    add("payoff", item.payoffId)
  }

  return {
    total: threadIds.size + promiseIds.size + payoffIds.size,
    threadIds: threadIds.size,
    promiseIds: promiseIds.size,
    payoffIds: payoffIds.size,
  }
}

export function countCanonSourceRefs(ctx: BeatContext): number {
  const ids = new Set<string>()
  for (const seed of ctx.beatSpec.seeds) if (seed.factId) ids.add(seed.factId)
  for (const due of ctx.beatSpec.payoffsDue) if (due.factId) ids.add(due.factId)
  for (const item of [
    ...ctx.beatSpec.obligations.mustEstablish,
    ...ctx.beatSpec.obligations.mustPayOff,
    ...ctx.beatSpec.obligations.mustTransferKnowledge,
    ...ctx.beatSpec.obligations.mustShowStateChange,
    ...ctx.beatSpec.obligations.mustNotReveal,
  ]) {
    if (item.sourceId) ids.add(item.sourceId)
  }
  return ids.size
}
