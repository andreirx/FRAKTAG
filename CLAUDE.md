# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FRAKTAG (The Fractal Knowledge Engine) organizes raw information into a structured, navigable hierarchy. Unlike standard RAG ("Vector Soup"), it creates a persistent "Mental Map" with both AI-driven synthesis and human exploration.

**Architecture:** Hexagonal (Ports & Adapters) - Core domain logic isolated from infrastructure.

## Build & Run Commands

```bash
# Install dependencies (from root)
npm install

# Build engine
npm run build --workspace=@fraktag/engine

# Watch mode for engine development
npm run dev --workspace=@fraktag/engine

# Run tests (engine only)
npm run test --workspace=@fraktag/engine

# Start API server (port 3000)
npm run dev --workspace=api

# Start UI dev server (port 5173)
npm run dev --workspace=@fraktag/ui

# Build UI for production
npm run build --workspace=@fraktag/ui
```

**Full local setup:** Run all three in separate terminals: engine (watch), api, ui.

## Monorepo Structure

```
packages/
├── engine/          # Core TypeScript logic (ESM, NodeNext)
│   ├── src/
│   │   ├── core/    # ContentStore, TreeStore, VectorStore, Fractalizer, Navigator, Arborist
│   │   ├── adapters/
│   │   │   ├── llm/        # ILLMAdapter → OllamaAdapter, OpenAIAdapter
│   │   │   ├── embeddings/ # IEmbeddingAdapter → Ollama, OpenAI
│   │   │   ├── storage/    # IStorage → JsonStorage
│   │   │   └── parsing/    # IFileParser → PdfParser, TextParser
│   │   ├── prompts/        # LLM prompt templates
│   │   └── cli.ts          # CLI binary (fkt command)
│   └── data/               # Runtime data (config, content, trees, indexes)
├── api/             # Express REST bridge (tsx, port 3000)
└── ui/              # React 19 + Vite 6 + Tailwind v4 + Shadcn
```

## Core Components

### The "Council of Three" AI Strategy
Three model tiers for cost/latency/intelligence balance:
- **Scout** (basicModel): Fast/cheap for routing, gists, relevance checks
- **Architect** (model): Standard for ingestion, splitting, heresy detection
- **Sage** (expertModel): Deep reasoning for structural auditing

### Core Engines
- **Fractalizer** (BETA): Ingestion/splitting with surgical census approach
- **Navigator**: Ensemble retrieval (Vector Paratroopers → Global Map Scan → Precision Drilling)
- **Arborist** (BETA): Tree maintenance (audit, cluster, prune, move)
- **ContentStore**: Immutable CAS with SHA-256 deduplication
- **TreeStore**: Monolithic JSON hierarchy per tree
- **VectorStore**: Flat JSON embedding index

## Data Model

**Content Atom:** Immutable blob with `id`, `hash`, `payload`, `sourceUri`, `supersedes` chain

**Tree Node:** `id`, `treeId`, `parentId`, `path`, `contentId`, `l0Gist` (label), `l1Map` (summary with childInventory/outboundRefs)

**Tree Config:** `organizingPrinciple` (guides summaries), `autoPlace`, `placementStrategy`, `dogma` (heresy prevention rules)

## API Endpoints (port 3000)

- `GET /api/trees` - List trees
- `GET /api/trees/:id/structure` - Full recursive tree
- `GET /api/trees/:id/visual` - Bash-style visualization
- `GET /api/content/:id` - Raw content payload
- `POST /api/ask` - Chat/synthesis with sources

## CLI Commands (fkt)

```bash
fkt setup              # Initialize trees from config
fkt ingest-file <path> [treeId]
fkt ingest-dir <dir> [treeId]
fkt browse [treeId]    # Print tree structure
fkt retrieve <query>   # Query retrieval
fkt ask <query>        # RAG synthesis with sources
fkt audit [--apply]    # Tree audit with optional auto-fix
fkt reset [--prune]    # Clear tree
```

## Configuration

Copy `config.OLLAMAexample.json` or `config.OpenAIexample.json` to `packages/engine/data/config.json`.

Key settings:
- `llm.adapter`: "openai" | "ollama"
- `llm.model`, `llm.basicModel`, `llm.expertModel`: Council of Three models
- `embedding.adapter`: "openai" | "ollama"
- `ingestion.splitThreshold`, `maxDepth`, `chunkOverlap`

Environment: `FRAKTAG_OPENAI_KEY` or `FRAKTAG_CONFIG` path override.

## Tech Stack

- **Engine:** TypeScript (strict ESM), Node.js v22+, Vitest
- **API:** Express + tsx
- **UI:** React 19, Vite 6, Tailwind CSS v4, Shadcn UI (Radix), react-resizable-panels
- **LLM:** Ollama (local) or OpenAI API
- **Embeddings:** nomic-embed-text (Ollama) or text-embedding-3-small (OpenAI)

## Key Files

- Entry point: `packages/engine/src/index.ts` (Fraktag class)
- Types: `packages/engine/src/core/types.ts`
- CLI: `packages/engine/src/cli.ts`
- API server: `packages/api/src/server.ts`
- Main UI: `packages/ui/src/pages/KnowledgeTree.tsx`
- Tree renderer: `packages/ui/src/components/fraktag/TreeItem.tsx`

## Component Status

- ✅ Retrieval (Navigator): Highly accurate
- ✅ UI: Functional with live reload during ingestion
- ⚠️ Fractalizer: BETA - chunking strategy in development
- ⚠️ Arborist: BETA - limited autonomy
