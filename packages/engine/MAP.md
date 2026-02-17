# Engine Package Map

The engine is the core of FRAKTAG - a TypeScript library that handles all knowledge organization, storage, and retrieval logic.

## Architecture Overview

```
src/
├── index.ts              # Main Fraktag class - orchestrates all components
├── cli.ts                # Command-line interface (fkt command)
├── core/                 # Domain logic
│   ├── types.ts          # Type definitions and guards
│   ├── ContentStore.ts   # Immutable content storage (CAS)
│   ├── TreeStore.ts      # Hierarchical structure storage
│   ├── VectorStore.ts    # Embedding index for semantic search
│   ├── Fractalizer.ts    # Ingestion and splitting logic
│   ├── Navigator.ts      # Retrieval and graph traversal
│   ├── Arborist.ts       # Tree maintenance and auditing
│   ├── KnowledgeBase.ts  # Portable KB management
│   └── ConversationManager.ts  # Conversation memory/log
├── adapters/             # Infrastructure adapters (Hexagonal Architecture)
│   ├── llm/              # Language model adapters
│   │   ├── ILLMAdapter.ts        # Interface contract
│   │   ├── BaseLLMAdapter.ts     # Abstract base (semaphore, vars, clean, extractJSON, logging)
│   │   ├── OpenAIAdapter.ts      # OpenAI/GPT (retry, reasoning models, SSE)
│   │   ├── OllamaAdapter.ts      # Ollama local (NDJSON streaming, num_ctx)
│   │   └── MLXAdapter.ts         # MLX LM Server (OpenAI-compatible, Apple Silicon)
│   ├── embeddings/       # Embedding adapters
│   │   ├── IEmbeddingAdapter.ts
│   │   ├── OpenAIEmbeddingAdapter.ts
│   │   └── OllamaEmbeddingAdapter.ts
│   ├── storage/          # Storage adapters
│   │   ├── IStorage.ts
│   │   ├── JsonStorage.ts    # Local filesystem (JSON files)
│   │   └── index.ts          # Exports
│   └── parsing/          # File parsing adapters
│       ├── IFileParser.ts
│       ├── TextParser.ts
│       └── PdfParser.ts
├── nuggets/              # LLM Nuggets — typed wrappers for all LLM calls
│   ├── BaseNugget.ts         # Abstract base: run(), extractJSON(), parseJSONArray()
│   ├── index.ts              # Re-exports for all nuggets
│   ├── all.ts                # Barrel import
│   ├── NuggetTester.ts       # Test runner + DiagnosticLLMProxy + report generator
│   ├── GlobalMapScan.ts      # Navigator: scan tree map for targets
│   ├── AssessVectorCandidates.ts  # Navigator: filter vector results
│   ├── AssessNeighborhood.ts      # Navigator: evaluate children relevance
│   ├── GenerateGist.ts       # Fractalizer: 1-2 sentence summary
│   ├── GenerateTitle.ts      # Fractalizer: 3-10 word title
│   ├── ProposePlacement.ts   # Fractalizer: document placement
│   ├── AiSplit.ts            # Fractalizer: AI-assisted content splitting
│   ├── OracleAsk.ts          # RAG synthesis (single query)
│   ├── OracleChat.ts         # RAG synthesis (conversational)
│   ├── AnswerGist.ts         # Summarize answer
│   ├── TurnGist.ts           # Summarize Q&A turn
│   └── AnalyzeTreeStructure.ts # AI structural audit
├── prompts/              # LLM prompt templates (legacy DEFAULT_PROMPTS)
│   └── default.ts
└── utils/
    ├── Semaphore.ts      # Async concurrency limiter
    └── FileProcessor.ts  # File type routing
```

## Core Components

### 1. Fraktag Class (`index.ts`)

The main orchestrator that ties everything together.

**Initialization:**
```typescript
const fraktag = await Fraktag.fromConfigFile('./config.json');
```

**Key Methods:**
- `setup()` - Initialize trees from config with seed folders
- `listTrees()` / `getTree(id)` - Tree enumeration
- `getFullTree(id)` - Get complete tree structure with all nodes
- `getContent(id)` - Retrieve content atoms

**Initialization:**
- `fromConfigFile()` discovers and auto-loads all KBs found in `kbStoragePath` on startup, not just those listed in config

