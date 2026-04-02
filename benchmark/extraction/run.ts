/**
 * Extraction benchmark.
 *
 * Tests the extractor agents (summary-extractor, fact-extractor, character-state):
 * given a known prose chapter, how complete and accurate are the extractions?
 *
 * Dimensions: Completeness, Accuracy
 *
 * Run: bun benchmark/extraction/run.ts
 *      bun benchmark/extraction/run.ts --save-baseline
 */

import { runBenchmark } from "../engine"
import { config } from "./generate"

runBenchmark(config)
