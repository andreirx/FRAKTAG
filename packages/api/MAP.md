# API Package Map

The API package is a lightweight Express server that bridges the engine to the UI and external clients.

## Architecture Overview

```
src/
└── server.ts    # Express server with all endpoints
```

## Server Structure

### Initialization

```typescript
// Load engine from config
const configPath = findConfig();  // Env var > dev path > root path > cwd
const fraktag = await Fraktag.fromConfigFile(configPath);

// Express setup
app.use(cors());
app.use(express.json({ limit: '10mb' }));
```

### Config Resolution Order

1. `FRAKTAG_CONFIG` environment variable
2. `../../../packages/engine/data/config.json` (dev mode)
3. `./packages/engine/data/config.json` (from monorepo root)
4. `./data/config.json` (from current directory)

## Endpoint Categories

### 1. Tree Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trees` | List trees (supports `?type=knowledge\|conversation` and `?kbId=` filters) |
| POST | `/api/trees` | Create new tree in internal KB |
| GET | `/api/trees/:id` | Get tree metadata |
| PATCH | `/api/trees/:id` | Update tree (name, organizingPrinciple) |
| GET | `/api/trees/:id/structure` | Full tree with all nodes (clears cache first) |
| GET | `/api/trees/:id/visual` | Text-based tree visualization |
| GET | `/api/trees/:id/folders` | Get leaf folders with full paths |

**Folder path building:**
The `/folders` endpoint builds human-readable paths by traversing parent nodes:
```typescript
// Returns: [{ id, title, gist, path: "Root > Category > Subcategory" }]
```

### 2. Folder Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/trees/:id/folders` | Create subfolder |

**Request body:**
```json
{
  "parentId": "folder-uuid",
  "title": "New Folder",
  "gist": "Description of folder purpose"
}
```

### 3. Node Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/nodes/:id` | Get node with hydrated content |
| PATCH | `/api/nodes/:id` | Update title and/or gist |
| DELETE | `/api/nodes/:id` | Delete content node |
| PATCH | `/api/nodes/:id/move` | Move node to new parent |
| POST | `/api/nodes/:id/replace-version` | Replace node content with new version |

**Update body:**
```json
{ "title": "New Title", "gist": "New description" }
```

**Move body:**
```json
{ "newParentId": "target-folder-uuid" }
```

### 4. Content Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/content/:id` | Get raw content atom |
| PATCH | `/api/content/:id` | Update editable content payload |
| GET | `/api/content/:id/history` | Get content version history |
| GET | `/api/content/:id/latest` | Get latest content version |

**Response:**
```json
{
  "id": "content-uuid",
  "hash": "sha256-hash",
  "payload": "Raw text content...",
  "sourceUri": "original/file/path.md",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### 5. File Parsing

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/parse` | Parse uploaded file (PDF, text, etc.) |

**Request body:**
```json
{
  "fileName": "document.pdf",
  "content": "base64-encoded-content"
}
```

**Response:**
```json
{
  "text": "Extracted text content...",
  "fileName": "document.pdf",
  "originalSize": 12345,
  "textLength": 5678
}
```

### 6. AI Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analyze` | Analyze content for splits |
| POST | `/api/generate/title` | Generate title for content |
| POST | `/api/generate/gist` | Generate gist for content |
| POST | `/api/generate/splits` | AI-assisted content splitting |
| POST | `/api/propose-placement` | AI folder suggestion |

**Analyze request:**
```json
{ "content": "Text to analyze...", "sourceUri": "file.md" }
```

**Generate request:**
```json
{ "content": "Text content...", "treeId": "notes" }
```

**Propose placement request:**
```json
{
  "treeId": "notes",
  "documentTitle": "Document Title",
  "documentGist": "Document description"
}
```

### 7. Ingestion

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/trees/:treeId/documents` | Ingest document into folder |
| POST | `/api/trees/:treeId/editable-documents` | Create editable document (user note) |
| POST | `/api/trees/:treeId/fragments` | Create fragment under document |

**Document request:**
```json
{
  "folderId": "target-folder-uuid",
  "content": "Document text...",
  "title": "Document Title",
  "gist": "Document description"
}
```

**Fragment request:**
```json
{
  "documentId": "parent-document-uuid",
  "content": "Fragment text...",
  "title": "Fragment Title",
  "gist": "Fragment description"
}
```

### 8. Retrieval

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/retrieve` | Vector + graph retrieval |
| POST | `/api/ask` | RAG synthesis (complete response) |
| GET | `/api/ask/stream` | **Streaming RAG via SSE** |
| POST | `/api/browse` | Navigate tree structure |