**Ingestion Methods:**
- `parseFile(fileName, buffer)` - Parse uploaded files
- `analyzeSplits(content, sourceUri)` - Detect split boundaries
- `generateTitle(content, treeId)` - AI title generation
- `generateGist(content, treeId)` - AI summary generation
- `generateAiSplits(content, treeId)` - AI-assisted splitting
- `proposePlacement(treeId, title, gist)` - AI folder suggestion
- `ingestDocument(content, treeId, folderId, title, gist)` - Commit document
- `createFragment(content, treeId, documentId, title, gist)` - Create fragment

**Retrieval Methods:**
- `retrieve({ treeId, query, maxDepth, resolution })` - Vector + graph search
- `ask(query, treeId)` - RAG synthesis (returns complete response)
- `askStream(query, treeId, onEvent)` - Streaming RAG with SSE events
- `browse({ treeId, nodeId, resolution })` - Navigate tree structure
- `chat(sessionId, question, sourceTreeIds, onEvent)` - Multi-tree conversational RAG with parallel retrieval across all source trees, conversation memory, and streaming events

**Maintenance Methods:**
- `verifyTree(treeId)` - Check tree integrity
- `audit(treeId)` - Structural audit (via `AnalyzeTreeStructureNugget`)
- `reset(treeId, { pruneContent })` - Clear tree

**LLM Accessors:**
- `getBasicLlm()` / `getSmartLlm()` / `getExpertLlm()` - Access the Council of Three adapters (used by CLI `test-nuggets` and for external nugget instantiation)

### 2. ContentStore (`core/ContentStore.ts`)

Manages immutable content blobs using Content-Addressable Storage.

**Data Model:**
```typescript
interface ContentAtom {
  id: string;           // UUID
  hash: string;         // SHA-256 of payload
  payload: string;      // Raw text content
  createdAt: string;    // ISO timestamp
  sourceUri?: string;   // Original file path
  supersedes?: string;  // Previous version ID (for updates)
  editMode?: 'editable' | 'readonly';
}
```

**Key Features:**
- Deduplication via SHA-256 hashing
- Immutable storage (never modified, only superseded)
- Files stored as `{hash}.json` in `content/` directory

**Methods:**
- `create(payload, sourceUri?)` - Store new content
- `get(id)` - Retrieve by ID
- `getByHash(hash)` - Check for duplicates
- `prune(usedIds)` - Remove orphaned content

### 3. TreeStore (`core/TreeStore.ts`)

Manages the hierarchical knowledge structure.

**Data Model:**
```typescript
type NodeType = 'folder' | 'document' | 'fragment';

interface TreeNode {
  id: string;
  treeId: string;
  parentId: string | null;
  type: NodeType;
  title: string;        // Human-readable label
  gist: string;         // Semantic summary
  contentId?: string;   // Reference to ContentStore (documents/fragments only)
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}
```

**Tree Rules:**
- Folders can contain EITHER other folders OR content (not both)
- Documents/fragments can only exist in leaf folders
- Every node has both `title` and `gist`

**Methods:**
- `createNode(node)` / `updateNode(id, updates)` / `deleteNode(id)`
- `getNode(id)` / `getChildren(parentId)` / `getAllNodes(treeId)`
- `getTree(treeId)` - Get tree config
- `moveNode(nodeId, newParentId)` - Relocate with validation

### 4. VectorStore (`core/VectorStore.ts`)

Manages embeddings for semantic search.

**Data Model:**
```typescript
interface VectorEntry {
  nodeId: string;
  embedding: number[];  // 1536-dim for OpenAI, 768 for nomic
  text: string;         // Original text (for debugging)
}
```

**Features:**
- Portable JSON-based storage (no external DB)
- Cosine similarity search
- Batch operations for efficiency

**Methods:**
- `upsert(nodeId, text)` - Add/update embedding
- `search(query, topK)` - Find similar nodes
- `delete(nodeId)` - Remove entry

### 5. Fractalizer (`core/Fractalizer.ts`)

Handles document ingestion and intelligent splitting. All LLM calls use nuggets:
- `GenerateGistNugget` / `GenerateTitleNugget` — AI content summarization
- `AiSplitNugget` — AI-assisted semantic boundary detection
- `ProposePlacementNugget` — AI folder suggestion

