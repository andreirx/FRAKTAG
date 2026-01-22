# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FRAKTAG (The Fractal Knowledge Engine) organizes raw information into a structured, navigable hierarchy. Unlike standard RAG ("Vector Soup"), it creates a persistent "Mental Map" with both AI-driven synthesis and human exploration.

**Core Philosophy:** Human-supervised ingestion with full audit trails. The AI proposes, humans approve. Every decision is logged.

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

## Core Concepts

### Human-Supervised Ingestion

The default workflow for adding content:
1. **Upload** - Drag-and-drop file
2. **Split Detection** - Programmatic (H1/H2/H3/HR) or AI-assisted
3. **Human Review** - Edit splits, merge sections, nested splitting per-section
4. **Placement** - AI proposes folder, human can override
5. **Commit** - Creates nodes with full audit trail

Key features:
- Smart title detection for repeated delimiter patterns
- Per-section nested splitting (further split large sections)
- Large section warnings (>5000 chars)
- Auto-save audit logs to `trees/{treeId}.audit.log`

### Strict Node Types

```typescript
type NodeType = 'folder' | 'document' | 'fragment';
```

- **FolderNode:** Pure structure, no content. Can contain folders or content (not both).
- **DocumentNode:** Leaf content in leaf folders only. References ContentStore.
- **FragmentNode:** Child of DocumentNode. Chunked content for granular retrieval.

Every node has:
- `title` - Human-readable label
- `gist` - Semantic summary for AI and humans

### The "Council of Three" AI Strategy

Three model tiers for cost/latency/intelligence balance:
- **Scout** (basicModel): Fast/cheap for routing, gists, relevance checks
- **Architect** (model): Standard for ingestion, splitting, heresy detection
- **Sage** (expertModel): Deep reasoning for structural auditing

## API Endpoints (port 3000)

### Tree Operations
- `GET /api/trees` - List trees
- `GET /api/trees/:id` - Get tree metadata
- `GET /api/trees/:id/structure` - Full recursive tree with all nodes
- `GET /api/trees/:id/visual` - Bash-style text visualization
- `GET /api/trees/:id/folders` - Get leaf folders (valid content targets)

### Node Operations
- `PATCH /api/nodes/:id` - Update title and/or gist (auto-save)
- `PATCH /api/nodes/:id/move` - Move node to new parent folder
- `POST /api/trees/:id/folders` - Create subfolder

### Content Operations
- `GET /api/content/:id` - Raw content payload
- `POST /api/trees/:treeId/documents` - Ingest document
- `POST /api/trees/:treeId/fragments` - Create fragment under document

### AI Operations
- `POST /api/analyze` - Analyze content for splits (no ingestion)
- `POST /api/generate/title` - Generate title for content
- `POST /api/generate/gist` - Generate gist for content
- `POST /api/generate/splits` - AI-assisted content splitting
- `POST /api/propose-placement` - AI placement proposal

### Retrieval
- `POST /api/retrieve` - Vector + graph retrieval
- `POST /api/ask` - RAG synthesis with sources
- `POST /api/browse` - Navigate tree structure

### Audit & Maintenance
- `POST /api/trees/:id/audit-log` - Append audit entries
- `POST /api/trees/:id/verify` - Verify tree integrity
- `POST /api/trees/:id/audit` - Run structural audit
- `POST /api/trees/:id/reset` - Clear tree

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
- `trees[].seedFolders`: Pre-defined folder structure

Environment: `FRAKTAG_OPENAI_KEY` or `FRAKTAG_CONFIG` path override.

## Data Model

**Content Atom:** Immutable blob with `id`, `hash`, `payload`, `sourceUri`, `supersedes` chain

**Tree Node:** `id`, `treeId`, `parentId`, `type`, `title`, `gist`, `contentId` (for documents/fragments)

**Tree Config:** `organizingPrinciple` (guides summaries), `autoPlace`, `seedFolders`, `dogma` (heresy prevention rules)

**Audit Log:** Append-only text file at `trees/{treeId}.audit.log` with entries:
```
[timestamp] [ACTOR] ACTION: details (session: id)
```

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
- Ingestion dialog: `packages/ui/src/components/fraktag/IngestionDialog.tsx`
- Tree renderer: `packages/ui/src/components/fraktag/TreeItem.tsx`

## Component Status

- ✅ Ingestion: Human-supervised with audit trails
- ✅ Retrieval (Navigator): Highly accurate
- ✅ UI: Auto-save, folder management, ingestion wizard
- ⚠️ Arborist: BETA - limited autonomy

## Coding Guidelines

### Node Type Rules
- Folders with content children cannot have folder children (and vice versa)
- Documents/fragments can only be placed in leaf folders
- Always use type guards: `isFolder()`, `isDocument()`, `isFragment()`, `hasContent()`

### UI Patterns
- Auto-save with debounce (800ms) for title/gist edits
- Audit log auto-scroll to bottom
- Smart title detection for repeated delimiter headers
- Per-section nested splitting for large sections

### API Patterns
- All endpoints return JSON
- Errors return `{ error: string }`
- Node operations update `updatedAt` timestamp
- Audit operations append to log file (never overwrite)
