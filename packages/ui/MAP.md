# UI Package Map

The UI package is a React application providing a visual interface for knowledge management, ingestion, and querying.

## Architecture Overview

```
src/
├── main.tsx                      # React entry point
├── App.tsx                       # Router and layout
├── pages/
│   └── KnowledgeTree.tsx         # Main page - tree visualization and content
├── components/
│   ├── ui/                       # Shadcn UI primitives
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── input.tsx
│   │   ├── scroll-area.tsx
│   │   └── separator.tsx
│   └── fraktag/                  # Domain-specific components
│       ├── TreeItem.tsx          # Recursive tree node renderer
│       ├── IngestionDialog.tsx   # Multi-step ingestion wizard
│       ├── QueryDialog.tsx       # Streaming Q&A interface
│       └── MoveDialog.tsx        # Node relocation dialog
└── lib/
    └── utils.ts                  # Utility functions (cn for classnames)
```

## Tech Stack

- **React 19** - UI framework
- **Vite 6** - Build tool and dev server
- **Tailwind CSS v4** - Styling
- **Shadcn UI** - Component library (Radix primitives)
- **Axios** - HTTP client
- **Lucide React** - Icons
- **react-resizable-panels** - Resizable split views

## Main Page: KnowledgeTree.tsx

The primary interface showing:
1. **Left Panel** - Tree navigation with collapsible hierarchy
2. **Right Panel** - Content inspector with editable fields

### State Management

```typescript
// Tree data
const [trees, setTrees] = useState<Tree[]>([]);
const [activeTreeId, setActiveTreeId] = useState("");
const [flatList, setFlatList] = useState<TreeNode[]>([]);
const [childrenMap, setChildrenMap] = useState<Record<string, TreeNode[]>>({});

// Selection and content
const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
const [selectedContent, setSelectedContent] = useState<ContentAtom | null>(null);

// Dialogs
const [ingestionDialogOpen, setIngestionDialogOpen] = useState(false);
const [queryDialogOpen, setQueryDialogOpen] = useState(false);
const [moveDialogOpen, setMoveDialogOpen] = useState(false);

// Editing
const [editingTitle, setEditingTitle] = useState("");
const [editingGist, setEditingGist] = useState("");
```

### Key Features

- **Auto-save:** Title/gist changes debounced (800ms) and saved via PATCH
- **Tree filtering:** Filter nodes by title/gist text
- **Folder creation:** Create subfolders with rule enforcement
- **Content inspection:** View and edit node metadata

### Data Flow

```
App Load
    ↓
GET /api/trees → setTrees
    ↓
Select Tree
    ↓
GET /api/trees/:id/structure → setFlatList, buildChildrenMap
    ↓
Select Node
    ↓
GET /api/content/:id → setSelectedContent (if has contentId)
    ↓
Edit Title/Gist
    ↓
PATCH /api/nodes/:id (debounced)
```

## Component: TreeItem.tsx

Recursive component rendering tree nodes.

### Props
```typescript
interface TreeItemProps {
  node: TreeNode;
  childrenMap: Record<string, TreeNode[]>;
  onSelect: (node: TreeNode) => void;
  selectedId?: string;
  depth?: number;
}
```

### Features

- **Type-based icons:** Folder, Document, Fragment
- **Type-based colors:** Blue (folder), Gray (document), Amber (fragment)
- **Auto-expansion:** Folders expand by default, documents don't
- **Gist preview:** Shows on hover or when selected
- **Indentation:** Progressive padding based on depth

### Rendering Logic

```typescript
const defaultOpen = node.type === 'folder';  // Folders auto-expand
const hasChildren = children.length > 0;

// Icon selection
switch (node.type) {
  case 'folder': return <Folder />;
  case 'document': return <FileText />;
  case 'fragment': return <Puzzle />;
}
```

## Component: IngestionDialog.tsx

Multi-step wizard for human-supervised content ingestion.

### Steps

1. **Upload** - Drag-and-drop file or paste text
2. **Split** - Review and adjust content splits
3. **Placement** - Select target folder
4. **Commit** - Final review and save

### State

```typescript
// Step tracking
const [step, setStep] = useState<'upload' | 'split' | 'placement' | 'committed'>('upload');

// Content
const [fileContent, setFileContent] = useState("");
const [fileName, setFileName] = useState("");
const [splits, setSplits] = useState<{ title: string; text: string }[]>([]);

// Split options
const [showCustomSplit, setShowCustomSplit] = useState(false);
const [customSplitPattern, setCustomSplitPattern] = useState("");

// Placement
const [targetFolderId, setTargetFolderId] = useState("");
const [availableFolders, setAvailableFolders] = useState<Folder[]>([]);

// Audit trail
const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
```

### Split Methods

```typescript
type SplitMethod =
  | 'h1' | 'h2' | 'h3'      // Header-based
  | 'hr'                     // Horizontal rule
  | 'num1' | 'num2' | 'num3' | 'num4'  // Numbered sections
  | 'custom'                 // User regex
  | 'none';                  // No split
```

### Key Features