Nuggets accept `promptOverride` for config-customized prompts.

**Splitting Strategies:**
1. **Header-based:** Split on `#`, `##`, `###` markdown headers
2. **Horizontal Rule:** Split on `---` separators
3. **Page markers:** Split on PDF page boundaries
4. **Numbered sections:** Split on `1.`, `A.`, `I.`, `1.1.` patterns
5. **AI-assisted:** LLM-driven semantic boundary detection (via `AiSplitNugget`)

**Key Methods:**
- `analyzeContent(content)` - Detect natural boundaries
- `splitByHeaders(content, level)` - Header-based splitting
- `generateTitle(content)` / `generateGist(content)` - AI generation (via nuggets)
- `generateAiSplits(content, treeId)` - AI-assisted splitting (via `AiSplitNugget`)
- `proposePlacement(treeId, title, gist)` - Find best folder (via `ProposePlacementNugget`)

### 6. Navigator (`core/Navigator.ts`)

Retrieval engine using ensemble strategy. All LLM calls use nuggets:
- `GlobalMapScanNugget` — scan tree map for targets
- `AssessVectorCandidatesNugget` — filter vector search results
- `AssessNeighborhoodNugget` — evaluate child relevance during drilling

**Retrieval Phases:**
1. **Vector Paratroopers:** Fast semantic search to find deep relevant nodes (filtered via `AssessVectorCandidatesNugget`)
2. **Global Map Scan:** LLM analyzes tree gists to identify promising branches (via `GlobalMapScanNugget`)
3. **Precision Drilling:** Recursive exploration with relevance scoring (via `AssessNeighborhoodNugget`)

**Resolution Levels:**
- `L0` - Gists only (fast overview)
- `L1` - Titles + gists
- `L2` - Full content (default for retrieval)

**Methods:**
- `retrieve(options)` - Main retrieval with all phases
- `browse(options)` - Simple navigation without search

### 7. Arborist (`core/Arborist.ts`) [BETA]

Tree maintenance and structural health.

**Audit Capabilities:**
- Detect orphaned nodes
- Find missing content references
- Identify constraint violations
- Suggest reorganization

### 8. KnowledgeBase (`core/KnowledgeBase.ts`)

Self-contained, portable knowledge base management.

**Concept:**
Each KB is a folder containing all its data:
- `kb.json` - Identity and organizing principles
- `content/` - Content atoms
- `indexes/` - Vector embeddings
- `trees/` - Tree structures (can have multiple)

**KnowledgeBase Class:**
```typescript
class KnowledgeBase {
  readonly path: string;
  readonly config: KnowledgeBaseConfig;
  readonly storage: JsonStorage;
  readonly treeStore: TreeStore;
  readonly contentStore: ContentStore;

  static async load(kbPath: string): Promise<KnowledgeBase>;
  static async create(kbPath: string, options: {...}): Promise<KnowledgeBase>;

  get id(): string;
  get name(): string;
  getFullTreeId(localTreeId?: string): string;
  async createTree(localTreeId?: string): Promise<Tree>;
  async listTrees(): Promise<Tree[]>;
}
```

**KnowledgeBaseManager Class:**
```typescript
class KnowledgeBaseManager {
  constructor(basePath: string, kbStoragePath?: string);

  async discover(): Promise<DiscoveredKB[]>;  // Find all KBs in storage
  async load(kbPath: string): Promise<KnowledgeBase>;
  async createInStorage(options: {...}): Promise<KnowledgeBase>;
  get(id: string): KnowledgeBase | undefined;
  list(): KnowledgeBase[];
}
```

**Portability:**
- KBs can be copied, moved, backed up as regular folders
- Tree IDs are prefixed with KB ID for global uniqueness
- Each KB has its own isolated storage context

### 9. ConversationManager (`core/ConversationManager.ts`)

Handles conversation memory as a chronological log tree.

**Structure:**
```
conversations-{kbId}/ (Tree)
└── Session 2025-01-25 (Folder)
    ├── Turn 01 - What is X? (Folder)
    │   ├── Question (Document)
    │   ├── Answer (Document)
    │   └── References (Document - JSON nodeIds)
    └── Turn 02 - Explain more (Folder)
        └── ...
```

