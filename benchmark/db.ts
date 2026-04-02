/**
 * Benchmark DB layer.
 *
 * Re-exports from the central data/db.ts with benchmark-specific wrappers.
 * Benchmark scripts import from here.
 */

import {
  getCentralDB,
  createRun as _createRun,
  logLLMCall as _logLLMCall,
  saveGeneration as _saveGeneration,
  saveScore as _saveScore,
  markBaseline as _markBaseline,
  getRunAverages as _getRunAverages,
  getBaselineAverages as _getBaselineAverages,
  getOverallAvg as _getOverallAvg,
  getPerSeedAverages as _getPerSeedAverages,
  getWeakestGenerations as _getWeakestGenerations,
  getScoresForGeneration as _getScoresForGeneration,
  getCallSummary as _getCallSummary,
  getRecentRuns as _getRecentRuns,
  getAgentModelScores as _getAgentModelScores,
  compareRuns as _compareRuns,
  getModelStats as _getModelStats,
  createTuningExperiment as _createTuningExperiment,
  concludeExperiment as _concludeExperiment,
  saveTuningResult as _saveTuningResult,
  getTuningExperiments as _getTuningExperiments,
  getTuningResults as _getTuningResults,
  getExperimentRuns as _getExperimentRuns,
  getExperimentScores as _getExperimentScores,
  getExperimentLintSummary as _getExperimentLintSummary,
  getExperimentCost as _getExperimentCost,
  saveExperimentSummary as _saveExperimentSummary,
  deleteExperiment as _deleteExperiment,
} from "../data/db"

export type { DimensionAvg, LLMCallData } from "../data/db"

// Re-export everything with original names
export const getDB = getCentralDB
export const createRun = _createRun
export const saveGeneration = _saveGeneration
export const saveScore = _saveScore
export const markBaseline = _markBaseline
export const getRunAverages = _getRunAverages
export const getBaselineAverages = _getBaselineAverages
export const getOverallAvg = _getOverallAvg
export const getPerSeedAverages = _getPerSeedAverages
export const getWeakestGenerations = _getWeakestGenerations
export const getScoresForGeneration = _getScoresForGeneration
export const getCallSummary = _getCallSummary
export const getRecentRuns = _getRecentRuns
export const getAgentModelScores = _getAgentModelScores
export const compareRuns = _compareRuns
export const getModelStats = _getModelStats
export const createTuningExperiment = _createTuningExperiment
export const concludeExperiment = _concludeExperiment
export const saveTuningResult = _saveTuningResult
export const getTuningExperiments = _getTuningExperiments
export const getTuningResults = _getTuningResults
export const getExperimentRuns = _getExperimentRuns
export const getExperimentScores = _getExperimentScores
export const getExperimentLintSummary = _getExperimentLintSummary
export const getExperimentCost = _getExperimentCost
export const saveExperimentSummary = _saveExperimentSummary
export const deleteExperiment = _deleteExperiment

// Benchmark-specific wrapper for logging LLM calls
export function saveLLMCall(
  runId: number,
  callType: string,
  agent: string | null,
  model: string, provider: string,
  promptTokens: number, completionTokens: number,
  latencyMs: number, cost: number,
  meta?: { seed?: string; dimension?: string; attempt?: number },
) {
  _logLLMCall(runId, {
    agent: agent ?? callType,
    phase: callType === "judge" ? "judge" : "generation",
    model,
    provider,
    promptTokens,
    completionTokens,
    latencyMs,
    cost,
    seed: meta?.seed,
    dimension: meta?.dimension,
  })
}
