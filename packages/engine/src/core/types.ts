// src/core/types.ts
// STRICT TAXONOMY: Folder → Document → Fragment

// ============ PORTABLE KNOWLEDGE BASE ============

/**
 * A self-contained knowledge base with its own content, indexes, and trees.
 * Can be moved, shared, and versioned independently.
 */
export interface KnowledgeBaseConfig {
  id: string;
  name: string;
  organizingPrinciple: string;
  defaultTreeId?: string;
  seedFolders?: SeedFolder[];
  dogma?: {
    strictness: 'lenient' | 'strict' | 'fanatical';
    forbiddenConcepts?: string[];
    requiredContext?: string[];
  };
}

/**
 * Reference to a knowledge base in the main config
 */
export interface KnowledgeBaseRef {
  path: string;           // Path to KB folder (relative or absolute)
  enabled?: boolean;      // Whether to load this KB (default: true)
}

// ============ CONFIGURATION ============

export interface FraktagConfig {
  instanceId: string;
  storagePath: string;
  llm: LLMConfig;
  embedding?: EmbeddingConfig;
  trees: TreeConfig[];                  // Legacy: inline tree definitions
  knowledgeBases?: KnowledgeBaseRef[];  // New: portable KB references
  ingestion: IngestionConfig;
}

export interface LLMConfig {
  adapter: 'ollama' | 'openai' | 'anthropic';
  model: string;
  basicModel?: string;
  expertModel?: string;
  endpoint?: string;
  apiKey?: string;
  prompts?: Partial<PromptSet>;
}

export interface EmbeddingConfig {
  adapter: 'ollama' | 'openai';
  model: string;
  endpoint?: string;
  apiKey?: string;
}

export interface TreeConfig {
  id: string;
  name: string;
  organizingPrinciple: string;
  autoPlace: boolean;
  placementStrategy?: string;
  seedFolders?: SeedFolder[];      // Pre-defined folder structure
  dogma?: {
    strictness: 'lenient' | 'strict' | 'fanatical';
    forbiddenConcepts?: string[];
    requiredContext?: string[];
  };
}

export interface SeedFolder {
  title: string;
  gist: string;
  children?: SeedFolder[];
}

export interface IngestionConfig {
  splitThreshold: number;
  maxDepth: number;
  chunkOverlap: number;
}

export interface PromptSet {
  shouldSplit: string;
  split: string;
  generateGist: string;
  generateTitle: string;
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
  analyzeTreeStructure: string;
  proposePlacement: string;
}

// ============ CONTENT LAYER ============

/**
 * Content editability mode:
 * - 'editable': User can directly edit the content in the UI
 * - 'readonly': Content is immutable; can only be replaced with a new version
 */
export type ContentEditMode = 'editable' | 'readonly';

export interface ContentAtom {
  id: string;
  hash: string;
  payload: string;
  mediaType: string;
  sourceUri?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;           // For editable content - last edit time
  supersedes?: string;          // For versioning - ID of previous version
  supersededBy?: string;        // For versioning - ID of newer version (set when replaced)
  editMode: ContentEditMode;    // Whether content is editable or readonly
  metadata: Record<string, unknown>;
}

// ============ TREE LAYER (STRICT TAXONOMY) ============

export type NodeType = 'folder' | 'document' | 'fragment';

/**
 * Base properties shared by all node types
 */
export interface BaseNode {
  id: string;
  treeId: string;
  parentId: string | null;
  path: string;