**Key Methods:**
```typescript
class ConversationManager {
  async ensureConversationTree(kbId: string): Promise<string>;
  async createSession(kbId: string, title?: string): Promise<FolderNode>;
  async getOrCreateTodaySession(kbId: string): Promise<FolderNode>;
  async logTurn(kbId: string, sessionId: string, data: TurnData): Promise<{...}>;
  async listSessions(kbId: string): Promise<ConversationSession[]>;
  async getSessionTurns(sessionId: string): Promise<ConversationTurn[]>;
  async deleteSession(sessionId: string): Promise<void>;
}
```

**Features:**
- Questions and answers are vectorized for semantic recall
- References stored as nodeIds (hydrated on demand)
- Sessions organized by date

### 10. LLM Nuggets (`nuggets/`)

All LLM calls in the engine are wrapped in **Nuggets** — typed functions that encapsulate a prompt template, input/output type contracts, and robust output parsing.

**Design:**
```typescript
abstract class BaseNugget<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly promptTemplate: string;
  abstract readonly expectsJSON: boolean;

  constructor(protected llm: ILLMAdapter, protected promptOverride?: string) {}

  abstract prepareVariables(input: TInput): Record<string, string | number | string[]>;
  protected abstract parseOutput(raw: string): TOutput;

  async run(input: TInput, options?: { maxTokens?: number }): Promise<TOutput>;

  protected extractJSON<T>(text: string): T;      // Robust JSON object extraction
  protected parseJSONArray<T>(text: string): T[];  // Robust JSON array extraction
}
```

**JSON Sanitization (`extractJSON`):**
LLMs (especially quantized models) produce near-valid JSON with predictable errors. `extractJSON` handles:
1. Strips markdown code fences (`` ```json ... ``` ``)
2. Finds `{}`/`[]` bounds (ignores preamble/postamble text)
3. Fixes double-quoted keys: `" "relevantIds"` → `"relevantIds"` (common 8-bit hallucination)
4. Removes trailing commas before `}` or `]`

**All 12 Nuggets:**

| Nugget | Consumer | Input | Output | expectsJSON |
|--------|----------|-------|--------|-------------|
| `GlobalMapScan` | Navigator | `{query, treeMap}` | `{targetIds[], reasoning}` | true |
| `AssessVectorCandidates` | Navigator | `{query, neighborhoods}` | `{relevantNodeIds[]}` | true |
| `AssessNeighborhood` | Navigator | `{query, parentContext, depthContext, childrenList}` | `{relevantIds[]}` | true |
| `GenerateGist` | Fractalizer | `{content, organizingPrinciple}` | `string` | false |
| `GenerateTitle` | Fractalizer | `{content, organizingPrinciple}` | `string` | false |
| `ProposePlacement` | Fractalizer | `{documentTitle, documentGist, leafFolders}` | `{targetFolderId, confidence, reasoning, newFolderSuggestion?}` | true |
| `AiSplit` | Fractalizer | `{content, organizingPrinciple}` | `{title, text}[]` | false |
| `OracleAsk` | index.ts | `{context, query}` | `string` | false |
| `OracleChat` | index.ts | `{historyContext, ragContext, question}` | `string` | false |
| `AnswerGist` | index.ts | `{answer}` | `string` | false |
| `TurnGist` | index.ts | `{question, answer}` | `string` | false |
| `AnalyzeTreeStructure` | index.ts | `{organizingPrinciple, dogma, treeMap}` | `{issues[]}` | true |

**Prompt Sources:**
- Navigator and Fractalizer nuggets use prompts from `DEFAULT_PROMPTS` in `prompts/default.ts` (accepts `promptOverride` for config customization).
- Oracle, Gist, and AiSplit nuggets define their prompts inline (they were inline in the original code).

**Streaming Integration:**
Oracle nuggets (`OracleAsk`, `OracleChat`) are also used by streaming paths. The streaming caller uses the nugget's `prepareVariables()` + `substituteTemplate()` to render the prompt, then passes it to `llm.stream()` directly. This keeps the nugget as the single source of truth for the prompt.

