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
│   └── Arborist.ts       # Tree maintenance and auditing
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
│   │   └── JsonStorage.ts
│   └── parsing/          # File parsing adapters
│       ├── IFileParser.ts
│       ├── TextParser.ts
│       └── PdfParser.ts
├── prompts/              # LLM prompt templates
│   └── default.ts
└── utils/
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
- `OpenAIAdapter` - GPT-4 series with streaming support
- `OllamaAdapter` - Local models (Qwen, Llama, DeepSeek)

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

### Storage Adapter

**Interface (`IStorage`):**
```typescript
interface IStorage {
  read(path): Promise<string | null>;
  write(path, data): Promise<void>;
  delete(path): Promise<void>;
  list(prefix): Promise<string[]>;
  exists(path): Promise<boolean>;
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

## Configuration

**Required fields in `config.json`:**
```json
{
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
  ]
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
