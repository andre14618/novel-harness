/**
 * Planning benchmark.
 *
 * Tests the planning-plotter agent: given a seed (world + characters + story spine),
 * how good are the chapter outlines it produces?
 *
 * Dimensions: Beat Specificity, Dialogue Cues, Emotional Arc, Five Commandments, Dialogue Cue Detail
 *
 * Run: bun benchmark/planning/run.ts
 *      bun benchmark/planning/run.ts --save-baseline
 */

import { runBenchmark } from "../engine"
import { config } from "./generate"

runBenchmark(config)