**Diagnostic Testing (`NuggetTester`):**
- `DiagnosticLLMProxy` wraps any `ILLMAdapter` and records: rendered prompt, raw output, char counts, timing, adapter/model metadata.
- `runNuggetTests(llm, filterName?)` runs all nuggets with sample inputs, validates output shape.
- `generateTextReport(results)` produces a structured `.txt` report with per-nugget sections: input, rendered prompt, raw output, parsed output, validation, and a summary table.
- CLI: `fkt test-nuggets [name] [--json]` — always writes a timestamped report file.

## Adapters

### LLM Adapters

**Interface (`ILLMAdapter`):**
```typescript
interface ILLMAdapter {
  readonly modelName?: string;    // e.g. "gpt-4o-mini", "llama3.2:3b"
  readonly adapterName?: string;  // e.g. "openai", "ollama", "mlx"

  complete(prompt, variables, options?): Promise<string>;  // options includes expectsJSON
  stream?(prompt, variables, onChunk, options?): Promise<string>;
  testConnection(): Promise<boolean>;
}
```

**Base Class (`BaseLLMAdapter`):**
All adapters extend `BaseLLMAdapter` which handles:
- Semaphore concurrency control (default: 1, configurable via `LLMConfig.concurrency`)
- Variable processing and template substitution
- Output cleaning (think tags, code fences)
- JSON extraction for structured responses
- Timestamped logging
- `expectsJSON` support: `options.expectsJSON` takes precedence over the heuristic `detectJSONExpectation()`. Nuggets pass this explicitly; legacy callers without the flag get old behavior.
- `modelName` and `adapterName` exposed as public readonly (set by concrete adapters)

Concrete adapters only implement `performComplete()`, `performStream()`, and `testConnection()`.

**Implementations:**
- `OpenAIAdapter` - OpenAI/GPT-5/O-series with retry loop, reasoning model detection, SSE streaming
- `OllamaAdapter` - Local models (Qwen, Llama, DeepSeek) with NDJSON streaming, `num_ctx`/`num_predict`
- `MLXAdapter` - MLX LM Server (Apple Silicon) with OpenAI-compatible SSE, retry loop

### Embedding Adapters

**Interface (`IEmbeddingAdapter`):**
```typescript
interface IEmbeddingAdapter {
  embed(text): Promise<number[]>;
  embedBatch(texts): Promise<number[][]>;
}
```

**Implementations:**
- `OpenAIEmbeddingAdapter` - text-embedding-3-small
- `OllamaEmbeddingAdapter` - nomic-embed-text

### Storage Adapters

**Interface (`IStorage`):**
```typescript
interface IStorage {
  read<T>(path: string): Promise<T | null>;
  write<T>(path: string, data: T): Promise<void>;
  delete(path: string): Promise<void>;
  list(dirPath: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  ensureDir(dirPath: string): Promise<void>;
  appendLine(filePath: string, line: string): Promise<void>;
}
```

**Implementation:**
- `JsonStorage` - Local filesystem with JSON files

### Parsing Adapters

**Interface (`IFileParser`):**
```typescript
interface IFileParser {
  canParse(fileName): boolean;
  parse(buffer): Promise<string | null>;
}
```

**Implementations:**
- `TextParser` - Plain text, markdown, code files
- `PdfParser` - PDF extraction with page markers

### Chunking Adapters

Pluggable text chunking strategies for both tree node creation and embedding generation. Based on RAG benchmark research showing chunking strategy significantly impacts retrieval quality.

**Interface (`IChunkingStrategy`):**
```typescript
interface Chunk {
  text: string;
  startOffset: number;
  endOffset: number;
  metadata?: Record<string, unknown>;
}

interface IChunkingStrategy {
  readonly name: string;
  chunk(text: string, options?: ChunkingOptions): Promise<Chunk[]>;
  estimateTokens(text: string): number;
}
```

**Options:**
```typescript
interface ChunkingOptions {
  maxTokens?: number;      // Target chunk size (default: 512)
  overlapTokens?: number;  // Overlap between chunks (default: 50)
  minChunkTokens?: number; // Discard smaller chunks (default: 50)
  // Or use character-based: maxChars, overlapChars, minChunkChars
}
```

**Implementations (by benchmark accuracy):**

