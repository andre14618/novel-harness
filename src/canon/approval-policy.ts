/**
 * Phase 6 commit 1 — Approval Policy schema + deterministic evaluator
 * (tracer bullet).
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 6 — Approval Policy Engine"
 *
 * The policy engine is the bridge between manual / assisted / autonomous /
 * eval modes and the existing proposal apply paths (artifact_patch resolve,
 * canon-proposal resolve, prose-edit resolve, planning-snapshot lock).
 * Until Phase 6, every envelope's `policyRecommendation.decision = "queue"`
 * and the operator decides one-by-one. With the policy engine, the
 * resolve route can call `evaluatePolicy(envelope, policy)` first; if the
 * decision is `approve`, the route fires the apply automatically; if it
 * is `reject`, the route persists rejection without firing apply; if it
 * is `queue`, the operator still decides; if it is `shadow`, the route
 * RECORDS what it would have done (Phase 7 replay) without mutating.
 *
 * ## Tracer-bullet scope (this commit)
 *
 *   - Pure schema (`ApprovalPolicy`, `PolicyDecision`, `PolicyEvaluation`).
 *   - Pure evaluator `evaluatePolicy(envelope, policy)`.
 *   - No DB, no route integration. Both follow in Phase 6 commits 2-5.
 *
 * ## Decision rules (mode by mode)
 *
 *   - **manual** — every proposal queues for the operator. Even
 *     `risk: "mechanical"` proposals queue. Use this mode when an operator
 *     wants full visibility before any apply lands.
 *   - **assisted** — only `prose_edit` envelopes with `risk: "mechanical"`
 *     auto-approve. Everything else queues. The design's "safe default"
 *     for assisted mode is "deterministic mechanical prose fixes only."
 *   - **autonomous** — auto-approve any kind whose risk is at or below
 *     `autoApproveRiskCeiling` (default `"low"`), unless the kind is in
 *     the policy's `manualKinds` blocklist (default
 *     `["canon_update", "planning_edit"]` because Canon and planning
 *     mutations need human attention by design's manual safe default).
 *     If the envelope's `policyRecommendation.decision ===
 *     "reject"`, the policy honors that (reject overrides auto-approve).
 *   - **eval** — never mutates. Every proposal returns `shadow` with the
 *     same reason text the policy would have used to approve / reject /
 *     queue. Phase 7's replay harness compares shadow decisions against
 *     human decisions for autonomy metrics.
 *
 * ## Why include the producer's `policyRecommendation` in the input?
 *
 * Producers (LLM editorial modules, lint converter, planner) carry domain
 * context the policy doesn't have access to. A `prose_edit` envelope from
 * the lint converter knows it's deterministic + mechanical and can
 * recommend `approve`. The policy reads that as a SIGNAL to bias toward
 * approve (still gated by the policy's own rules), but it isn't bound
 * by it — autonomous mode might still queue if `risk: "high"` even with
 * a producer recommendation of `approve`. Conversely, a producer that
 * recommends `reject` (e.g., a flag with a blocker severity) overrides
 * the policy's approve rule.
 *
 * ## Risk-ceiling ordering
 *
 * `mechanical < low < medium < high`. A ceiling of `"low"` means
 * `mechanical` and `low` auto-approve; `medium` and `high` queue. The
 * monotone ordering is a deliberate constraint — risk levels are
 * comparable so operators can reason about thresholds.
 */

import type {
  ReviewProposalEnvelope,
  ProposalEnvelopeKind,
  ProposalEnvelopeRisk,
} from "./proposal-envelope"

export type ApprovalPolicyMode = "manual" | "assisted" | "autonomous" | "eval"

export interface ApprovalPolicy {
  version: string
  mode: ApprovalPolicyMode
  /**
   * For autonomous mode: the highest risk level that may auto-approve.
   * Defaults to `"low"`. Levels strictly above this auto-queue. Has no
   * effect in manual / assisted / eval modes.
   */
  autoApproveRiskCeiling?: ProposalEnvelopeRisk
  /**
   * Kinds that always queue regardless of mode (except eval, which
   * shadows everything). Defaults to `["canon_update", "planning_edit"]` —
   * the design's manual safe default for Canon and planning mutations. Pass
   * an empty array to opt out.
   */
  manualKinds?: ReadonlyArray<ProposalEnvelopeKind>
}

