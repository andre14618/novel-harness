/**
 * Continuity benchmark.
 *
 * Tests the continuity checker: given prose with planted contradictions,
 * does the checker find them?
 *
 * Dimensions: Issue Detection, Fix Quality
 *
 * Run: bun benchmark/continuity/run.ts
 *      bun benchmark/continuity/run.ts --save-baseline
 *
 * NOTE: Requires test fixtures in benchmark/continuity/fixtures/.
 */

import { runBenchmark } from "../engine"
import { config } from "./generate"

runBenchmark(config)
