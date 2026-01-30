# Project FRAKTAG: The Fractal Knowledge Engine

**Mission:** To organize raw information into a structured, navigable, and high-fidelity hierarchy. Unlike standard RAG (which is "Vector Soup"), FRAKTAG creates a persistent "Mental Map" allowing for both AI-driven synthesis and human exploration.

**Philosophy:** Human-supervised ingestion with full audit trails. The AI proposes, humans approve. Every decision is logged.

---

## Quick Start

### Prerequisites

- **Node.js v22+** (required)
- **npm** (comes with Node.js)
- **Either:**
  - **Ollama** (for local inference) - [Install from ollama.ai](https://ollama.ai)
  - **OpenAI API Key** (for cloud inference)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd FRAKTAG

# Install all dependencies (monorepo)
npm install

# Build the engine
npm run build --workspace=@fraktag/engine
```

### Configuration

Copy one of the example configs to create your configuration:

**Option A: Using OpenAI (Recommended for quick start)**
```bash
cp packages/engine/data/config.OpenAIexample.json packages/engine/data/config.json
```

Then edit `packages/engine/data/config.json` and add your API key:
```json
{
  "llm": {
    "adapter": "openai",
    "model": "gpt-4.1-mini",
    "basicModel": "gpt-4.1-mini",
    "expertModel": "gpt-4.1",
    "apiKey": "sk-your-api-key-here",
    "contextWindow": 250000
  },
  "embedding": {
    "adapter": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "sk-your-api-key-here"
  }
}
```

**Option B: Using Ollama (Local/Free)**
```bash
cp packages/engine/data/config.OLLAMAexample.json packages/engine/data/config.json
```

Make sure Ollama is running and pull the required models:
```bash
# Start Ollama (if not already running)
ollama serve

# Pull models (in another terminal)
ollama pull qwen2.5:14b          # Or your preferred model
ollama pull nomic-embed-text     # For embeddings
```

The Ollama config looks like:
```json
{
  "llm": {
    "adapter": "ollama",
    "model": "qwen2.5:14b",
    "basicModel": "qwen2.5:7b",
    "endpoint": "http://localhost:11434",
    "numCtx": 32768,
    "contextWindow": 25000
  },
  "embedding": {
    "adapter": "ollama",
    "model": "nomic-embed-text",
    "endpoint": "http://localhost:11434"
  }
}
```

**Context window tuning:** `numCtx` sets the Ollama model's context window in **tokens**. `contextWindow` sets the max **characters** of source content packed into retrieval prompts (also used for map scan chunking and debug prompt saving). Since 1 token is roughly 3-4 characters, set `contextWindow` conservatively below `numCtx * 3` to leave room for the prompt template, user question, and conversation history. For example, `numCtx: 32768` (~100k chars) pairs well with `contextWindow: 25000-50000`. Cloud models with large context windows (OpenAI, Anthropic) can use much higher values like `250000`.

### Initialize Trees

After configuring, set up the initial tree structure:
```bash
cd packages/engine
npx tsx src/cli.ts setup
```

### Running the Application

You need **three terminals** running simultaneously:

**Terminal 1: Engine (watch mode for development)**
```bash
npm run dev --workspace=@fraktag/engine
```

**Terminal 2: API Server (port 3000)**
```bash
npm run dev --workspace=api
```

**Terminal 3: UI Dev Server (port 5173)**
```bash
npm run dev --workspace=@fraktag/ui
```

Then open your browser to: **http://localhost:5173**

### Verify Setup

1. The UI should show a tree selector in the left sidebar
2. Select a tree (e.g., "Master Notes" or "ARDA Protocol")
3. You should see the seed folder structure
4. Click the **+** button to open the ingestion dialog
5. Try dragging a markdown or text file to ingest

### Troubleshooting

**"Engine not ready" error:**
- Make sure the API server is running on port 3000
- Check that `config.json` exists and is valid JSON

**"Connection refused" to Ollama:**
- Ensure Ollama is running: `ollama serve`
- Check the endpoint in config matches (default: `http://localhost:11434`)

**Empty tree / No folders:**
- Run `npx tsx src/cli.ts setup` from the engine directory
- Check that your config.json has `trees` with `seedFolders` defined

**API key errors (OpenAI):**
- Verify your API key is correct in config.json
- Ensure you have credits/quota on your OpenAI account

---

## 1. High-Level Architecture

The system follows a **Hexagonal (Ports & Adapters)** architecture, ensuring the Core Domain logic is isolated from the infrastructure (Local Disk vs AWS S3, Ollama vs OpenAI).

*   **The Brain (Engine):** Pure TypeScript logic for ingestion, organization, and retrieval.
*   **The Memory (Storage):** Content Addressable Storage (CAS) for raw data + Monolithic JSON for structure.
*   **The Interface (UI):** A React-based visualizer with human-supervised ingestion workflow.
*   **The Nervous System (LLM Adapters):** A tiered multi-model approach (Basic vs Smart vs Expert). Each adapter exposes `modelName` and `adapterName` for diagnostics.

### The "Council of Three" AI Strategy
The engine utilizes different classes of models for specific tasks to balance cost, latency, and intelligence:
1.  **The Scout (Optional Basic Model):** Fast/Cheap (e.g., `gpt-4.1-mini`, `qwen3-coder:30b`). Used for routing, gist generation, and relevance checks.
2.  **The Architect (Standard Model):** Reliable (e.g., `gpt-4.1-mini`, `qwen3-coder:30b`). Used for ingestion, complex splitting, and heresy detection (BETA).
3.  **The Sage (Optional Expert Model):** Deep Reasoning (e.g., `gpt-4.1`, `qwen3-coder:30b`). Used for structural auditing (BETA).

---

## 2. Human-Supervised Ingestion

FRAKTAG's core philosophy is that **humans remain in control** of how knowledge is organized. The AI assists but doesn't dictate.

### The Ingestion Workflow

1.  **Upload:** Drag-and-drop a document (Markdown, Text, PDF, JSON).
2.  **Split Detection:**
    - Programmatic methods detect natural boundaries (H1, H2, H3 headers, `---` horizontal rules)
    - **Numbered section splitting:** Detects hierarchical markers like `1.`, `A.`, `I.`, `1.1.`, `A.1.2.`, etc.
    - Smart title detection recognizes repeated delimiter patterns (e.g., `## Point` used as section markers) and extracts actual titles from content
    - **Custom regex splitting:** User-defined patterns for domain-specific documents
    - AI-assisted splitting available as an alternative
3.  **Human Review:**
    - **Document minimap:** VS Code-style visual preview showing where splits fall on the document
    - Visual preview of all proposed splits with character counts and color-coded regions
    - Large sections (>5000 chars) flagged for potential further splitting
    - Merge adjacent sections with one click
    - **Per-section nested splitting:** Further split individual sections using different methods
    - Edit titles and content directly
    - **Auto-recovery:** Detects when AI splits miss content and automatically adds remaining text
4.  **Placement:**
    - AI proposes a target folder with reasoning and confidence score
    - Human can override with full path visibility
    - Folder rules enforced: content only in leaf folders (no subfolders)
    - **Inline folder creation:** Create new subfolders during placement
5.  **Commit:** Document and fragments created with full audit trail.

### Audit Trail

Every ingestion session generates a persistent audit log:
- Automatically saved to `trees/{treeId}.audit.log`
- Tracks all decisions: splits detected, human edits, placement proposals, overrides
- Each entry tagged with actor (`HUMAN`, `AI`, `SYSTEM`) and timestamp
- Downloadable from the UI
- Appended (never overwritten) for complete historical record

### Strict Node Types

The tree enforces a strict taxonomy:
- **Folders:** Pure structure, no content. Organize other folders or content.
- **Documents:** Leaf content in leaf folders only. Contains the full text.
- **Fragments:** Chunks of documents for granular retrieval.

Every node has both a **title** (human-readable label) and a **gist** (semantic summary).

### Content Editing Modes

Content in FRAKTAG can be either **editable** or **read-only**:

- **Editable Content:** User-created notes that can be edited directly in the UI with auto-save
- **Read-Only Content:** Ingested documents that preserve the original source; can only be replaced with new versions

#### Creating Editable Notes

1. Select a leaf folder (folder that can contain documents)
2. Click **"Create Note"** button in the Folder Info panel
3. Enter a title for your note
4. The note is created with editable content - write directly in the UI
5. Changes auto-save as you type (1 second debounce)

#### Versioning Read-Only Content

Read-only content (from file ingestion) cannot be edited directly to preserve source integrity. Instead:

1. Select a document with read-only content
2. Click **"Replace Version"** button
3. Edit the content in the dialog
4. Submit to create a new version

The old version is preserved in history (via `supersedes` chain), and the node points to the new version.

#### AI-Generated Summaries

- Click **"Generate Summary"** on any document to create an AI-generated gist
- Auto-generates when navigating away from a node that has content but no summary
- Only triggers if content has at least 10 characters

---

## 3. Tech Stack

**Core & Runtime:**
*   **Language:** TypeScript (Strict ESM, `NodeNext` resolution).
*   **Runtime:** Node.js v22+ (Local), AWS Lambda (Cloud).
*   **Package Manager:** NPM Workspaces (Monorepo).

**AI & Vectors:**
*   **Local Inference:** Ollama (Qwen, Llama, DeepSeek).
*   **Cloud Inference:** OpenAI API (GPT-4 series).
*   **Embeddings:** `nomic-embed-text` (Local) or `text-embedding-3-small` (Cloud).
*   **Vector Store:** Portable JSON-based flat index (No external DB required).

**Frontend:**
*   **Framework:** React 19 + Vite 6.
*   **Styling:** Tailwind CSS v4 (Alpha/Beta).
*   **Components:** Shadcn UI (Radix Primitives).

**Infrastructure (planned):**
*   **Cloud:** AWS CDK (TypeScript).
*   **Services:** S3 (Storage), API Gateway + Lambda (Compute), Cognito (Auth).

**PREREQUISITES:**
*   **OpenAI:** an API key.
*   **Ollama:** having Ollama installed plus a few relevant models.
*   **MLX:** an Apple Silicon Mac, python 3.10 or newer, and `pip install mlx-lm fastapi uvicorn pydantic sse-starlette sentence-transformers "huggingface_hub[cli]" einops` inside a dedicated venv - and run the download.py script then mlx_runner.py from engine/scripts.

---

## 4. Component Breakdown

### A. The Engine (`packages/engine`)
The heart of the system.

#### 1. The Fractalizer (Ingestion)
Responsible for turning raw documents into the Tree.
*   **Human-Assisted Mode:** The default. Programmatic split detection + human review + AI placement suggestions.
*   **Surgical Splitting:** Uses a "Census" approach. It counts Headers (`#`, `##`), PDF Page markers, and Delimiters (`---`) to deterministically split large documents into logical chunks without hallucination.
*   **Smart Title Detection:** Recognizes when headers are used as delimiters (e.g., repeated `## Point`) and extracts actual titles from content.
*   **Auto-Placement (with human override):** Intelligently routes new content into the existing tree hierarchy based on semantic fit.

#### LLM Nuggets (`src/nuggets/`)
All LLM calls in the engine are wrapped in **Nuggets** — typed functions that encapsulate a prompt, its input/output contracts, and output parsing:
*   **BaseNugget<TInput, TOutput>:** Abstract base with `run()`, `extractJSON()` sanitization (handles markdown fences, double-quoted key hallucinations, trailing commas), and `parseJSONArray()`.
*   **Navigator nuggets:** `GlobalMapScan`, `AssessVectorCandidates`, `AssessNeighborhood` — tree scanning and relevance filtering.
*   **Fractalizer nuggets:** `GenerateGist`, `GenerateTitle`, `ProposePlacement`, `AiSplit` — ingestion and content processing.
*   **Oracle nuggets:** `OracleAsk`, `OracleChat`, `AnswerGist`, `TurnGist` — RAG synthesis and conversation.
*   **Maintenance nuggets:** `AnalyzeTreeStructure` — structural auditing.
*   **DiagnosticLLMProxy:** Test-time adapter wrapper that records rendered prompts, raw outputs, timing, and model metadata.
*   **NuggetTester:** Runs all 12 nuggets with sample inputs, validates output shape, and generates a full diagnostic `.txt` report.

Each nugget declares `expectsJSON` as a fixed property — the adapter uses this to request JSON mode from the LLM (e.g., `response_format: json_object` for OpenAI, `format: 'json'` for Ollama) without fragile heuristic detection.

#### 2. The Navigator (Retrieval)
Responsible for finding information. Uses an **Ensemble Strategy**:
*   **Phase 1: Vector Paratroopers:** Performs semantic search to find "Deep" nodes instantly. Includes a "Smart Check" to distinguish between Folders (queue for drilling) and Leaves (return immediately).
*   **Phase 2: Global Map Scan:** Passes the compressed Tree Map (Gists only) to the LLM to identify high-level branches relevant to the query.
*   **Phase 3: Precision Drilling:** Recursively explores candidate branches.
    *   **The Scout:** Reads the local neighborhood (Parent + Children) and decides which paths to follow.
    *   **The Magnet:** Scores specific content fragments for relevance (0-10).

#### 3. The Arborist (Maintenance) (BETA)
Responsible for structural health.
*   **Audit:** Scans the tree for duplicates, imbalances, and misplaced nodes.
*   **Operations:** Can execute `CLUSTER`, `PRUNE`, `RENAME`, and `MOVE` commands to reorganize the graph automatically.

#### 4. The Stores
*   **`ContentStore`:** Manages content atoms (`uuid.json`). Uses SHA-256 hashing for deduplication.
    - **Edit modes:** `editable` (user notes, direct editing) or `readonly` (ingested files, versioning only)
    - **Versioning:** Content can supersede previous versions via `supersedes` chain
    - **History:** Full version history accessible via `getHistory()`
*   **`TreeStore`:** Manages the hierarchy (`treeId.json`). Supports monolithic loading/saving for portability.
*   **`VectorStore`:** Manages the embedding index.

### B. The API (`packages/api`)
A lightweight Express bridge.
*   Exposes endpoints to `listTrees`, `getStructure`, `getContent`, and `ask`.
*   **Streaming endpoints:**
    - `POST /api/ask/stream` — Single-tree RAG query with SSE streaming.
    - `POST /api/chat/stream` — Multi-tree conversational chat with SSE streaming.
*   **Conversation endpoints:**
    - `GET /api/conversations` — List all conversation sessions.
    - `POST /api/conversations` — Create a new session with linked context.
    - `GET /api/conversations/:id/turns` — Get conversation turns.
    - `PATCH /api/conversations/:id` — Update session title.
    - `DELETE /api/conversations/:id` — Delete a conversation.
*   **Tree filtering:** `GET /api/trees?type=knowledge` to exclude conversation trees.
*   Node operations: update title/gist, move nodes between folders.
*   Folder operations: create subfolders, list leaf folders with full paths.
*   Audit log endpoint for persisting ingestion decisions.
*   Handles configuration loading (Env vars vs Local fallback).

### C. The UI (`packages/ui`)
A "God's Eye View" of the knowledge base with human-supervised ingestion.

*   **Tree Visualizer:** A recursive sidebar that renders the entire hierarchy with auto-expansion to content level.
    - **KB selector:** Switch between Internal and external knowledge bases.
    - **Tree selector:** Pick a tree within the active KB, with organizing principle editor.
    - **Show conversation trees:** Debug toggle to inspect conversation tree structures alongside knowledge trees.
*   **Content Inspector:** Edit titles and gists with auto-save. View and edit content based on edit mode. Markdown rendering for all content.
*   **Inline Content Editing:**
    - **Editable content:** Direct editing with auto-save (1s debounce), Edit/Done toggle between rendered markdown and raw editor.
    - **Read-only content:** Rendered markdown view with "Replace Version" option for creating new versions.
    - **Edit mode badges:** Visual indicators showing EDITABLE (green) or READ-ONLY (gray).
    - **Create Note:** Button in leaf folders to create editable documents.
    - **Generate Summary:** AI-powered gist generation on demand or auto-trigger on navigate away.
*   **Chat Dialog (`ChatDialog.tsx`):** Conversational interface for querying across knowledge bases:
    - **Multi-tree source selection:** Choose which knowledge trees to search across.
    - **Conversation management:** Persistent sessions with full history, create/delete conversations.
    - **Streaming responses:** Sources appear as discovered, answers stream in real-time via SSE.
    - **One tree per conversation:** Each conversation is its own tree (`conv-{uuid}`), stored in Internal KB with `linkedContext` pointing to referenced trees.
    - **Source references:** Click sources to view full content in a popup with gist tooltips on hover.
    - **Markdown rendering:** AI answers rendered as formatted markdown.
*   **Ingestion Dialog (`IngestionDialog.tsx`):** Multi-step wizard with:
    - Document minimap showing split positions visually.
    - Programmatic splitting (H1/H2/H3, HR, numbered sections, custom regex).
    - AI-assisted splitting with auto-recovery for incomplete coverage.
    - Human review with merge, edit, and nested splitting.
    - Folder creation during placement.
*   **Move Dialog (`MoveDialog.tsx`):** Relocate nodes with full path visibility and inline folder creation.
*   **KB Manager Dialog:** Create and load portable knowledge bases, add trees to KBs.
*   **Folder Management:** Create subfolders (enforcing rules), move content and folders.

### D. Parsing Adapters (`src/adapters/parsing`)
*   **`PdfParser`:** Uses `unpdf` to extract text from PDFs, injecting explicit markers (`---=== PAGE X ===---`) to aid the Splitter.
*   **`TextParser`:** Handles standard text and rejects binaries.
*   **`FileProcessor`:** Facade that routes files to the correct parser based on extension/mime type.

---

## 5. Knowledge Base Portability

FRAKTAG is built around **self-contained, portable knowledge bases**. Each KB is a complete, self-describing package that can be moved, shared, backed up, or versioned independently.

### Internal Knowledge Base

Every FRAKTAG instance has an **Internal KB** that stores trees defined directly in `config.json`, plus all conversation trees. This is the default storage for legacy trees and conversations:

```
packages/engine/data/
├── config.json          # LLM settings + KB references
├── content/             # Content atoms for internal trees
├── indexes/             # Vector indexes for internal trees
└── trees/               # Internal tree structures + conversation trees
```

### External Knowledge Bases (Portable)

External KBs are fully self-contained directories. They are **auto-discovered and auto-loaded** on engine startup — any KB found in the `knowledge-bases/` directory is loaded automatically without manual configuration.

### Knowledge Base Structure

```
knowledge-bases/
├── arda/                              # Self-contained KB
│   ├── kb.json                        # KB definition
│   ├── content/                       # Content atoms (immutable blobs)
│   │   ├── abc123.json
│   │   └── def456.json
│   ├── indexes/                       # Vector embeddings
│   │   └── main.vectors.json
│   └── trees/                         # Tree structures (can have multiple)
│       ├── main.json                  # Primary tree
│       ├── main.audit.log             # Audit trail
│       └── alternative.json           # Alternative organization
├── notes/                             # Another KB
│   ├── kb.json
│   ├── content/
│   ├── indexes/
│   └── trees/
└── shared-research/                   # Can be on external drive
    └── ...
```

### KB Definition File (`kb.json`)

Each knowledge base has its own identity and organizing principles:

```json
{
  "id": "arda",
  "name": "ARDA Protocol",
  "organizingPrinciple": "The Gentleman's Framework...",
  "defaultTreeId": "main",
  "seedFolders": [
    {
      "title": "Interpersonal Dynamics",
      "gist": "Relationships, dating, social dynamics",
      "children": [
        { "title": "Foundational", "gist": "Core principles" },
        { "title": "Tactical", "gist": "Practical techniques" }
      ]
    }
  ],
  "dogma": {
    "strictness": "fanatical",
    "forbiddenConcepts": ["blue-pill thinking"],
    "requiredContext": ["Interest Level mechanics"]
  }
}
```

### Main Configuration (`config.json`)

The main config contains adapter settings. Knowledge bases in the `knowledge-bases/` directory are **auto-discovered and auto-loaded** on startup — no explicit KB paths required:

```json
{
  "llm": {
    "adapter": "openai",
    "model": "gpt-4.1-mini",
    "apiKey": "..."
  },
  "embedding": {
    "adapter": "openai",
    "model": "text-embedding-3-small"
  },
  "ingestion": {
    "splitThreshold": 2000,
    "maxDepth": 8
  }
}
```

Optionally, you can explicitly list KB paths (e.g., for KBs on external drives):
```json
{
  "knowledgeBases": [
    { "path": "/Volumes/External/shared-kb", "enabled": true }
  ]
}
```

### Portability Benefits

1. **Copy & Paste Sharing:** Move a KB folder to share complete knowledge
2. **Git Versioning:** Each KB can be its own git repo
3. **External Storage:** Mount KBs from network drives or cloud sync
4. **Multiple Trees:** Different organizational views over the same content
5. **Isolation:** KBs don't interfere with each other
6. **Backup:** Simple folder backup captures everything

### CLI Commands

```bash
# Create a new knowledge base
fkt kb create my-research --name "My Research" --principle "Academic papers organized by topic"

# Add a tree to existing KB
fkt kb add-tree my-research alt-view --name "Chronological View"

# List knowledge bases
fkt kb list

# Import external KB
fkt kb import /path/to/external-kb

# Export KB for sharing
fkt kb export arda ./arda-backup
```

### UI Capabilities

- **KB Selector:** Switch between Internal and external knowledge bases.
- **Auto-Load:** All detected KBs are loaded and available on startup.
- **Create KB:** Initialize new KB with name, organizing principle, and seed folders.
- **Create Tree:** Add alternative tree organization to existing KB.
- **Export to KB:** Export internal trees to a new portable KB.

### Data Files

Within each KB:

1.  **`kb.json`**: The Identity.
    *   Name, organizing principle, and structural rules.
    *   Seed folder definitions for tree initialization.
    *   Dogma rules for content validation.

2.  **`trees/*.json`**: The Maps.
    *   Contains the hierarchy with strict node types (Folder/Document/Fragment).
    *   Every node has `title` + `gist` for human and AI understanding.
    *   Multiple trees can organize the same content differently.

3.  **`trees/*.audit.log`**: The Decision History.
    *   Append-only log of all ingestion and maintenance decisions.
    *   Tagged by actor (HUMAN/AI/SYSTEM) with timestamps.
    *   Provides full traceability for compliance and debugging.

4.  **`content/*.json`**: The Memories.
    *   Flat list of JSON files containing the raw text.
    *   Deduplicated via SHA-256.
    *   Shared across all trees in the KB.
    *   **Edit modes:** `editable` for user notes, `readonly` for ingested files.
    *   **Versioning:** `supersedes` and `supersededBy` fields link version history.

5.  **`indexes/*.vectors.json`**: The Semantic Index.
    *   JSON-based vector store for similarity search.
    *   Per-tree indexes for tree-specific retrieval.

---

## 6. CLI Agent Integration

FRAKTAG includes an agent-ready CLI (`fkt`) designed for integration with coding agents like Claude Code, Cursor, Antigravity, and similar tools. This enables **living documentation** that stays synchronized with your codebase.

### The `.fraktag/` Pattern

Any git repository can become a FRAKTAG knowledge base by initializing a `.fraktag/` directory:

```bash
cd my-project
fkt init
```

This creates a self-contained knowledge base in your repo:
```
my-project/
├── .fraktag/
│   ├── config.json      # LLM settings + tree definitions
│   ├── content/         # Content atoms
│   ├── trees/           # Tree structures
│   └── indexes/         # Vector embeddings
├── src/
├── README.md
└── ...
```

The `.fraktag/` directory can be:
- **Git-tracked** for versioned documentation
- **Git-ignored** for local-only knowledge bases
- **Shared** across team members who sync the repo

### Machine-Readable Output (`--json`)

All commands support `--json` flag for structured output that agents can parse:

```bash
# Human-friendly output
fkt folders docs
# 📂 Leaf Folders in docs (4):
#   [root-arch] Architecture
#      Gist: System design, patterns...

# Agent-friendly output
fkt folders docs --json
# [{"id":"root-arch","title":"Architecture","gist":"System design...","path":"/Architecture"}]
```

### Agent Workflow Example

A coding agent maintaining project documentation:

```bash
# 1. Initialize KB in the repo (one-time)
cd my-project
fkt init
fkt setup

# 2. Ingest existing documentation
fkt folders docs --json                           # Get folder IDs
fkt ingest README.md docs root-guides --title "Project Readme"
fkt ingest docs/api.md docs root-api --title "API Reference"

# 3. Query the knowledge base
fkt ask "How do I add a new endpoint?" docs --json
# Returns: { "answer": "...", "references": ["API Reference", ...] }

# 4. Update living documentation
# After making code changes, agent updates the relevant doc:
fkt node get <node-id> --json                     # Get current content
# Agent edits the content based on code changes...
fkt content replace <node-id> /tmp/updated.md    # Update with new version

# 5. Verify integrity
fkt verify docs --json
```

### CLI Command Reference

**Initialization:**
```bash
fkt init                    # Create .fraktag/ in current directory
fkt setup                   # Initialize trees from config
```

**Tree Operations:**
```bash
fkt tree [treeId]           # Visual tree structure
fkt folders [treeId]        # List leaf folders (ingestion targets)
fkt stats [treeId]          # Node counts by type
```

**Node CRUD:**
```bash
fkt node get <id>           # Get node with content
fkt node update <id> --title "New Title" --gist "New summary"
fkt node delete <id>        # Delete node and children
fkt node move <id> <parentId>  # Move to different folder
```

**Content Operations:**
```bash
fkt content get <id>        # Get content atom
fkt content update <id> <file>     # Update EDITABLE content
fkt content replace <nodeId> <file> # Create new VERSION (readonly)
```

**Ingestion:**
```bash
fkt analyze <file>          # Preview split detection
fkt ingest <file> <treeId> <folderId> [--title "..."]
```

**Retrieval:**
```bash
fkt retrieve <query> [treeId]  # Vector + graph search
fkt ask <query> [treeId]       # RAG synthesis
fkt browse [treeId] [nodeId]   # Navigate structure
```

**Nugget Testing:**
```bash
fkt test-nuggets               # Run all 12 nugget tests, write diagnostic report
fkt test-nuggets GenerateGist  # Test one nugget by name
fkt test-nuggets --json        # JSON output (report file still written)
```

Each run writes a timestamped `nugget-report-{timestamp}.txt` with: rendered prompts, raw LLM output, parsed output, adapter/model metadata, timing, and validation results.

### Integration with Coding Agents

**Claude Code / Cursor:**
Add to your project's `.claude/` or context:
```
This project uses FRAKTAG for documentation.
Query documentation: fkt ask "question" docs --json
Update docs after code changes: fkt content replace <id> <file>
```

**Antigravity / Custom Agents:**
The `--json` flag makes FRAKTAG composable with any agent:
```python
import subprocess
import json

result = subprocess.run(
    ["fkt", "ask", "How does auth work?", "docs", "--json"],
    capture_output=True, text=True
)
response = json.loads(result.stdout)
print(response["answer"])
```

### Why Agent-Ready Documentation?

Traditional documentation rots because code changes faster than humans update docs. FRAKTAG enables a new workflow:

1. **Agents read code** → understand changes
2. **Agents query FRAKTAG** → find relevant documentation
3. **Agents update FRAKTAG** → keep docs synchronized
4. **Humans review** → maintain quality and accuracy

The result: documentation that evolves with your codebase, maintained by the same agents that write your code.

---

## 7. Current Status

*   **Ingestion:** Human-supervised with full audit trail. AI proposes, humans approve.
*   **Retrieval:** Highly accurate due to the Ensemble (Vector + Graph) approach. Parallel multi-tree search.
*   **Conversations:** Persistent chat sessions with multi-tree search scope. One tree per conversation, stored in Internal KB.
*   **Content Editing:** Inline editing for user notes, version replacement for ingested content. Markdown rendering throughout.
*   **Knowledge Bases:** Fully portable, self-contained KBs. Auto-discovered and auto-loaded on startup.
*   **Maintenance:** Manual folder/content management with rule enforcement.
*   **UI:** Functional with auto-save, resizable panels, ingestion wizard, conversation management, and KB management.

### 7.1. Parallel Multi-Tree Search

Multi-tree retrieval in `Fraktag.chat` runs all tree searches concurrently via `Promise.all`. An async `Semaphore` inside each LLM adapter gates how many requests actually hit the backend at once, preventing VRAM overflow (Ollama) or rate-limit hits (OpenAI).

**Defaults:**
- **OpenAI:** concurrency = 10 (cloud handles it)
- **Ollama:** concurrency = 1 (serial, safe for VRAM)

**Configuration:**

```json
{
  "llm": {
    "adapter": "ollama",
    "model": "llama3",
    "concurrency": 2
  }
}
```

**Ollama Parallel Setup:**

To run parallel inference on Ollama, you must configure both sides:

1. Set `OLLAMA_NUM_PARALLEL=N` environment variable when starting the Ollama server.
2. Match `"concurrency": N` in your FRAKTAG `config.json`.
3. Ensure you have enough VRAM to hold N concurrent contexts. Each parallel slot divides the available context window memory.

---

## 8. Design Principles

1.  **Human in the Loop:** AI assists but doesn't dictate. Every significant decision requires human approval.
2.  **Full Traceability:** Audit logs capture every decision with actor attribution.
3.  **Strict Taxonomy:** Clear node types prevent structural ambiguity.
4.  **Portable Data:** No external databases. Everything in JSON files that can be git-versioned.
5.  **Semantic + Structural:** Combines vector similarity with graph navigation for retrieval.

---

## 9. Next Steps

*   **Q&A Caching:** Leverage conversation history as a cache — if a similar question was asked before, surface the prior answer before hitting the LLM.
*   **Cloud Deployment:** AWS CDK infrastructure defined, still to actually deploy.
*   **Batch Ingestion:** Process multiple files with consistent rules (BETA).
*   **Version History UI:** View and navigate content version history in the UI (backend complete).
