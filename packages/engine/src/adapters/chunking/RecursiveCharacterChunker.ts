/**
 * Recursive Character Text Splitter
 *
 * LangChain-style chunking that tries to split at natural boundaries:
 * 1. Paragraph breaks (\n\n)
 * 2. Single newlines (\n)
 * 3. Sentence endings (. ! ? followed by space)
 * 4. Word boundaries (spaces)
 * 5. Character-by-character (last resort)
 *
 * This strategy achieved 69% accuracy in RAG benchmarks - the best overall.
 * It preserves logical units (paragraphs, sentences) while maintaining
 * consistent chunk sizes for retrieval.
 */

import {
  type IChunkingStrategy,
  type Chunk,
  type ChunkingOptions,
  resolveOptions,
  estimateTokens as defaultEstimateTokens,
} from './IChunkingStrategy.js';

/**
 * Separators in order of preference (try largest units first)
 */
const DEFAULT_SEPARATORS = [
  '\n\n',      // Paragraph breaks
  '\n',        // Line breaks
  '. ',        // Sentence endings
  '? ',        // Question endings
  '! ',        // Exclamation endings
  '; ',        // Semicolon breaks
  ', ',        // Comma breaks
  ' ',         // Word boundaries
  '',          // Character-by-character (fallback)
];

export class RecursiveCharacterChunker implements IChunkingStrategy {
  readonly name = 'recursive';

  private separators: string[];

  constructor(separators?: string[]) {
    this.separators = separators ?? DEFAULT_SEPARATORS;
  }

  async chunk(text: string, options?: ChunkingOptions): Promise<Chunk[]> {
    const { maxChars, overlapChars, minChunkChars } = resolveOptions(options);

    const chunks = this.splitText(text, maxChars, overlapChars, this.separators);

    // Filter out chunks that are too small
    const filtered = chunks.filter((c) => c.text.length >= minChunkChars);

    return filtered;
  }

  estimateTokens(text: string): number {
    return defaultEstimateTokens(text);
  }

  /**
   * Recursively split text using separators in order of preference
   */
  private splitText(
    text: string,
    maxChars: number,
    overlapChars: number,
    separators: string[]
  ): Chunk[] {
    if (text.length === 0) {
      return [];
    }

    // If text fits in one chunk, return it
    if (text.length <= maxChars) {
      return [
        {
          text: text.trim(),
          startOffset: 0,
          endOffset: text.length,
        },
      ];
    }

    // Find a separator that actually exists in the text
    let separator: string | undefined;
    let remainingSeparators: string[] = [];

    for (let i = 0; i < separators.length; i++) {
      const sep = separators[i];
      // Skip empty separator (fallback) and check if separator exists in text
      if (sep === '' || text.includes(sep)) {
        separator = sep;
        remainingSeparators = separators.slice(i + 1);
        break;
      }
    }

    // If no separators found or only empty separator, force split at maxChars
    if (separator === undefined || separator === '') {
      return this.forceSplit(text, maxChars, overlapChars);
    }

    // Split by this separator
    const splits = text.split(separator);

    // If splitting didn't help (only 1 part), try next separator
    if (splits.length === 1 && remainingSeparators.length > 0) {
      return this.splitText(text, maxChars, overlapChars, remainingSeparators);
    }

    // Merge small splits and track offsets
    const chunks: Chunk[] = [];
    let currentChunk = '';
    let currentStartOffset = 0;
    let currentOffset = 0;

    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      const splitWithSep = i < splits.length - 1 ? split + separator : split;

      // If adding this split would exceed maxChars
      if (currentChunk.length + splitWithSep.length > maxChars) {
        // Save current chunk if not empty
        if (currentChunk.length > 0) {
          chunks.push({
            text: currentChunk.trim(),
            startOffset: currentStartOffset,
            endOffset: currentOffset,
          });

          // Handle overlap: keep the end of current chunk
          if (overlapChars > 0 && currentChunk.length > overlapChars) {
            const overlapText = currentChunk.slice(-overlapChars);
            currentChunk = overlapText + splitWithSep;
            currentStartOffset = currentOffset - overlapChars;
          } else {
            currentChunk = splitWithSep;
            currentStartOffset = currentOffset;
          }
        } else {
          currentChunk = splitWithSep;
          currentStartOffset = currentOffset;
        }

        // If this single split is still too large, recurse with finer separators
        if (splitWithSep.length > maxChars) {
          if (remainingSeparators.length > 0) {
            const subChunks = this.splitText(
              splitWithSep,
              maxChars,
              overlapChars,
              remainingSeparators
            );

            // Adjust offsets for sub-chunks
            for (const subChunk of subChunks) {
              chunks.push({
                text: subChunk.text,
                startOffset: currentOffset + subChunk.startOffset,
                endOffset: currentOffset + subChunk.endOffset,
              });
            }
          } else {
            // No more separators - force split this piece
            const subChunks = this.forceSplit(splitWithSep, maxChars, overlapChars);
            for (const subChunk of subChunks) {
              chunks.push({
                text: subChunk.text,
                startOffset: currentOffset + subChunk.startOffset,
                endOffset: currentOffset + subChunk.endOffset,
              });
            }
          }

          currentChunk = '';
          currentStartOffset = currentOffset + splitWithSep.length;
        }
      } else {
        // Add to current chunk
        currentChunk += splitWithSep;
      }

      currentOffset += splitWithSep.length;
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        startOffset: currentStartOffset,
        endOffset: currentOffset,
      });
    }

    return chunks;
  }

  /**
   * Force split at character boundaries when no separator works
   */
  private forceSplit(
    text: string,
    maxChars: number,
    overlapChars: number
  ): Chunk[] {
    const chunks: Chunk[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + maxChars, text.length);
      const chunkText = text.slice(start, end);

      if (chunkText.trim().length > 0) {
        chunks.push({
          text: chunkText.trim(),
          startOffset: start,
          endOffset: end,
        });
      }

      // Calculate next start position with overlap
      const nextStart = end - overlapChars;

      // Ensure we always make forward progress
      // (nextStart must be greater than current start)
      if (nextStart <= start) {
        start = end;
      } else {
        start = nextStart;
      }

      // If we've reached the end, stop
      if (end >= text.length) {
        break;
      }
    }

    return chunks;
  }
}