export type PolicyDecision = "queue" | "approve" | "reject" | "shadow"

export interface PolicyEvaluation {
  decision: PolicyDecision
  /**
   * Always carries the policy version so the resolve route can persist
   * `(decision, policyVersion)` for the audit trail (design's "record
   * policy decision and policy version on every proposal resolution").
   */
  policyVersion: string
  reasons: string[]
  /**
   * For `eval` mode: what the policy WOULD have decided in the
   * corresponding non-eval mode. The resolve route logs this for Phase 7
   * replay metrics. Undefined in non-eval modes.
   */
  shadowOf?: PolicyDecision
}

const RISK_RANK: Record<ProposalEnvelopeRisk, number> = {
  mechanical: 0,
  low: 1,
  medium: 2,
  high: 3,
}

const DEFAULT_RISK_CEILING: ProposalEnvelopeRisk = "low"
const DEFAULT_MANUAL_KINDS: ReadonlyArray<ProposalEnvelopeKind> = [
  "canon_update",
  "planning_edit",
]

/**
 * Evaluate an envelope against a policy. Pure function: no side effects,
 * no DB, no LLM. Returns the policy decision plus reasons (each reason
 * is a short string the resolve route can persist or surface to the
 * operator).
 *
 * The function is total — every envelope returns a decision. There's no
 * "policy doesn't apply" path; the four modes cover the space.
 */
export function evaluatePolicy(
  envelope: ReviewProposalEnvelope,
  policy: ApprovalPolicy,
): PolicyEvaluation {
  if (policy.mode === "eval") {
    // Recursive call into the policy as if it were autonomous + autoApproveRiskCeiling.
    // We use the autonomous variant because eval mode is meant to capture
    // "what would policy do if we ran it for real" — autonomous is the
    // most-active variant; manual/assisted shadow-evaluations would never
    // emit interesting decisions.
    const inner = evaluatePolicy(envelope, {
      ...policy,
      mode: "autonomous",
    })
    return {
      decision: "shadow",
      policyVersion: policy.version,
      reasons: [`mode=eval; would-have=${inner.decision}`, ...inner.reasons],
      shadowOf: inner.decision,
    }
  }

  const manualKinds = policy.manualKinds ?? DEFAULT_MANUAL_KINDS
  if (manualKinds.includes(envelope.kind)) {
    return {
      decision: "queue",
      policyVersion: policy.version,
      reasons: [`kind=${envelope.kind} is in manualKinds (always queues)`],
    }
  }

  // Producer reject overrides any approve path.
  if (envelope.policyRecommendation.decision === "reject") {
    const producerReasons = envelope.policyRecommendation.reasons ?? []
    return {
      decision: "reject",
      policyVersion: policy.version,
      reasons: [
        `producer recommended reject`,
        ...producerReasons,
      ],
    }
  }

  if (policy.mode === "manual") {
    return {
      decision: "queue",
      policyVersion: policy.version,
      reasons: [`mode=manual; all proposals queue`],
    }
  }

  if (policy.mode === "assisted") {
    if (envelope.kind === "prose_edit" && envelope.risk === "mechanical") {
      return {
        decision: "approve",
        policyVersion: policy.version,
        reasons: [
          `mode=assisted; prose_edit at risk=mechanical auto-approves`,
        ],
      }
    }
    return {
      decision: "queue",
      policyVersion: policy.version,
      reasons: [
        `mode=assisted; only prose_edit at risk=mechanical auto-approves; ` +
        `kind=${envelope.kind} risk=${envelope.risk} queues`,
      ],
    }
  }

  // mode === "autonomous"
  const ceiling = policy.autoApproveRiskCeiling ?? DEFAULT_RISK_CEILING
  if (RISK_RANK[envelope.risk] <= RISK_RANK[ceiling]) {
    return {
      decision: "approve",
      policyVersion: policy.version,
      reasons: [
        `mode=autonomous; risk=${envelope.risk} <= ceiling=${ceiling}`,
      ],
    }
  }
  return {
    decision: "queue",
    policyVersion: policy.version,
    reasons: [
      `mode=autonomous; risk=${envelope.risk} > ceiling=${ceiling}`,
    ],
  }
}