  type: NodeType;
  title: string;       // User-facing label (e.g., "Architecture Specs")
  gist: string;        // AI-generated summary/readme (e.g., "Contains system diagrams and API definitions")

  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Folder Node (Structural Only)
 *
 * Constraint: A folder is either:
 * - A "Branch Folder" containing ONLY other Folders
 * - A "Leaf Folder" containing ONLY Documents
 *
 * Folders have NO content themselves.
 */
export interface FolderNode extends BaseNode {
  type: 'folder';
  // No contentId - folders are pure structure
}

/**
 * Document Node (Leaf of the Organizational Tree)
 *
 * Represents a complete piece of content (e.g., a full article, note, or file).
 * Documents are the leaves from the folder structure perspective.
 *
 * Constraint: Can ONLY contain Fragment children (if split).
 */
export interface DocumentNode extends BaseNode {
  type: 'document';
  contentId: string;           // Reference to the full text in ContentStore
  editMode: ContentEditMode;   // Whether content is editable or readonly
}

/**
 * Fragment Node (Part of a Document)
 *
 * Represents a chunk/section of a Document.
 * Fragments are tied to their parent Document and cannot exist independently.
 *
 * Constraint: Can only have other Fragments as children (nested chunks).
 */
export interface FragmentNode extends BaseNode {
  type: 'fragment';
  contentId: string;           // Reference to the chunk text in ContentStore
  editMode: ContentEditMode;   // Whether content is editable or readonly
}

/**
 * Union type for all tree nodes
 */
export type TreeNode = FolderNode | DocumentNode | FragmentNode;

/**
 * Tree metadata
 */
export interface Tree {
  id: string;
  name: string;
  organizingPrinciple: string;
  rootNodeId: string;
  createdAt: string;
  updatedAt: string;
}

// ============ INGESTION & PROPOSALS (Human-Assisted) ============

/**
 * Initial request to ingest content
 */
export interface IngestRequest {
  content: string;
  sourceUri?: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
  targetTrees?: string[];
  parentNodeId?: string;
}

/**
 * Result of analyzing a file for splitting
 * This is the FIRST step - programmatic split detection
 */
export interface SplitAnalysis {
  sourceUri: string;
  fullText: string;
  suggestedTitle: string;
  detectedSplits: DetectedSplit[];
  splitMethod: 'TOC' | 'PDF_PAGE' | 'HEADER' | 'HR' | 'NONE';
}

/**
 * A single detected split point
 */
export interface DetectedSplit {
  title: string;           // Detected section title (from header/ToC)
  text: string;            // The content of this section
  startIndex: number;      // Character offset in original
  endIndex: number;        // Character offset in original
  confidence: number;      // How confident we are in this split (0-1)
}

/**
 * Human-reviewed split proposal
 * After the human confirms/edits the splits
 */
export interface ConfirmedSplits {
  sourceUri: string;
  documentTitle: string;
  splits: {
    title: string;
    text: string;
  }[];
}

/**
 * AI-generated placement proposal
 * Shown to human for approval
 */
export interface PlacementProposal {
  treeId: string;
  documentTitle: string;
  documentGist: string;
  targetFolderId: string;
  targetFolderPath: string;
  newFolderSuggestion?: {
    title: string;
    gist: string;
    parentId: string;
  };
  reasoning: string;
  confidence: number;
}

/**
 * Complete ingestion proposal (for UI)
 */
export interface IngestionProposal {
  analysis: SplitAnalysis;
  confirmedSplits?: ConfirmedSplits;
  placement?: PlacementProposal;
  status: 'analyzing' | 'awaiting_split_review' | 'awaiting_placement_review' | 'ready' | 'committed';
}

/**
 * Result after committing an ingestion
 */
export interface IngestResult {
  contentId: string;
  placements: {
    treeId: string;
    nodeId: string;
    path: string;
  }[];
}

// ============ API TYPES ============

export interface RetrieveRequest {
  treeId: string;
  query: string;
  maxDepth?: number;
  resolution?: 'L0' | 'L1' | 'L2';
}

export interface RetrieveResult {
  nodes: RetrievedNode[];
  navigationPath: string[];
}

export interface RetrievedNode {
  nodeId: string;
  path: string;
  resolution: 'L0' | 'L1' | 'L2';
  content: string;
  contentId?: string;
}

export interface BrowseRequest {
  treeId: string;
  nodeId?: string;
  resolution: 'L0' | 'L1';
}

export interface BrowseResult {
  node: {
    id: string;
    path: string;
    type: NodeType;
    title: string;
    gist: string;
  };
  children: {
    id: string;
    type: NodeType;
    title: string;
    gist: string;
  }[];
  parent?: {
    id: string;
    title: string;
  };
}

export interface VerificationResult {
  valid: boolean;
  orphanNodes: string[];
  missingContentRefs: string[];
  constraintViolations: string[];
  errors: string[];
}

// ============ TYPE GUARDS ============

export function isFolder(node: TreeNode): node is FolderNode {
  return node.type === 'folder';
}

export function isDocument(node: TreeNode): node is DocumentNode {
  return node.type === 'document';
}

export function isFragment(node: TreeNode): node is FragmentNode {
  return node.type === 'fragment';
}

export function hasContent(node: TreeNode): node is DocumentNode | FragmentNode {
  return node.type === 'document' || node.type === 'fragment';
}
