import { afterEach, expect, test } from "bun:test"
import {
  createPlanningProposal,
  getChapterHealth,
  getPlanningProposalDiff,
  resolvePlanningProposal,
  resolveProposalEnvelope,
  type ArtifactPatchEnvelope,
  type PlanningEditPayload,
  type PlanningImpactSnapshot,
} from "./api"

const originalFetch = globalThis.fetch
interface CapturedFetchRequest {
  url: string
  init?: RequestInit
}

function requireRequest(request: CapturedFetchRequest | null): CapturedFetchRequest {
  if (!request) throw new Error("expected fetch to be called")
  return request
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("resolveProposalEnvelope returns structured stale-precondition responses", async () => {
  const staleResponse = {
    ok: false,
    error: "stale-precondition",
    envelopeId: "artifact-patch:test:1",
    expectedVersion: "old",
    actualVersion: "new",
    applied: false,
  }
  let request: CapturedFetchRequest | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(JSON.stringify(staleResponse), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  const envelope: ArtifactPatchEnvelope = {
    id: "artifact-patch:test:1",
    kind: "artifact_patch",
    novelId: "test-novel",
    target: {
      kind: "world_bible",
      ref: "test-novel",
      currentVersion: "old",
    },
    source: { agent: "artifact-adjuster" },
    status: "pending",
    risk: "low",
    summary: "Update world bible: culture",
    rationale: "test",
    evidence: [],
    payload: {
      type: "worldUpdate",
      patch: { culture: "new culture" },
    },
    precondition: {
      kind: "artifact_hash",
      hash: "old",
    },
    policyRecommendation: {
      decision: "queue",
      reasons: [],
    },
    createdAt: "2026-05-04T00:00:00.000Z",
  }

  await expect(
    resolveProposalEnvelope("test-novel", { envelope, status: "approved" }),
  ).resolves.toEqual(staleResponse)
  const captured = requireRequest(request)
  expect(captured.url).toBe("/api/novel/test-novel/proposal-envelopes/resolve")
  expect(captured.init?.method).toBe("POST")
})

test("getPlanningProposalDiff fetches the read-only planning diff endpoint", async () => {
  const diffResponse = {
    ok: true,
    envelopeId: "planning-edit:test:1",
    status: "pending",
    target: {
      kind: "chapter_outline",
      ref: "ch-1",
      fieldPath: "purpose",
      currentVersion: "old",
    },
    precondition: { kind: "artifact_hash", hash: "old" },
    diff: {
      action: "field_replace",
      target: { kind: "chapter_outline", ref: "ch-1", fieldPath: "purpose" },
      before: { value: "old", display: "old", hash: "a".repeat(64) },
      after: { value: "new", display: "new", hash: "b".repeat(64) },
      changed: true,
    },
    currentTarget: {
      currentVersion: "old",
      currentValue: "old",
      stale: false,
    },
    impactPreview: null,
  }
  let request: CapturedFetchRequest | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(JSON.stringify(diffResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await expect(
    getPlanningProposalDiff("test-novel", "planning-edit:test:1"),
  ).resolves.toEqual(diffResponse as any)
  const captured = requireRequest(request)
  expect(captured.url).toBe(
    "/api/novel/test-novel/planning-proposals/planning-edit%3Atest%3A1/diff",
  )
  expect(captured.init?.method).toBeUndefined()
})

test("createPlanningProposal posts planning edit create requests", async () => {
  const impactPreview = {
    planningSnapshotVersion: "v2",
    planningSnapshotHash: "a".repeat(64),
    impacts: [
      {
        kind: "direct_target",
        reason: "Selected planning field changes.",
        target: { kind: "story_spine", ref: "test-novel", fieldPath: "theme" },
      },
    ],
  } satisfies PlanningImpactSnapshot
  const created = {
    ok: true,
    inserted: true,
    envelope: { id: "planning-edit:test:1", kind: "planning_edit" },
    impactPreview,
  }
  let request: CapturedFetchRequest | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(JSON.stringify(created), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await expect(createPlanningProposal("test-novel", {
    target: { kind: "story_spine", ref: "test-novel", fieldPath: "theme" },
    proposedValue: "Truth costs comfort.",
    rationale: "Sharpen theme.",
  })).resolves.toEqual(created as any)
  const captured = requireRequest(request)
  expect(captured.url).toBe("/api/novel/test-novel/planning-proposals")
  expect(captured.init?.method).toBe("POST")
  expect(JSON.parse(String(captured.init?.body))).toEqual({
    target: { kind: "story_spine", ref: "test-novel", fieldPath: "theme" },
    proposedValue: "Truth costs comfort.",
    rationale: "Sharpen theme.",
  })
})

test("createPlanningProposal can post explicit structural planning actions", async () => {
  const created = {
    ok: true,
    inserted: true,
    envelope: { id: "planning-edit:test:structural", kind: "planning_edit" },
    impactPreview: { impacts: [] },
  }
  let request: CapturedFetchRequest | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(JSON.stringify(created), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await expect(createPlanningProposal("test-novel", {
    action: "beat_reorder",
    target: { kind: "chapter_outline", ref: "ch-1", fieldPath: "scenes" },
    proposedValue: ["beat-b", "beat-a"],
    rationale: "Put the reveal first.",
  })).resolves.toEqual(created as any)
  const captured = requireRequest(request)
  expect(captured.url).toBe("/api/novel/test-novel/planning-proposals")
  expect(captured.init?.method).toBe("POST")
  expect(JSON.parse(String(captured.init?.body))).toEqual({
    action: "beat_reorder",
    target: { kind: "chapter_outline", ref: "ch-1", fieldPath: "scenes" },
    proposedValue: ["beat-b", "beat-a"],
    rationale: "Put the reveal first.",
  })
})

test("getChapterHealth fetches chapter health with optional chapter filter", async () => {
  const response = {
    ok: true,
    novelId: "test-novel",
    generatedAt: "2026-05-05T00:00:00.000Z",
    chapters: [],
    summary: {
      chapterCount: 0,
      pass: 0,
      warn: 0,
      fail: 0,
      missingDraft: 0,
      missingOutline: 0,
      blockerFindings: 0,
      warningFindings: 0,
      infoFindings: 0,
      pendingProposals: 0,
    },
  }
  let request: CapturedFetchRequest | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await expect(getChapterHealth("test-novel", { chapter: 3 })).resolves.toEqual(response)
  const captured = requireRequest(request)
  expect(captured.url).toBe("/api/novel/test-novel/chapter-health?chapter=3")
})

test("resolvePlanningProposal returns structured stale planning responses", async () => {
  const staleResponse = {
    ok: false,
    error: "stale-precondition",
    envelopeId: "planning-edit:test:1",
    expectedVersion: "old",
    actualVersion: "new",
    applied: false,
  }
  let request: CapturedFetchRequest | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(JSON.stringify(staleResponse), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await expect(resolvePlanningProposal(
    "test-novel",
    "planning-edit:test:1",
    { status: "approved", resolvedBy: "test" },
  )).resolves.toEqual(staleResponse)
  const captured = requireRequest(request)
  expect(captured.url).toBe(
    "/api/novel/test-novel/planning-proposals/planning-edit%3Atest%3A1/resolve",
  )
  expect(captured.init?.method).toBe("POST")
  expect(JSON.parse(String(captured.init?.body))).toEqual({
    status: "approved",
    resolvedBy: "test",
  })
})

test("resolvePlanningProposal posts modified planning payloads", async () => {
  const response = {
    ok: true,
    envelopeId: "planning-edit:test:1",
    applied: true,
    status: "modified",
    newVersion: "new",
  }
  let request: CapturedFetchRequest | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  const impactPreview = {
    planningSnapshotVersion: "v2",
    planningSnapshotHash: "b".repeat(64),
    impacts: [
      {
        kind: "direct_target",
        reason: "Modified proposal keeps the same field target.",
        target: { kind: "story_spine", ref: "test-novel", fieldPath: "theme" },
        metadata: { source: "api-test" },
      },
    ],
  } satisfies PlanningImpactSnapshot
  const modifiedPayload: PlanningEditPayload = {
    action: "field_replace",
    target: { kind: "story_spine", ref: "test-novel", fieldPath: "theme" },
    previousValue: "Comfort preserves order.",
    proposedValue: "Truth costs comfort.",
    impactPreview,
  }

  await expect(resolvePlanningProposal(
    "test-novel",
    "planning-edit:test:1",
    {
      status: "modified",
      modifiedPayload,
      operatorNote: "Use the sharper wording.",
      resolvedBy: "test",
    },
  )).resolves.toEqual(response as any)
  const captured = requireRequest(request)
  expect(captured.url).toBe(
    "/api/novel/test-novel/planning-proposals/planning-edit%3Atest%3A1/resolve",
  )
  expect(captured.init?.method).toBe("POST")
  expect(JSON.parse(String(captured.init?.body))).toEqual({
    status: "modified",
    modifiedPayload,
    operatorNote: "Use the sharper wording.",
    resolvedBy: "test",
  })
})
