/**
 * ReviewProposalEnvelope — the shared TypeScript projection that wraps every
 * proposal kind in the collaborative-proposal-workflow design (Phase 3-6 in
 * `docs/designs/collaborative-proposal-workflow.md`).
 *
 * Per the design doc §Proposal Envelope: "The first implementation should not
 * start with a universal table migration. Start with a shared TypeScript
 * projection used by UI and services, then persist each proposal kind in the
 * smallest appropriate backing store."
 *
 * Phase 3 (this commit) defines the envelope shape and a builder for the
 * artifact-patch kind that wraps `artifact-adjuster` outputs. Persistence,
 * per-patch resolve routes, and quick-actions are deferred to subsequent
 * Phase 3 commits.
 */

import { createHash } from "node:crypto"
import type { AdjusterPatch } from "../agents/artifact-adjuster/schema"

export type ProposalEnvelopeKind =
  | "artifact_patch"
  | "canon_update"
  | "prose_edit"
  | "editorial_flag"

export type ProposalEnvelopeStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "modified"
  | "shadowed"
  | "expired"

export type ProposalEnvelopeRisk = "mechanical" | "low" | "medium" | "high"

export type ProposalEnvelopeResolvedBy = "human" | "policy" | "script" | "test"

/**
 * Stable, machine-checkable target reference. Every envelope must declare what
 * artifact / record / span it targets so a stale precondition can be detected
 * before the patch is applied.
 */
export interface ProposalTargetRef {
  kind:
    | "planning_directive"
    | "world_bible"
    | "character"
    | "story_spine"
    | "chapter_outline"
    | "canon_fact"
    | "prose_span"
  ref: string
  fieldPath?: string
  currentVersion: string
}

export interface ProposalSourceRef {
  agent: string
  userMessage?: string
  parentEnvelopeId?: string
}

export interface ProposalEvidence {
  kind: "quote" | "structured" | "link"
  text: string
  ref?: string
}

export interface ProposalPrecondition {
  kind: "artifact_hash" | "snapshot_hash" | "draft_hash" | "canon_generation"
  hash: string
}

export interface ProposalPolicyRecommendation {
  decision: "queue" | "approve" | "reject" | "shadow"
  policyVersion?: string
  reasons: string[]
}

export interface ReviewProposalEnvelope<TPayload = unknown> {
  id: string
  kind: ProposalEnvelopeKind
  novelId: string
  target: ProposalTargetRef
  source: ProposalSourceRef
  status: ProposalEnvelopeStatus
  risk: ProposalEnvelopeRisk
  summary: string
  rationale: string
  evidence: readonly ProposalEvidence[]
  payload: TPayload
  precondition: ProposalPrecondition
  policyRecommendation: ProposalPolicyRecommendation
  createdAt: string
  resolvedAt?: string
  resolvedBy?: ProposalEnvelopeResolvedBy
}

export type ArtifactPatchEnvelope = ReviewProposalEnvelope<AdjusterPatch> & {
  kind: "artifact_patch"
}

interface ArtifactSnapshot {
  world: unknown
  characters: readonly unknown[]
  spine: unknown
}

interface BuildArtifactPatchEnvelopeArgs {
  novelId: string
  patch: AdjusterPatch
  patchIndex: number
  userMessage: string
  rationale: string
  artifacts: ArtifactSnapshot
  now: Date
}

const ENVELOPE_ID_VERSION = "v1"

/**
 * Recursive canonical serializer used by `stableHash`. Object keys are
 * sorted ascending; arrays preserve order (semantically meaningful);
 * primitives delegate to `JSON.stringify`. Output is restart-stable:
 * two equivalent values produce the same byte stream regardless of
 * key insertion order, runtime, or JSON parse round-trip path.
 *
 * Codex round-3 MEDIUM: the prior implementation used raw
 * `JSON.stringify`, whose key order follows insertion order. After a
 * server restart or any JSON round-trip that re-orders keys (e.g. a
 * different tool building the snapshot), unchanged artifacts would
 * hash differently — making proposal envelope ids and
 * `target.currentVersion` preconditions look stale or brand new even
 * though nothing changed. The canonical serializer fixes that.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]"
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts: string[] = []
  for (const k of keys) {
    const v = obj[k]
    if (v === undefined) continue
    parts.push(JSON.stringify(k) + ":" + canonicalize(v))
  }
  return "{" + parts.join(",") + "}"
}

/** Restart-stable SHA-256 hex of the value's canonical-JSON form. Used for
 * both deterministic envelope ids and artifact preconditions. The
 * canonicalizer sorts object keys recursively so two equivalent values
 * always hash identically across runtimes / processes / restarts. */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex")
}

export function classifyPatchRisk(patch: AdjusterPatch): ProposalEnvelopeRisk {
  switch (patch.type) {
    case "characterRename":
      return "medium"
    case "characterUpdate":
    case "worldUpdate":
    case "spineUpdate":
      return "low"
  }
}

export function targetForPatch(
  patch: AdjusterPatch,
  novelId: string,
  artifacts: ArtifactSnapshot,
): ProposalTargetRef {
  switch (patch.type) {
    case "characterUpdate":
    case "characterRename": {
      const target = (artifacts.characters as { id?: string }[]).find(
        c => c?.id === patch.characterId,
      )
      return {
        kind: "character",
        ref: patch.characterId,
        currentVersion: stableHash(target ?? null),
      }
    }
    case "worldUpdate":
      return {
        kind: "world_bible",
        ref: novelId,
        currentVersion: stableHash(artifacts.world ?? null),
      }
    case "spineUpdate":
      return {
        kind: "story_spine",
        ref: novelId,
        currentVersion: stableHash(artifacts.spine ?? null),
      }
  }
}

export function summarizePatch(patch: AdjusterPatch): string {
  switch (patch.type) {
    case "characterRename":
      return `Rename character ${patch.characterId} → "${patch.newName}"`
    case "characterUpdate": {
      const fields = Object.keys(patch.patch).join(", ")
      return `Update character ${patch.characterId}: ${fields}`
    }
    case "worldUpdate": {
      const fields = Object.keys(patch.patch).join(", ")
      return `Update world bible: ${fields}`
    }
    case "spineUpdate": {
      const fields = Object.keys(patch.patch).join(", ")
      return `Update story spine: ${fields}`
    }
  }
}

export function buildArtifactPatchEnvelope(
  args: BuildArtifactPatchEnvelopeArgs,
): ArtifactPatchEnvelope {
  const target = targetForPatch(args.patch, args.novelId, args.artifacts)
  const summary = summarizePatch(args.patch)
  const risk = classifyPatchRisk(args.patch)
  const idSeed = stableHash({
    version: ENVELOPE_ID_VERSION,
    novelId: args.novelId,
    patch: args.patch,
    targetVersion: target.currentVersion,
    patchIndex: args.patchIndex,
  })
  return {
    id: `artifact-patch:${args.novelId}:${idSeed.slice(0, 16)}`,
    kind: "artifact_patch",
    novelId: args.novelId,
    target,
    source: {
      agent: "artifact-adjuster",
      userMessage: args.userMessage,
    },
    status: "pending",
    risk,
    summary,
    rationale: args.rationale,
    evidence: [],
    payload: args.patch,
    precondition: {
      kind: "artifact_hash",
      hash: target.currentVersion,
    },
    policyRecommendation: {
      decision: "queue",
      reasons: [
        `risk=${risk}; artifact_patch proposals route through manual review by default until Phase 6 ApprovalPolicy ships`,
      ],
    },
    createdAt: args.now.toISOString(),
  }
}
