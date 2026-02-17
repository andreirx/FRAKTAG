/**
 * Chunking Adapters
 *
 * Provides pluggable chunking strategies for:
 * 1. Tree node creation (document-structure, page, etc.)
 * 2. Embedding generation (recursive, fixed-512, etc.)
 *
 * Based on RAG benchmark research:
 * - Recursive 512: 69% accuracy (RECOMMENDED)
 * - Fixed 512: 67% accuracy
 * - Fixed 1024: 61% accuracy (better doc-level F1)
 * - Semantic: 54% accuracy (fragments too small)
 * - Proposition: 51% accuracy (not production-ready)
 */

// Types and interface
export {
  type IChunkingStrategy,
  type Chunk,
  type ChunkingOptions,
  type ChunkingResult,
  estimateTokens,
  tokensToChars,
  charsToTokens,
  resolveOptions,
} from './IChunkingStrategy.js';

// Implementations
export { RecursiveCharacterChunker } from './RecursiveCharacterChunker.js';
export {
  FixedSizeChunker,
  FixedSize512Chunker,
  FixedSize1024Chunker,
} from './FixedSizeChunker.js';
export {
  DocumentStructureChunker,
  type DocumentStructureOptions,
} from './DocumentStructureChunker.js';

// Import types for factory
import type { IChunkingStrategy } from './IChunkingStrategy.js';
import type { EmbeddingChunkingStrategy } from '../../core/types.js';
import { RecursiveCharacterChunker } from './RecursiveCharacterChunker.js';
import { FixedSizeChunker, FixedSize512Chunker, FixedSize1024Chunker } from './FixedSizeChunker.js';

/**
 * Factory function to create a chunking strategy by name
 *
 * @param strategy - The strategy type to create
 * @returns An instance of the requested chunking strategy
 * @throws Error if strategy is not implemented
 */
export function createChunker(strategy: EmbeddingChunkingStrategy): IChunkingStrategy {
  switch (strategy) {
    case 'recursive':
      return new RecursiveCharacterChunker();

    case 'fixed-512':
      return new FixedSize512Chunker();

    case 'fixed-1024':
      return new FixedSize1024Chunker();

    case 'semantic':
      // TODO: Implement SemanticChunker (requires embedding adapter)
      throw new Error(
        'Semantic chunking not yet implemented. ' +
        'Note: Semantic chunking achieved only 54% accuracy in benchmarks due to fragmentation.'
      );

    case 'proposition':
      // TODO: Implement PropositionChunker (requires LLM adapter)
      throw new Error(
        'Proposition chunking not yet implemented. ' +
        'Note: Proposition chunking achieved only 51% accuracy in benchmarks.'
      );

    default:
      throw new Error(`Unknown chunking strategy: ${strategy}`);
  }
}

/**
 * Get the default (recommended) chunker
 * Returns RecursiveCharacterChunker based on benchmark results
 */
export function createDefaultChunker(): IChunkingStrategy {
  return new RecursiveCharacterChunker();
}

/**
 * Chunk text and return result with metadata
 */
export async function chunkWithMetadata(
  text: string,
  chunker: IChunkingStrategy,
  options?: { maxTokens?: number; overlapTokens?: number }
): Promise<{
  chunks: Array<{ text: string; startOffset: number; endOffset: number }>;
  strategyName: string;
  avgTokensPerChunk: number;
  totalTokens: number;
}> {
  const chunks = await chunker.chunk(text, options);

  const totalTokens = chunks.reduce((sum, c) => sum + chunker.estimateTokens(c.text), 0);
  const avgTokensPerChunk = chunks.length > 0 ? totalTokens / chunks.length : 0;

  return {
    chunks,
    strategyName: chunker.name,
    avgTokensPerChunk,
    totalTokens,
  };
}
