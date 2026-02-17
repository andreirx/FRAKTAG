/**
 * Chunking Strategy Port (Interface)
 *
 * Defines the contract for text chunking strategies.
 * Used for both tree node creation and embedding generation.
 *
 * Based on benchmarking research showing that chunking strategy
 * significantly impacts RAG retrieval quality:
 * - Recursive 512 tokens: 69% accuracy (best overall)
 * - Fixed 512 tokens: 67% accuracy
 * - Semantic chunking: 54% accuracy (fragments too small)
 */

/**
 * A single chunk of text produced by a chunking strategy
 */
export interface Chunk {
  /** The text content of this chunk */
  text: string;

  /** Start position in the original text (character offset) */
  startOffset: number;

  /** End position in the original text (character offset) */
  endOffset: number;

  /** Optional metadata about this chunk (e.g., heading level, page number) */
  metadata?: Record<string, unknown>;
}

/**
 * Options for controlling chunking behavior
 */
export interface ChunkingOptions {
  /** Target chunk size in tokens (default: 512) */
  maxTokens?: number;

  /** Overlap between consecutive chunks in tokens (default: 50) */
  overlapTokens?: number;

  /** Minimum chunk size - discard chunks smaller than this (default: 50) */
  minChunkTokens?: number;

  /** Character-based limits (alternative to token-based) */
  maxChars?: number;
  overlapChars?: number;
  minChunkChars?: number;
}

/**
 * Result of chunking operation with metadata
 */
export interface ChunkingResult {
  /** The chunks produced */
  chunks: Chunk[];

  /** Strategy that produced these chunks */
  strategyName: string;

  /** Average tokens per chunk (for adaptive k calculation) */
  avgTokensPerChunk: number;

  /** Total tokens across all chunks */
  totalTokens: number;
}

/**
 * Port interface for chunking strategies
 *
 * Implementations:
 * - RecursiveCharacterChunker: Splits at paragraph → sentence → word (recommended)
 * - FixedSizeChunker: Fixed token count with overlap
 * - DocumentStructureChunker: Splits on markdown headers/sections
 * - SemanticChunker: Embedding-based boundary detection
 * - PageChunker: PDF page boundaries
 * - PropositionChunker: LLM-decomposed atomic propositions
 */
export interface IChunkingStrategy {
  /** Human-readable name of this strategy */
  readonly name: string;

  /**
   * Split text into chunks according to this strategy
   *
   * @param text - The text to chunk
   * @param options - Optional chunking parameters
   * @returns Array of chunks with offset information
   */
  chunk(text: string, options?: ChunkingOptions): Promise<Chunk[]>;

  /**
   * Estimate token count for text (for adaptive k calculation)
   * Default implementation: chars / 4
   */
  estimateTokens(text: string): number;
}

/**
 * Default token estimation: ~4 chars per token (English text average)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Convert token count to approximate character count
 */
export function tokensToChars(tokens: number): number {
  return tokens * 4;
}

/**
 * Convert character count to approximate token count
 */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Resolve chunking options to character-based values
 * (internally we work with characters, but API accepts tokens)
 */
export function resolveOptions(options?: ChunkingOptions): {
  maxChars: number;
  overlapChars: number;
  minChunkChars: number;
} {
  // Default: 512 tokens, 50 token overlap, 50 token minimum
  const maxTokens = options?.maxTokens ?? 512;
  const overlapTokens = options?.overlapTokens ?? 50;
  const minChunkTokens = options?.minChunkTokens ?? 50;

  return {
    maxChars: options?.maxChars ?? tokensToChars(maxTokens),
    overlapChars: options?.overlapChars ?? tokensToChars(overlapTokens),
    minChunkChars: options?.minChunkChars ?? tokensToChars(minChunkTokens),
  };
}
