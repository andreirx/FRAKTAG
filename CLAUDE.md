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

# Initialize trees from config
cd packages/engine && npx tsx src/cli.ts setup
```

**Full local setup:** Run all three in separate terminals: engine (watch), api, ui.

## Quick Setup (New Installation)

```bash
# 1. Install
npm install && npm run build --workspace=@fraktag/engine

# 2. Configure (choose one)
cp packages/engine/data/config.OpenAIexample.json packages/engine/data/config.json
# OR
cp packages/engine/data/config.OLLAMAexample.json packages/engine/data/config.json

# 3. Edit config.json with your API key (OpenAI) or verify Ollama endpoint

# 4. Initialize trees
cd packages/engine && npx tsx src/cli.ts setup && cd ../..

# 5. Run (3 terminals)
npm run dev --workspace=@fraktag/engine  # Terminal 1
npm run dev --workspace=api              # Terminal 2
npm run dev --workspace=@fraktag/ui      # Terminal 3

# 6. Open http://localhost:5173
```

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
2. **Split Detection** - Programmatic (H1/H2/H3/HR/numbered sections/custom regex) or AI-assisted
3. **Human Review** - Edit splits, merge sections, nested splitting per-section, document minimap
4. **Placement** - AI proposes folder, human can override, create folders inline
5. **Commit** - Creates nodes with full audit trail

Key features:
- **Document minimap:** Visual preview showing where splits fall on the document
- Smart title detection for repeated delimiter patterns
- **Numbered section splitting:** Detects `1.`, `A.`, `I.`, `1.1.`, etc.
- **Custom regex splitting:** User-defined patterns for domain-specific documents
- Per-section nested splitting (further split large sections)
- **Auto-recovery:** Detects when AI splits miss content and adds remaining text
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
- `POST /api/ask` - RAG synthesis with sources (returns complete response)
- `GET /api/ask/stream` - **Streaming RAG synthesis via SSE** (real-time sources + answer)
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

**Knowledge Base Config (Planned):** Self-contained KB definition with `id`, `name`, `organizingPrinciple`, `seedFolders`, `dogma`

**Audit Log:** Append-only text file at `trees/{treeId}.audit.log` with entries:
```
[timestamp] [ACTOR] ACTION: details (session: id)
```

## Data Portability

### Current Structure
```
packages/engine/data/
├── config.json     # Tree definitions + adapter settings
├── content/        # Shared content store
├── indexes/        # Shared vector indexes
└── trees/          # Tree JSON + audit logs
```

### Planned Portable Structure
```
knowledge-bases/
├── my-kb/
│   ├── kb.json     # KB definition (extracted from config)
│   ├── content/    # KB-specific content
│   ├── indexes/    # KB-specific indexes
│   └── trees/      # KB trees (can have multiple)
```

### Manual Portability (Current)
To share a knowledge base:
1. Export tree definition from config.json
2. Copy tree file + audit log from `trees/`
3. Copy referenced content files from `content/`
4. Copy index file from `indexes/`
5. At destination: add tree config to config.json, run `fkt setup`

## Tech Stack

- **Engine:** TypeScript (strict ESM), Node.js v22+, Vitest
- **API:** Express + tsx
- **UI:** React 19, Vite 6, Tailwind CSS v4, Shadcn UI (Radix), react-resizable-panels
- **LLM:** Ollama (local) or OpenAI API
- **Embeddings:** nomic-embed-text (Ollama) or text-embedding-3-small (OpenAI)

## Key Files

- Entry point: `packages/engine/src/index.ts` (Fraktag class with `ask()` and `askStream()`)
- Types: `packages/engine/src/core/types.ts`
- CLI: `packages/engine/src/cli.ts`
- API server: `packages/api/src/server.ts`
- Main UI: `packages/ui/src/pages/KnowledgeTree.tsx`
- **UI Components:**
  - `packages/ui/src/components/fraktag/IngestionDialog.tsx` - Multi-step ingestion wizard with minimap
  - `packages/ui/src/components/fraktag/QueryDialog.tsx` - Streaming Q&A dialog with SSE
  - `packages/ui/src/components/fraktag/MoveDialog.tsx` - Node relocation with folder creation
  - `packages/ui/src/components/fraktag/TreeItem.tsx` - Recursive tree renderer
- **LLM Adapters:**
  - `packages/engine/src/adapters/llm/ILLMAdapter.ts` - Interface with `complete()` and `stream()` methods
  - `packages/engine/src/adapters/llm/OpenAIAdapter.ts` - OpenAI implementation with streaming support

## Package MAP Files

Each package has a detailed `MAP.md` file explaining its internal architecture:
- `packages/engine/MAP.md` - Core engine components, data flow, adapters
- `packages/api/MAP.md` - API endpoints, SSE streaming, error handling
- `packages/ui/MAP.md` - React components, state management, styling patterns

## Component Status

- ✅ Ingestion: Human-supervised with audit trails, minimap, custom regex, numbered sections
- ✅ Retrieval (Navigator): Highly accurate with streaming support
- ✅ UI: Auto-save, folder management, ingestion wizard, streaming Q&A
- ✅ Streaming: Real-time sources + answer via SSE
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
- **Document minimap:** Color-coded visual preview of split positions
- **Streaming UI:** EventSource for SSE, auto-scroll during streaming, blinking cursor
- **Dialog extraction:** Complex dialogs (Ingestion, Query, Move) as separate components

### API Patterns
- All endpoints return JSON
- Errors return `{ error: string }`
- Node operations update `updatedAt` timestamp
- Audit operations append to log file (never overwrite)
- **Streaming endpoint:** `GET /api/ask/stream` uses Server-Sent Events (SSE):
  - `event: source` - Emits each source as discovered
  - `event: chunk` - Emits answer text chunks
  - `event: done` - Signals completion with references
  - `event: error` - Error handling

### Streaming Architecture
The streaming system enables real-time feedback during Q&A:
1. **LLM Adapter:** `ILLMAdapter.stream()` method with `onChunk` callback
2. **Engine:** `Fraktag.askStream()` emits events for sources and answer chunks
3. **API:** SSE endpoint at `/api/ask/stream` with proper headers
4. **UI:** `EventSource` in QueryDialog with state management for progressive display
