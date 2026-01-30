# CLAUDE.md

## What This Is

FRAKTAG — a Fractal Knowledge Engine. Organizes raw information into structured, navigable hierarchies (not "vector soup"). Human-supervised ingestion with full audit trails.

Architecture: Hexagonal (Ports & Adapters). Core domain isolated from infrastructure.

## Monorepo Structure

```
packages/
├── engine/   # Core TypeScript (ESM, NodeNext) — Fractalizer, Navigator, Arborist, Stores
├── mcp/      # MCP server for Claude Code integration (fraktag_search, fraktag_ingest, etc.)
├── api/      # Express REST + SSE bridge (port 3000)
└── ui/       # React 19 + Vite 6 + Tailwind v4 + Shadcn
```

Each package has a `MAP.md` with detailed internal architecture. Read the relevant MAP before modifying a package.

## Deep-Dive Documentation

Read the relevant doc before working in an unfamiliar area:

- `docs/node-type-rules.md` — Strict hierarchy constraints, type guards, validation
- `docs/nugget-pattern.md` — How to create/modify LLM calls, all 12 nuggets listed
- `docs/streaming-architecture.md` — SSE chain, abort support, event types
- `docs/ingestion-workflow.md` — Human-supervised vs direct (agent) ingestion
- `docs/retrieval-pipeline.md` — Navigator phases, budget control, MCP raw tools
- `docs/mcp-integration.md` — MCP tools, taxonomy, setup, nightly compounding
- `docs/lessons-learned.md` — Past bugs and gotchas (read to avoid repeating them)

## Build & Verify

```bash
npm install                                    # Install all (from root)
npm run build --workspace=@fraktag/engine      # Build engine
npm run build --workspace=@fraktag/mcp         # Build MCP server
npm run test --workspace=@fraktag/engine       # Run tests
npm run dev --workspace=@fraktag/engine        # Watch mode
npm run dev --workspace=api                    # API server (port 3000)
npm run dev --workspace=@fraktag/ui            # UI dev server (port 5173)
```

Config: copy `packages/engine/data/config.OpenAIexample.json` or `config.OLLAMAexample.json` to `config.json`. Set API key or verify Ollama endpoint. Then: `cd packages/engine && npx tsx src/cli.ts setup`

## Key Entry Points

- Engine: `packages/engine/src/index.ts` (Fraktag class)
- Types: `packages/engine/src/core/types.ts`
- Navigator: `packages/engine/src/core/Navigator.ts`
- API: `packages/api/src/server.ts`
- MCP: `packages/mcp/src/index.ts`
- UI page: `packages/ui/src/pages/KnowledgeTree.tsx`

## Coding Rules

### Strict Node Types — NEVER violate these
- `folder | document | fragment` — three types, no exceptions.
- Folders contain EITHER sub-folders OR documents, never both.
- Documents/fragments only in leaf folders.
- Use type guards: `isFolder()`, `isDocument()`, `isFragment()`, `hasContent()`.

### LLM Calls — Always use Nuggets
All LLM calls go through Nuggets (`src/nuggets/`). Never call `llm.complete()` directly in Navigator, Fractalizer, or index.ts.
- Each nugget declares `expectsJSON` — the adapter handles JSON mode.
- For streaming: use `nugget.prepareVariables()` + `substituteTemplate()` + `llm.stream()`.
- New LLM call? Create a nugget file, define `TInput`/`TOutput`, implement `prepareVariables()`/`parseOutput()`, re-export from `nuggets/index.ts`.

### SSE Streaming Pattern
Chain: LLM Adapter (`stream()` + `onChunk`) → Engine (`askStream()` emits events) → API (SSE endpoint) → UI (`EventSource`).
Events: `thinking`, `source`, `chunk`, `done`, `error`.

### API Conventions
- All endpoints return JSON. Errors: `{ error: string }`.
- Streaming uses SSE via `res.write()` with `!res.writableEnded` guard.
- Abort: `res.on('close')` with `!res.writableFinished` check (NOT `req.on('close')`).

### UI Conventions
- Auto-save with debounce (800ms) for title/gist edits.
- Complex features as extracted dialog components (IngestionDialog, ChatDialog, MoveDialog).
- SSE via `EventSource`, auto-scroll during streaming.

## Configuration Keys

- `llm.adapter`: `"openai" | "ollama" | "mlx"`
- `llm.model` / `basicModel` / `expertModel`: Council of Three (Scout/Architect/Sage)
- `llm.contextWindow`: Max chars for retrieval context budget (default 25000)
- `llm.numCtx`: Ollama context window in tokens. Rule: `contextWindow < numCtx * 3`
- `embedding.adapter`: `"openai" | "ollama"`

## MCP Integration

The `@fraktag/mcp` package exposes FRAKTAG as Claude Code's memory. Two tool tiers:
- **Smart tools** (fraktag_search, fraktag_ask): use FRAKTAG's LLM pipeline.
- **Raw tools** (fraktag_vector_search, fraktag_tree_map, fraktag_get_node): no LLM — Claude IS the brain.
- **Write tools** (fraktag_ingest): direct ingestion, bypasses human review, auto-creates folders.

Setup: `./scripts/setup-memory.sh` then `./scripts/setup-mcp.sh`.
