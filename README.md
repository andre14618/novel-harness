# Novel Harness

A deterministic harness for AI-assisted novel creation. Code controls the flow, LLMs are leaf-node function calls, and a SQLite state store keeps everything coherent across chapters.

Built on the principles from [Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html) and Karpathy's [March of Nines](https://venturebeat.com/technology/karpathys-march-of-nines-shows-why-90-ai-reliability-isnt-even-close-to/).

## How It Works

The harness is a **state machine** that moves through 3 phases:

```
Concept ──> Planning ──> Drafting ──> Done
```

Each phase calls specialized LLM agents with scoped context and typed schemas. The harness (your code) decides **what happens and in what order**. The LLM decides **how it sounds**.

### Phase 1: Concept
Three agents run sequentially, each generating a structured artifact:
- **World Builder** — produces a World Bible (setting, rules, locations, culture, history)
- **Character Agent** — produces deep Character Profiles (backstory, voice, traits, relationships)
- **Plotter Agent** — produces a Story Spine (3-act structure, conflict, theme, ending direction)

Each artifact gets a human approval gate (or auto-approved with `--auto`). Checkpointed to SQLite after each agent — resumable if interrupted.

### Phase 2: Planning
All Phase 1 outputs converge into a single Plotter call that generates a **chapter-by-chapter outline** with scene beats, POV assignments, character lists, and word targets.

### Phase 3: Drafting
For each chapter:
1. **Context Assembly** (code) — queries the DB for the chapter outline, relevant character profiles, world rules, previous chapter summaries, character states, and open issues. Builds a scoped context package.
2. **Writer Agent** (LLM) — generates prose following the scene beats.
3. **Deterministic Validation** (code) — word count, POV character presence, character mentions.
4. **Continuity Check** (LLM) — cross-references draft against established facts and character states.
5. **Human Gate** — approve, revise, or reject.
6. **State Update** (3 LLM calls) — extract chapter summary, facts, and character states. Write to DB.
7. **Checkpoint** — advance `currentChapter`, write chapter file to disk.

## The State Store

Each novel gets its own SQLite database at `output/{novelId}/novel.db` with tables for:

| Table | Purpose |
|---|---|
| `novels` | Phase, current chapter, seed input |
| `world_bibles` | World bible (JSON) |
| `characters` | Character profiles (JSON per character) |
| `story_spines` | Story spine (JSON) |
| `chapter_outlines` | Per-chapter outlines with scene beats |
| `chapter_drafts` | Versioned drafts with approval status |
| `chapter_summaries` | Compressed summaries for downstream context |
| `facts` | Fact registry — searchable, per-chapter |
| `character_states` | Per-character, per-chapter state snapshots |
| `issues` | Continuity issues and revision notes |

No agent ever sees the full manuscript. Each reads only what the context assembly code gives it.

## Quick Start

```bash
# Install
bun install

# Set up API key
cp .env.example .env
# Edit .env with your OpenRouter API key

# Interactive mode
bun src/index.ts

# Auto mode (no human gates, uses test seed)
bun src/index.ts --auto

# Resume an interrupted novel
bun src/index.ts --resume novel-1774838177106
bun src/index.ts --auto --resume novel-1774838177106
```

## Configuration

Edit `.env` to change the model:

```bash
OPENROUTER_API_KEY="your-key"
MODEL="stepfun/step-3.5-flash:free"  # default
```

Free models available on OpenRouter:
- `stepfun/step-3.5-flash:free` — 196B MoE, 60+ tps, 256K context (default)
- `nvidia/nemotron-3-super-120b-a12b:free` — native JSON mode, 262K context
- `nousresearch/hermes-3-llama-3.1-405b:free` — best prose quality, slow
- `google/gemma-3-27b-it:free` — native structured outputs, 131K context

## Testing

```bash
bun test              # 126 tests, ~120ms
```

Tests cover: Zod schemas, all DB CRUD operations, JSON extraction, LLM wrapper with mocked fetch, deterministic validation, context assembly, logging, phase orchestration, and state machine transitions.

## Architecture

```
src/
  index.ts            # Entry point, --auto and --resume flags
  types.ts            # All interfaces + Zod schemas
  db.ts               # SQLite schema, migrations, query helpers
  llm.ts              # callAgent() wrapper for OpenRouter
  prompts.ts          # System prompts for 9 agent roles
  context.ts          # Context assembly (DB queries -> prompt strings)
  validation.ts       # Deterministic checks (word count, characters)
  logger.ts           # File-based logging with checkpoints
  cli.ts              # Interactive CLI with auto-approve mode
  state-machine.ts    # Phase orchestrator (while loop + switch)
  phases/
    concept.ts        # Phase 1: world + characters + plot
    planning.ts       # Phase 2: chapter-by-chapter outline
    drafting.ts       # Phase 3: write -> validate -> check -> approve loop
```

## Design Principles

- **Code decides what, LLM decides how** — the state machine, context assembly, and validation are all deterministic code. The LLM only generates text within typed schemas.
- **File system as checkpoint** — every successful operation is persisted to SQLite. Resume from any interruption.
- **Scoped context** — no agent sees the full novel. Each gets a precise context package assembled by code.
- **Separate writer and editor** — the writer generates, the continuity agent checks. Self-editing is unreliable.
- **Schemas with defaults** — free-tier models don't follow JSON schemas perfectly. Zod defaults prevent failures on missing optional fields.

## Output

```
output/{novelId}/
  novel.db          # SQLite state store
  harness.log       # Timestamped log of all operations
  chapter-1.md      # Approved prose
  chapter-2.md
  ...
```