| Strategy | Accuracy | Use Case |
|----------|----------|----------|
| `RecursiveCharacterChunker` | 69% | **Default for embeddings** - splits at paragraph → sentence → word |
| `FixedSize512Chunker` | 67% | Simple baseline, 512 tokens with 50 overlap |
| `FixedSize1024Chunker` | 61% | Better document-level F1, larger context |
| `DocumentStructureChunker` | N/A | **For tree nodes** - splits on headers, pages, HRs |

**Factory:**
```typescript
import { createChunker, createDefaultChunker } from './adapters/chunking';

const chunker = createChunker('recursive');  // or 'fixed-512', 'fixed-1024'
const defaultChunker = createDefaultChunker();  // RecursiveCharacterChunker
```

**Configuration (`ChunkingConfig`):**
```typescript
interface ChunkingConfig {
  nodeStrategy: 'document-structure' | 'page' | 'toc' | 'ai-assisted';
  embeddingStrategy: 'recursive' | 'fixed-512' | 'fixed-1024' | 'semantic' | 'proposition';
  multiChunkEmbeddings: boolean;  // Multiple embedding chunks per tree node
  embeddingChunkTokens?: number;  // Default: 512
  embeddingOverlapTokens?: number;  // Default: 50
}
```

**Dual-Strategy Workflow:**
- **Node strategy** (document-structure): Preserves semantic boundaries for human navigation
- **Embedding strategy** (recursive): Creates overlapping chunks for better retrieval

## Data Flow

### Ingestion Flow
```
File Upload
    ↓
FileProcessor (route by extension)
    ↓
Parser (extract text)
    ↓
Fractalizer.analyzeContent (detect splits)
    ↓
[Human Review in UI]
    ↓
Fractalizer.proposePlacement (AI suggestion)
    ↓
[Human Approval]
    ↓
ContentStore.create (store content)
    ↓
TreeStore.createNode (create structure)
    ↓
VectorStore.upsert (index for search)
```

### Retrieval Flow
```
Query
    ↓
VectorStore.search (semantic search)
    ↓
Navigator.globalMapScan (identify branches)
    ↓
Navigator.precisionDrill (explore branches)
    ↓
Collect relevant nodes
    ↓
LLM synthesis (askStream for real-time)
    ↓
Answer with references
```

### Store Resolution (KB Context)

When working with KBs, the engine resolves the correct storage context:

```
Request comes in
    ↓
Determine context (Internal vs KB)
    ↓
┌─────────────────────────────────────┐
│ Internal: Use main storage          │
│ KB: Use KB's isolated storage       │
└─────────────────────────────────────┘
    ↓
Navigator/Fractalizer use resolved stores
    ↓
Operations isolated to correct context
```

## Configuration

**Required fields in `config.json`:**
```json
{
  "instanceId": "my-instance",
  "storagePath": "./data",
  "kbStoragePath": "./data/knowledge-bases",
  "llm": {
    "adapter": "openai" | "ollama",
    "model": "gpt-4.1-mini",
    "basicModel": "gpt-4.1-mini",
    "expertModel": "gpt-4.1"
  },
  "embedding": {
    "adapter": "openai" | "ollama",
    "model": "text-embedding-3-small"
  },
  "trees": [
    {
      "id": "unique-id",
      "name": "Display Name",
      "organizingPrinciple": "How to organize content",
      "seedFolders": [...],
      "dogma": { ... }
    }
  ],
  "knowledgeBases": [
    { "path": "./kbs/my-kb", "enabled": true }
  ],
  "ingestion": {
    "splitThreshold": 2000,
    "maxDepth": 3,
    "chunkOverlap": 100
  }
}
```

## CLI Commands

```bash
fkt setup                        # Initialize trees from config
fkt ingest-file <path>           # Ingest single file
fkt ingest-dir <dir>             # Ingest directory
fkt browse [treeId]              # Print tree structure
fkt retrieve <query>             # Search for content
fkt ask <query>                  # RAG with synthesis
fkt audit [--apply]              # Check tree health
fkt reset [--prune]              # Clear tree
fkt test-nuggets [name] [--json] # Run nugget diagnostic tests
```

The `test-nuggets` command runs all 12 nuggets (or a single one by name) against the configured LLM and writes a timestamped diagnostic report to the working directory with: rendered prompts, raw LLM output, parsed output, adapter/model metadata, timing, and validation results.
