/**
 * Context generation and scoring service.
 * High-level operations for the daemon to generate context and evaluate quality.
 */

import { buildContext } from "../agents/writer/context"
import { getChapterOutline, getCharacters } from "../db"
import { searchForScene, buildSceneQuery, hasEmbeddings, getRetrievalConfig, type RetrievalConfig } from "../db/retrieval"

export { getRetrievalConfig, hasEmbeddings }
export { saveRetrievalConfig, DEFAULT_CONFIG } from "../db/retrieval"

/** Generate context for a specific chapter and return the assembled string */
export async function generateContext(novelId: string, chapterNum: number): Promise<string> {
  return buildContext(novelId, chapterNum)
}

/** Check if semantic retrieval is available for a novel */
export async function isSemanticReady(novelId: string): Promise<boolean> {
  return hasEmbeddings(novelId)
}

/** Get context retrieval stats for a novel (for diagnostics) */
export async function getRetrievalStats(novelId: string): Promise<{
  hasEmbeddings: boolean
  config: RetrievalConfig
}> {
  const [embedReady, config] = await Promise.all([
    hasEmbeddings(novelId),
    getRetrievalConfig(novelId),
  ])
  return { hasEmbeddings: embedReady, config }
}
