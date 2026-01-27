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
│   │   ├── ILLMAdapter.ts
│   │   ├── OpenAIAdapter.ts
│   │   └── OllamaAdapter.ts
│   ├── embeddings/       # Embedding adapters
│   │   ├── IEmbeddingAdapter.ts
│   │   ├── OpenAIEmbeddingAdapter.ts
│   │   └── OllamaEmbeddingAdapter.ts
│   ├── storage/          # Storage adapters
│   │   ├── IStorage.ts
│   │   ├── JsonStorage.ts    # Local filesystem (default)
│   │   ├── S3Storage.ts      # AWS S3 (cloud/enterprise)
│   │   └── index.ts          # Factory + exports
│   └── parsing/          # File parsing adapters
│       ├── IFileParser.ts
│       ├── TextParser.ts
│       └── PdfParser.ts
├── prompts/              # LLM prompt templates
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
- `audit(treeId)` - Structural audit
- `reset(treeId, { pruneContent })` - Clear tree

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

Handles document ingestion and intelligent splitting.

**Splitting Strategies:**
1. **Header-based:** Split on `#`, `##`, `###` markdown headers
2. **Horizontal Rule:** Split on `---` separators
3. **Page markers:** Split on PDF page boundaries
4. **Numbered sections:** Split on `1.`, `A.`, `I.`, `1.1.` patterns
5. **AI-assisted:** LLM-driven semantic boundary detection

**Key Methods:**
- `analyzeContent(content)` - Detect natural boundaries
- `splitByHeaders(content, level)` - Header-based splitting
- `generateTitle(content)` / `generateGist(content)` - AI generation
- `proposePlacement(treeId, title, gist)` - Find best folder

### 6. Navigator (`core/Navigator.ts`)

Retrieval engine using ensemble strategy.

**Retrieval Phases:**
1. **Vector Paratroopers:** Fast semantic search to find deep relevant nodes
2. **Global Map Scan:** LLM analyzes tree gists to identify promising branches
3. **Precision Drilling:** Recursive exploration with relevance scoring

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

## Adapters

### LLM Adapters

**Interface (`ILLMAdapter`):**
```typescript
interface ILLMAdapter {
  complete(prompt, variables, options?): Promise<string>;
  stream?(prompt, variables, onChunk, options?): Promise<string>;
  testConnection(): Promise<boolean>;
}
```

**Implementations:**
- `OpenAIAdapter` - GPT-4/GPT-5/O-series with streaming support, default concurrency 10
- `OllamaAdapter` - Local models (Qwen, Llama, DeepSeek), default concurrency 1

Both adapters use `Semaphore` for concurrency control. Concurrency is configurable via `LLMConfig.concurrency`.

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

**Implementations:**
- `JsonStorage` - Local filesystem with JSON files (default)
- `S3Storage` - AWS S3 backend for cloud/enterprise deployments

**Factory Function (`createStorage`):**
```typescript
function createStorage(config?: Partial<StorageConfig>): IStorage;

// Reads STORAGE_ADAPTER env var ('fs' | 's3')
// For S3: requires S3_BUCKET_DATA, optional STORAGE_PREFIX
// For fs: uses STORAGE_ROOT or './data'
```

**S3Storage Features:**
- Multi-tenancy via prefix (e.g., `tenants/{userId}/`)
- Automatic corruption detection and recovery
- Virtual directories (S3 key prefixes)
- Read-modify-write for append operations

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

### Store Resolution (Multi-tenant / KB Context)

When working with KBs or in cloud mode, the engine resolves the correct storage context:

```
Request comes in
    ↓
Determine context (Internal vs KB)
    ↓
┌─────────────────────────────────────┐
│ Internal: Use main storage          │
│ KB: Use KB's isolated storage       │
│ Cloud: Use S3 with tenant prefix    │
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
fkt setup              # Initialize trees from config
fkt ingest-file <path> # Ingest single file
fkt ingest-dir <dir>   # Ingest directory
fkt browse [treeId]    # Print tree structure
fkt retrieve <query>   # Search for content
fkt ask <query>        # RAG with synthesis
fkt audit [--apply]    # Check tree health
fkt reset [--prune]    # Clear tree
```
