// src/core/types.ts

// ============ CONFIGURATION ============

export interface FraktagConfig {
  instanceId: string;
  storagePath: string;
  llm: LLMConfig;
  embedding?: EmbeddingConfig;
  trees: TreeConfig[];
  ingestion: IngestionConfig;
}

export interface LLMConfig {
  adapter: 'ollama' | 'openai' | 'anthropic';
  model: string;                    // 'qwen3-coder', 'gpt-4.1-mini', 'claude-sonnet-4-20250514'
  basicModel?: string;              // BASIC model (e.g. gpt-5-nano)
  endpoint?: string;                // For ollama: 'http://localhost:11434'
  apiKey?: string;                  // For cloud providers
  prompts?: Partial<PromptSet>;     // Override defaults
}

// Add EmbeddingConfig
export interface EmbeddingConfig {
  adapter: 'ollama' | 'openai';
  model: string;
  endpoint?: string;
  apiKey?: string;
}

export interface TreeConfig {
  id: string;
  name: string;
  organizingPrinciple: string;      // Injected into L0/L1 generation prompts
  autoPlace: boolean;               // Auto-place ingested content in this tree
  placementStrategy?: string;       // Prompt fragment for auto-placement logic
  dogma?: {                         // Heresy prevention rules
    strictness: 'lenient' | 'strict' | 'fanatical';
    forbiddenConcepts?: string[];   // Concepts to exclude from summaries
    requiredContext?: string[];     // Context that must be preserved
  };
}

export interface IngestionConfig {
  splitThreshold: number;           // Word count triggering split evaluation
  maxDepth: number;                 // Maximum tree depth for recursive splitting
  chunkOverlap: number;             // Words of overlap between chunks (context preservation)
}

export interface PromptSet {
  shouldSplit: string;
  split: string;
  generateGist: string;
  generateL1: string;
  placeInTree: string;
  detectHeresy: string;
  findSplitAnchors: string;
  evaluateRelevance: string;
  assessNeighborhood: string;
  assessRelevance: string;
  checkSimilarity: string;
  routeTraversal: string;
  globalMapScan: string;
  assessVectorCandidates: string;
  checkRelationship: string;
}

// ============ CONTENT LAYER ============

export interface ContentAtom {
  id: string;
  hash: string;
  payload: string;
  mediaType: string;
  sourceUri?: string;               // Original URL, file path, or identifier
  createdAt: string;
  createdBy: string;
  supersedes?: string;
  metadata: Record<string, unknown>;
}

// ============ TREE LAYER ============

export interface Tree {
  id: string;
  name: string;
  organizingPrinciple: string;
  rootNodeId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TreeNode {
  id: string;
  treeId: string;
  parentId: string | null;
  path: string;
  contentId: string | null;         // Null for organizational nodes

  l0Gist: string;
  l1Map: L1Map | null;

  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface L1Map {
  summary: string;
  childInventory: ChildRef[];
  outboundRefs: OutboundRef[];
}

export interface ChildRef {
  nodeId: string;
  gist: string;
}

export interface OutboundRef {
  targetNodeId: string;
  relation: string;
}

// ============ API TYPES ============

export interface IngestRequest {
  content: string;
  sourceUri?: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
  targetTrees?: string[];           // Tree IDs; if empty, uses autoPlace trees
  parentNodeId?: string;            // Explicit placement; if empty, auto-place
}

export interface IngestResult {
  contentId: string;
  placements: {
    treeId: string;
    nodeId: string;
    path: string;
  }[];
}

export interface RetrieveRequest {
  treeId: string;
  query: string;
  maxDepth?: number;                // How deep to zoom
  resolution?: 'L0' | 'L1' | 'L2';  // What to return
}

export interface RetrieveResult {
  nodes: RetrievedNode[];
  navigationPath: string[];         // Node IDs traversed
}

export interface RetrievedNode {
  nodeId: string;
  path: string;
  resolution: 'L0' | 'L1' | 'L2';
  content: string;                  // Gist, map summary, or full payload
  contentId?: string;
}

export interface BrowseRequest {
  treeId: string;
  nodeId?: string;                  // Start point; null = root
  resolution: 'L0' | 'L1';
}

export interface BrowseResult {
  node: {
    id: string;
    path: string;
    gist: string;
    summary?: string;
  };
  children: {
    id: string;
    gist: string;
  }[];
  parent?: {
    id: string;
    gist: string;
  };
}

export interface VerificationResult {
  valid: boolean;
  orphanNodes: string[];
  missingContentRefs: string[];
  errors: string[];
}
