# Project FRAKTAG: The Fractal Knowledge Engine

**Mission:** To organize raw information into a structured, navigable, and high-fidelity hierarchy. Unlike standard RAG (which is "Vector Soup"), FRAKTAG creates a persistent "Mental Map" allowing for both AI-driven synthesis and human exploration.

**Philosophy:** Human-supervised ingestion with full audit trails. The AI proposes, humans approve. Every decision is logged.

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
    - Smart title detection recognizes repeated delimiter patterns (e.g., `## Point` used as section markers) and extracts actual titles from content
    - AI-assisted splitting available as an alternative
3.  **Human Review:**
    - Visual preview of all proposed splits with character counts
    - Large sections (>5000 chars) flagged for potential further splitting
    - Merge adjacent sections with one click
    - **Per-section nested splitting:** Further split individual sections using different methods
    - Edit titles and content directly
4.  **Placement:**
    - AI proposes a target folder with reasoning and confidence score
    - Human can override with full path visibility
    - Folder rules enforced: content only in leaf folders (no subfolders)
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
*   Node operations: update title/gist, move nodes between folders.
*   Audit log endpoint for persisting ingestion decisions.
*   Handles configuration loading (Env vars vs Local fallback).

### C. The UI (`packages/ui`)
A "God's Eye View" of the knowledge base with human-supervised ingestion.

*   **Tree Visualizer:** A recursive, virtualized sidebar that renders the entire hierarchy.
*   **Content Inspector:** Edit titles and gists with auto-save. View raw text/markdown payload.
*   **Ingestion Dialog:** Multi-step wizard with programmatic and AI-assisted splitting, human review, placement selection.
*   **Folder Management:** Create subfolders (enforcing rules), move content and folders.
*   **The Oracle:** A chat interface where users ask questions, and the system performs the Retrieval -> Synthesis loop.

### D. Parsing Adapters (`src/adapters/parsing`)
*   **`PdfParser`:** Uses `unpdf` to extract text from PDFs, injecting explicit markers (`---=== PAGE X ===---`) to aid the Splitter.
*   **`TextParser`:** Handles standard text and rejects binaries.
*   **`FileProcessor`:** Facade that routes files to the correct parser based on extension/mime type.

---

## 5. Data Topology

The system produces a highly portable "Brain" consisting of:

1.  **`data/trees/*.json`**: The Map.
    *   Contains the hierarchy with strict node types (Folder/Document/Fragment).
    *   Every node has `title` + `gist` for human and AI understanding.
    *   Can be moved between machines/environments easily.
2.  **`data/trees/*.audit.log`**: The Decision History.
    *   Append-only log of all ingestion and maintenance decisions.
    *   Tagged by actor (HUMAN/AI/SYSTEM) with timestamps.
    *   Provides full traceability for compliance and debugging.
3.  **`data/content/*.json`**: The Memories.
    *   Flat list of JSON files containing the raw text.
    *   Immutable and Deduplicated.
    *   Filename format: `hash.json` or `custom-id-part-x.json`.
4.  **`data/indexes/*.vectors.json`**: The Semantic Index.
    *   Flat JSON-based vector store for similarity search.
    *   Portable, no external database required.

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
*   **PdfParser:** Add table of contents detection.
*   **Cloud Deployment:** AWS CDK infrastructure.
