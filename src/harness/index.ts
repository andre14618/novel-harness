/**
 * Harness service layer — typed API for all harness operations.
 *
 * Usage:
 *   import * as harness from "../harness"
 *   const scores = await harness.scores.getDimensionScores(["prose", "context"])
 *   const config = await harness.context.getRetrievalConfig(novelId)
 *   await harness.embeddings.embedChapterData(novelId, chapterNum)
 */

import * as experiments from "./experiments"
import * as context from "./context"
import * as embeddings from "./embeddings"
import * as graph from "./graph"
import * as novels from "./novels"
import * as deterministic from "./deterministic"
import * as registry from "./registry"
import * as enforce from "./enforce"

export { experiments, context, embeddings, graph, novels, deterministic, registry, enforce }
