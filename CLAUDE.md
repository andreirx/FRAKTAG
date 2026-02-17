# CLAUDE.md

## What This Is

FRAKTAG — a Fractal Knowledge Engine. Organizes raw information into structured, navigable hierarchies (not "vector soup"). Human-supervised ingestion with full audit trails.

Architecture: Hexagonal (Ports & Adapters). Core domain isolated from infrastructure.

## Monorepo Structure

```
packages/
├── engine/   # Core TypeScript (ESM, NodeNext) — Fractalizer, Navigator, Arborist, Stores
├── api/      # Express REST + SSE bridge (port 3000)
└── ui/       # React 19 + Vite 6 + Tailwind v4 + Shadcn
```

Each package has a `MAP.md` with detailed internal architecture. Also in many relevant subfolders. Read the relevant MAP.md before modifying a package. And keep these files up to date after big refactors.

## Deep-Dive Documentation

Read the relevant doc before working in an unfamiliar area:

- `docs/node-type-rules.md` — Strict hierarchy constraints, type guards, validation
- `docs/nugget-pattern.md` — How to create/modify LLM calls, all 12 nuggets listed
- `docs/streaming-architecture.md` — SSE chain, abort support, event types
- `docs/ingestion-workflow.md` — Human-supervised vs direct (agent) ingestion
- `docs/retrieval-pipeline.md` — Navigator phases, budget control, MCP raw tools
- `docs/lessons-learned.md` — Past bugs and gotchas (read to avoid repeating them)
- `docs/lessons-learned-details.md` — Deep dives - use it when planning or major refactors

## Build & Verify

```bash
npm install                                    # Install all (from root)
npm run build --workspace=@fraktag/engine      # Build engine
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
- UI page: `packages/ui/src/pages/KnowledgeTree.tsx`

## Coding Rules

**Treat user feedback as HARD DATA.** never assume your code is correct even if it looks correct. Maybe there's something else affecting it.

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


# System Intent (WHY)
This repository contains a high-reliability, safety-critical product. The objective is rock-solid execution, not a Minimum Viable Product. Structural decisions must prioritize long-term maintainability, hardware-independence, and off-target testability. 

# Clean Architecture Directives (UNIVERSAL RULES)
1. **The Dependency Rule:** Source code dependencies must point strictly inward toward `core/`. Elements in `core/` must never import or reference entities from `adapters/` or `infrastructure/`.
2. **Boundary Enforcement:** Data crossing architectural boundaries must utilize simple Data Transfer Objects (DTOs). Do not pass framework-specific objects, hardware structs, or database rows across boundaries.
3. **Volatility Isolation:** Hardware, databases, and frameworks are volatile external details. Isolate them behind strict abstraction layers (e.g., HAL, OSAL, Gateways).
4. **Architectural Decisions:** When encountering an architectural fork, halt and ask for clarification. Do not unilaterally select an architecture pattern. Provide evidence and explain the underlying mechanics of available options to facilitate a decision.

# Progressive Disclosure Context
Do not assume domain specifics. Read the relevant files din docs before modifying their associated domains (and update them when the user input justifies it)
* architecture decisions: Historical context and existing structural boundaries.
* hardware abstractions: Protocols for the HAL and off-target simulation requirements.
* database schema: Persistence layer rules and Gateway interface implementations.
* testing strategy: Rules for the Test API and decoupled verification.

