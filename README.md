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
    "apiKey": "sk-your-api-key-here"
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
    "endpoint": "http://localhost:11434"
  },
  "embedding": {
    "adapter": "ollama",
    "model": "nomic-embed-text",
    "endpoint": "http://localhost:11434"
  }
}
```

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
*   **The Nervous System (LLM Adapters):** A tiered multi-model approach (Basic vs Smart vs Expert).

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
*   **`ContentStore`:** Manages immutable blobs (`uuid.json`). Uses SHA-256 hashing for deduplication.
*   **`TreeStore`:** Manages the hierarchy (`treeId.json`). Supports monolithic loading/saving for portability.
*   **`VectorStore`:** Manages the embedding index.

### B. The API (`packages/api`)
A lightweight Express bridge.
*   Exposes endpoints to `listTrees`, `getStructure`, `getContent`, and `ask`.
*   **Streaming endpoint:** `GET /api/ask/stream` for real-time SSE streaming of sources and answers.
*   Node operations: update title/gist, move nodes between folders.
*   Folder operations: create subfolders, list leaf folders with full paths.
*   Audit log endpoint for persisting ingestion decisions.
*   Handles configuration loading (Env vars vs Local fallback).

### C. The UI (`packages/ui`)
A "God's Eye View" of the knowledge base with human-supervised ingestion.

*   **Tree Visualizer:** A recursive sidebar that renders the entire hierarchy with auto-expansion to content level.
*   **Content Inspector:** Edit titles and gists with auto-save. View raw text/markdown payload.
*   **Ingestion Dialog (`IngestionDialog.tsx`):** Multi-step wizard with:
    - Document minimap showing split positions visually
    - Programmatic splitting (H1/H2/H3, HR, numbered sections, custom regex)
    - AI-assisted splitting with auto-recovery for incomplete coverage
    - Human review with merge, edit, and nested splitting
    - Folder creation during placement
*   **Query Dialog (`QueryDialog.tsx`):** Knowledge base querying with:
    - **Streaming responses:** Sources appear as they're discovered, answers stream in real-time
    - **Retrieve mode:** Vector + graph search returning relevant fragments
    - **Ask mode:** Full RAG synthesis with live streaming via Server-Sent Events
*   **Move Dialog (`MoveDialog.tsx`):** Relocate nodes with full path visibility and inline folder creation.
*   **Folder Management:** Create subfolders (enforcing rules), move content and folders.

### D. Parsing Adapters (`src/adapters/parsing`)
*   **`PdfParser`:** Uses `unpdf` to extract text from PDFs, injecting explicit markers (`---=== PAGE X ===---`) to aid the Splitter.
*   **`TextParser`:** Handles standard text and rejects binaries.
*   **`FileProcessor`:** Facade that routes files to the correct parser based on extension/mime type.

---

## 5. Knowledge Base Portability

FRAKTAG is designed around **self-contained, portable knowledge bases**. Each KB is a complete package that can be moved, shared, backed up, or versioned independently.

### Current State (Manual Portability)

Currently, trees are defined in `config.json` and data is stored in shared folders:

```
packages/engine/data/
├── config.json          # Trees defined here + LLM settings
├── content/             # All content (shared across trees)
├── indexes/             # All vector indexes
└── trees/               # All tree structures
```

**To move a knowledge base manually:**
1. Copy the relevant tree file from `trees/`
2. Copy referenced content files from `content/`
3. Copy the index file from `indexes/`
4. Update `config.json` in the target location with tree definition

### Planned Architecture (Self-Contained KBs)

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

The main config contains only adapter settings and KB paths:

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
  },
  "knowledgeBases": [
    "./knowledge-bases/arda",
    "./knowledge-bases/notes",
    "/Volumes/External/shared-kb"
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

- **KB Selector:** Switch between knowledge bases
- **Create KB:** Initialize new KB with name and organizing principle
- **Create Tree:** Add alternative tree organization to existing KB
- **Import KB:** Add external KB to the system

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
    *   Immutable and Deduplicated via SHA-256.
    *   Shared across all trees in the KB.

5.  **`indexes/*.vectors.json`**: The Semantic Index.
    *   JSON-based vector store for similarity search.
    *   Per-tree indexes for tree-specific retrieval.

### Migration Path

To migrate from the current structure to portable KBs:

```bash
# Future command to migrate existing tree to portable KB
fkt kb migrate notes ./knowledge-bases/notes

# This will:
# 1. Create kb.json with tree config extracted from config.json
# 2. Copy referenced content to kb/content/
# 3. Move tree file to kb/trees/
# 4. Move index file to kb/indexes/
# 5. Update config.json to reference the new KB path
```

---

## 6. Current Status

*   **Ingestion:** Human-supervised with full audit trail. AI proposes, humans approve.
*   **Retrieval:** Highly accurate due to the Ensemble (Vector + Graph) approach.
*   **Maintenance:** Manual folder/content management with rule enforcement.
*   **UI:** Functional with auto-save, resizable panels, and ingestion wizard.

---

## 7. Design Principles

1.  **Human in the Loop:** AI assists but doesn't dictate. Every significant decision requires human approval.
2.  **Full Traceability:** Audit logs capture every decision with actor attribution.
3.  **Strict Taxonomy:** Clear node types prevent structural ambiguity.
4.  **Portable Data:** No external databases. Everything in JSON files that can be git-versioned.
5.  **Semantic + Structural:** Combines vector similarity with graph navigation for retrieval.

---

## 8. Next Steps

*   **Inline Content Editing:** Edit document/fragment content directly in the UI.
*   **Batch Ingestion:** Process multiple files with consistent rules.
*   **Version History:** Track changes to content over time (supersedes chain).
*   **PDF Table of Contents:** Detect and use PDF TOC for intelligent splitting.
*   **Cloud Deployment:** AWS CDK infrastructure.
*   **Conversation Memory:** Multi-turn Q&A with context retention.
*   **Question and Answer Caching:** Some questions have been asked before, why not answer from a cache.
