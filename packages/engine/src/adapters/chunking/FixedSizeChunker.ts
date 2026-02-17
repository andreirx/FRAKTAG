/**
 * Fixed-Size Chunker
 *
 * Simple chunking strategy that splits text into fixed-size chunks
 * with configurable overlap. Does NOT respect natural boundaries.
 *
 * Achieved 67% accuracy in RAG benchmarks - solid baseline.
 *
 * Two common configurations:
 * - 512 tokens with 50 token overlap (default)
 * - 1024 tokens with 100 token overlap (for document-level retrieval)
 */

import {
  type IChunkingStrategy,
  type Chunk,
  type ChunkingOptions,
  resolveOptions,
  estimateTokens as defaultEstimateTokens,
} from './IChunkingStrategy.js';

export class FixedSizeChunker implements IChunkingStrategy {
  readonly name: string;

  /**
   * @param preset - Optional preset: '512' or '1024' for common configurations
   */
  constructor(preset?: '512' | '1024') {
    this.name = preset ? `fixed-${preset}` : 'fixed';
  }

  async chunk(text: string, options?: ChunkingOptions): Promise<Chunk[]> {
    const { maxChars, overlapChars, minChunkChars } = resolveOptions(options);

    const chunks: Chunk[] = [];
    let start = 0;

    while (start < text.length) {
      // Calculate end position
      let end = Math.min(start + maxChars, text.length);

      // Try to break at a word boundary if not at the end
      if (end < text.length) {
        // Look back for a space within the last 10% of the chunk
        const searchStart = Math.max(start, end - Math.floor(maxChars * 0.1));
        const lastSpace = text.lastIndexOf(' ', end);

        if (lastSpace > searchStart) {
          end = lastSpace + 1; // Include the space in the current chunk
        }
      }

      const chunkText = text.slice(start, end);

      // Only add non-empty chunks that meet minimum size
      if (chunkText.trim().length >= minChunkChars) {
        chunks.push({
          text: chunkText.trim(),
          startOffset: start,
          endOffset: end,
        });
      }

      // Move start forward, accounting for overlap
      const step = end - start - overlapChars;
      start = start + Math.max(step, 1); // Ensure we always make progress
    }

    return chunks;
  }

  estimateTokens(text: string): number {
    return defaultEstimateTokens(text);
  }
}

/**
 * Pre-configured 512-token chunker (article's runner-up at 67% accuracy)
 */
export class FixedSize512Chunker extends FixedSizeChunker {
  constructor() {
    super('512');
  }

  async chunk(text: string, options?: ChunkingOptions): Promise<Chunk[]> {
    return super.chunk(text, {
      maxTokens: 512,
      overlapTokens: 50,
      minChunkTokens: 50,
      ...options,
    });
  }
}

/**
 * Pre-configured 1024-token chunker (better document-level F1)
 */
export class FixedSize1024Chunker extends FixedSizeChunker {
  constructor() {
    super('1024');
  }

  async chunk(text: string, options?: ChunkingOptions): Promise<Chunk[]> {
    return super.chunk(text, {
      maxTokens: 1024,
      overlapTokens: 100,
      minChunkTokens: 100,
      ...options,
    });
  }
}
