#!/usr/bin/env bun
/**
 * Codex-proposer wrapper — SKELETON.
 *
 * Reads the iteration history JSONL + the Phase 0 knob schema + the
 * research question from docs/designs/autonomous-context-loop.md and
 * invokes `codex exec` with gpt-5.4 effort=high to produce one
 * next-config JSON.
 *
 * Why separate from driver.ts: the driver is pure control flow; the
 * Codex prompt assembly + response parsing is its own concern and
 * lives here.
 *
 * INTENDED SHAPE (not yet implemented):
 *   bun propose-next-planning-config.ts \
 *     --history scripts/autonomous-loop/history/planning-beats-loop.jsonl \
 *     --out scripts/autonomous-loop/variants/iter-003.config.json
 *
 * Uses the gpt-5-4-prompting pattern from memory
 * feedback_codex_gpt54_subagents. Prompt shape:
 *
 *   <task>
 *     <description>Propose next planning-beats config.</description>
 *     <history_jsonl>...</history_jsonl>
 *     <knob_space>...Phase 0 subset from inventory §1.2...</knob_space>
 *     <research_question>From design doc §"Research question"</research_question>
 *     <constraints>
 *       - Change exactly ONE knob per iteration unless you have a
 *         pre-registered reason for a 2-knob delta.
 *       - Explain the hypothesis in proposer_reasoning (2-3 sentences).
 *     </constraints>
 *   </task>
 *   <compact_output_contract>One JSON config matching the schema.</compact_output_contract>
 */

throw new Error("propose-next-planning-config.ts: skeleton only, not implemented")