**Retrieve request:**
```json
{
  "treeId": "notes",
  "query": "Search query",
  "maxDepth": 5,
  "resolution": "L2"
}
```

**Ask request:**
```json
{ "query": "Question?", "treeId": "notes" }
```

#### Streaming Endpoint

`GET /api/ask/stream?query=Question&treeId=notes`

**SSE Events:**
```
event: source
data: {"index":1,"title":"Source Title","path":"Root > Folder","sourceInfo":"(File: doc.md)","preview":"Content preview..."}

event: chunk
data: {"text":"Answer text chunk..."}

event: done
data: {"references":["path/to/source1","path/to/source2"]}

event: error
data: {"message":"Error description"}
```

**SSE Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### 9. Conversation Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/conversations` | List all conversation sessions |
| POST | `/api/conversations` | Create session (body: `{ linkedContext: { treeIds } }`) |
| GET | `/api/conversations/:sessionId/turns` | Get turns in a session |
| PATCH | `/api/conversations/:sessionId` | Update session (title) |
| DELETE | `/api/conversations/:sessionId` | Delete a session |
| POST | `/api/chat/stream` | Streaming conversational RAG (SSE) |

**Chat stream request:**
```json
{
  "sessionId": "session-uuid",
  "question": "What is...",
  "treeIds": ["tree-1", "tree-2"]
}
```

**Chat SSE Events:**
```
event: source
data: {"index":1,"title":"Source Title","path":"Root > Folder","nodeId":"..."}

event: answer_chunk
data: {"text":"Answer text chunk..."}

event: done
data: {"answer":"Full answer","references":[...]}
```

### 10. Knowledge Base Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/knowledge-bases` | List all loaded KBs |
| GET | `/api/knowledge-bases/discover` | Discover all KBs (loaded and unloaded) |
| GET | `/api/knowledge-bases/:id` | Get KB details with associated trees |
| POST | `/api/knowledge-bases` | Create new KB |
| POST | `/api/knowledge-bases/:id/trees` | Add tree to KB |
| POST | `/api/knowledge-bases/export` | Export trees to new portable KB |
| POST | `/api/knowledge-bases/load` | Load existing KB from path |

### 11. Audit & Maintenance

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/trees/:id/audit-log` | Append audit entries |
| POST | `/api/trees/:id/verify` | Verify tree integrity |
| POST | `/api/trees/:id/audit` | Run structural audit |
| POST | `/api/trees/:id/reset` | Clear tree |

**Audit log request:**
```json
{
  "entries": [
    { "type": "SPLIT_CREATED", "detail": "Created split...", "actor": "human" }
  ],
  "sessionId": "session-uuid"
}
```

## Error Handling

All errors return JSON:
```json
{ "error": "Error message description" }
```

**Status codes:**
- `400` - Bad request (missing params)
- `404` - Resource not found
- `500` - Internal server error
- `503` - Engine not ready

## Data Flow

### Request → Engine → Response

```
HTTP Request
    ↓
Express Router (matches endpoint)
    ↓
Validation (check required params)
    ↓
Fraktag Method Call
    ↓
Engine Processing
    ↓
JSON Response (or SSE stream)
```

### Streaming Flow

```
GET /api/ask/stream
    ↓
Set SSE headers
    ↓
fraktag.askStream(query, treeId, onEvent)
    ↓
onEvent('source', ...) → res.write('event: source\ndata: ...\n\n')
    ↓
onEvent('chunk', ...) → res.write('event: chunk\ndata: ...\n\n')
    ↓
onEvent('done', ...) → res.write('event: done\ndata: ...\n\n')
    ↓
res.end()
```

## Running the Server

```bash
# Development (with hot reload via tsx)
npm run dev --workspace=api

# Production
npm run build --workspace=api && npm start --workspace=api
```

**Default port:** 3000 (configurable via `PORT` env var)

## Dependencies

- `express` - HTTP server
- `cors` - Cross-origin requests (for UI dev server)
- `@fraktag/engine` - Core logic (workspace dependency)