- **Document minimap:** Visual preview showing where splits fall
- **Smart title detection:** Extracts titles from repeated delimiters
- **Per-section splitting:** Further split individual sections
- **AI splits:** LLM-based semantic boundary detection
- **Auto-recovery:** Adds missing content when AI splits are incomplete
- **Custom regex:** User-defined split patterns
- **Audit logging:** All actions tracked with actor attribution

### UI Flow

```
Upload File → Parse → Analyze Splits
    ↓
Show Splits with Minimap
    ↓
User Reviews (merge, split further, edit)
    ↓
Click "Move to Placement"
    ↓
AI Proposes Folder (or create new)
    ↓
User Selects/Overrides
    ↓
Click "Commit"
    ↓
Create Document + Fragments
    ↓
Show Success + Audit Log Download
```

## Component: QueryDialog.tsx

Streaming Q&A interface with real-time feedback.

### State

```typescript
// Query
const [queryText, setQueryText] = useState("");

// Results
const [retrieveResults, setRetrieveResults] = useState<RetrieveResult | null>(null);

// Streaming
const [streamingSources, setStreamingSources] = useState<StreamingSource[]>([]);
const [streamingAnswer, setStreamingAnswer] = useState("");
const [streamingReferences, setStreamingReferences] = useState<string[]>([]);
const [isStreaming, setIsStreaming] = useState(false);

// EventSource ref
const eventSourceRef = useRef<EventSource | null>(null);
```

### Two Query Modes

1. **Retrieve:** Non-streaming vector + graph search
   - Returns matching fragments with paths
   - Shows navigation path through tree

2. **Ask:** Streaming RAG synthesis
   - Sources appear as discovered (animated cards)
   - Answer streams in real-time with blinking cursor
   - References shown after completion

### SSE Integration

```typescript
function handleAsk() {
  const url = `/api/ask/stream?query=${queryText}&treeId=${treeId}`;
  const eventSource = new EventSource(url);

  eventSource.addEventListener("source", (e) => {
    // Add source card with animation
    setStreamingSources(prev => [...prev, JSON.parse(e.data)]);
  });

  eventSource.addEventListener("chunk", (e) => {
    // Append to streaming answer
    setStreamingAnswer(prev => prev + JSON.parse(e.data).text);
  });

  eventSource.addEventListener("done", (e) => {
    setStreamingReferences(JSON.parse(e.data).references);
    setIsStreaming(false);
  });
}
```

### UI Features

- **Source cards:** Compact cards showing [index], title, and file info
- **Streaming cursor:** Blinking indicator while answer generates
- **Auto-scroll:** Answer area scrolls as content arrives
- **Clear button:** Reset results for new query

## Component: MoveDialog.tsx

Node relocation with path visibility.

### Props
```typescript
interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treeId: string;
  nodeId: string;
  nodeType: string;
  flatList: TreeNode[];
  childrenMap: Record<string, TreeNode[]>;
  onComplete?: () => void;
}
```

### Features

- **Path display:** Full path with chevrons, last segment bold
- **Valid targets only:** Filters based on node type rules
- **Inline folder creation:** Create subfolder in target (if allowed)
- **Rule enforcement:**
  - Folders can move anywhere
  - Content can only move to leaf folders

### Folder Creation Rules

```typescript
// Can create subfolder if: no children, or all children are folders
const canCreateSubfolder = (folderId: string): boolean => {
  const children = childrenMap[folderId] || [];
  return children.every(c => c.type === 'folder');
};
```

## Styling Patterns

### Tailwind Classes

```typescript
// Selection highlight
isSelected ? "bg-purple-50 border-purple-600" : "border-transparent hover:bg-zinc-50"

// Loading state
"animate-spin"

// Streaming animation
"animate-in fade-in slide-in-from-left-2 duration-300"

// Blinking cursor
"inline-block w-2 h-4 bg-purple-500 animate-pulse"
```

### Shadcn Components Used

- `Dialog` - Modal dialogs
- `Button` - Action buttons
- `Input` - Text inputs
- `ScrollArea` - Scrollable containers
- `DropdownMenu` - Context menus
- `Card` - Content containers
- `Separator` - Visual dividers

## API Communication

All API calls use Axios with the Vite proxy:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:3000'
  }
}
```

### Request Patterns

```typescript
// GET requests
const res = await axios.get(`/api/trees/${treeId}/structure`);

// POST requests
const res = await axios.post('/api/retrieve', { treeId, query, maxDepth: 5 });

// PATCH requests (auto-save)
await axios.patch(`/api/nodes/${nodeId}`, { title, gist });

// SSE streaming
const eventSource = new EventSource(`/api/ask/stream?query=${query}&treeId=${treeId}`);
```

## Development

```bash
# Start dev server (port 5173)
npm run dev --workspace=@fraktag/ui

# Build for production
npm run build --workspace=@fraktag/ui

# Preview production build
npm run preview --workspace=@fraktag/ui
```

## File Size Reference

| Component | Lines | Responsibility |
|-----------|-------|----------------|
| KnowledgeTree.tsx | ~600 | Main page, state management |
| IngestionDialog.tsx | ~1700 | Full ingestion workflow |
| QueryDialog.tsx | ~440 | Streaming Q&A |
| MoveDialog.tsx | ~280 | Node relocation |
| TreeItem.tsx | ~135 | Tree node rendering |
