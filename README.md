# Project FRAKTAG: The Fractal Knowledge Engine

**Mission:** To organize raw information into a structured, navigable, and high-fidelity hierarchy. Unlike standard RAG (which is "Vector Soup"), FRAKTAG creates a persistent "Mental Map" allowing for both AI-driven synthesis and human exploration.

---

## 1. High-Level Architecture

The system follows a **Hexagonal (Ports & Adapters)** architecture, ensuring the Core Domain logic is isolated from the infrastructure (Local Disk vs AWS S3, Ollama vs OpenAI).

*   **The Brain (Engine):** Pure TypeScript logic for ingestion, organization, and retrieval.
*   **The Memory (Storage):** Content Addressable Storage (CAS) for raw data + Monolithic JSON for structure.
*   **The Interface (UI):** A React-based visualizer and chat interface.
*   **The Nervous System (LLM Adapters):** A tiered multi-model approach (Basic vs Smart vs Expert).

### The "Council of Three" AI Strategy
The engine utilizes different classes of models for specific tasks to balance cost, latency, and intelligence:
1.  **The Scout (Optional Basic Model):** Fast/Cheap (e.g., `gpt-4.1-mini`, `qwen3-coder:30b`). Used for routing, gist generation, and relevance checks.
2.  **The Architect (Standard Model):** Reliable (e.g., `gpt-4.1-mini`, `qwen3-coder:30b`). Used for ingestion, complex splitting, and heresy detection (BETA).
3.  **The Sage (Optional Expert Model):** Deep Reasoning (e.g., `gpt-4.1`, `qwen3-coder:30b`). Used for structural auditing (BETA).

I coulndn't get smaller models to run reliably on my Ollama setup so far, this is why I keep recommending qwen3-coder:30b as it works surprisingly well for all tasks.

---

## 2. Tech Stack

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

## 3. Component Breakdown

### A. The Engine (`packages/engine`)
The heart of the system.

#### 1. The Fractalizer (Ingestion) (BETA)
Responsible for turning raw documents into the Tree.
*   **Surgical Splitting:** Uses a "Census" approach. It counts Headers (`#`, `##`), PDF Page markers, and Delimiters (`---`) to deterministically split large documents into logical chunks without hallucination.
*   **Atomic Path:** Detects small content (<150 words) and shortcuts it directly to a leaf node to avoid over-processing.
*   **The Inquisitor:** An adversarial prompt loop that audits generated summaries against raw text. It detects and fixes **Heresy** (Hallucinations, Omissions, Distortions).
*   **Auto-Placement:** Intelligently routes new content into the existing tree hierarchy based on semantic fit.
*   **Semantic Expansion:** Detects if new content is a version update (`SUPERSEDES`), a duplicate, or complementary to an existing node.

I marked it as BETA because it's not working very well - my most important task right now is to turn this into a manually assisted process - deciding where to put information and how to split information should not be left completely to the AI yet.

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

I marked it as BETA because it's not working very well - it's just looking at gists and trying to guess where those fit best.

#### 4. The Stores
*   **`ContentStore`:** Manages immutable blobs (`uuid.json`). Uses SHA-256 hashing for deduplication.
*   **`TreeStore`:** Manages the hierarchy (`treeId.json`). Supports monolithic loading/saving for portability.
*   **`VectorStore`:** Manages the embedding index.

### B. The API (`packages/api`)
A lightweight Express bridge.
*   Exposes endpoints to `listTrees`, `getStructure`, `getContent`, and `ask`.
*   Handles configuration loading (Env vars vs Local fallback).
*   Provides the "Visual Tree" endpoint for the UI.

### C. The UI (`packages/ui`)
A "God's Eye View" of the knowledge base.
*   **Tree Visualizer:** A recursive, virtualized sidebar that renders the entire hierarchy.
*   **Content Inspector:** Allows viewing the raw text/markdown payload of any node.
*   **The Oracle:** A chat interface where users ask questions, and the system performs the Retrieval -> Synthesis loop, providing answers with specific source citations.
*   **Zero-Dependency Layout:** Uses pure React/CSS for resizable panels to handle deep nesting.

### D. Parsing Adapters (`src/adapters/parsing`)
*   **`PdfParser`:** Uses `unpdf` to extract text from PDFs, injecting explicit markers (`---=== PAGE X ===---`) to aid the Splitter.
*   **`TextParser`:** Handles standard text and rejects binaries.
*   **`FileProcessor`:** Facade that routes files to the correct parser based on extension/mime type.

---

## 4. Data Topology

The system produces a highly portable "Brain" consisting of two folders:

1.  **`data/trees/*.json`**: The Map.
    *   Contains the hierarchy, Gists (L0), Summaries (L1), and logic.
    *   Can be moved between machines/environments easily.
2.  **`data/content/*.json`**: The Memories.
    *   Flat list of JSON files containing the raw text.
    *   Immutable and Deduplicated.
    *   Filename format: `hash.json` or `custom-id-part-x.json`.

---

## 5. Current Status
*   **Ingestion:** Robust against large files, micro-chunking, and hallucinations.
*   **Retrieval:** Highly accurate due to the Ensemble (Vector + Graph) approach.
*   **Maintenance:** Self-healing via the Arborist.
*   **UI:** Functional, resizable, and connected.

---

## 6. Next Steps
*   **Ingestion:** I plan on having human assisted ingestion, supervised chunking.
*   **PdfParser:** Add table of contents detection.
