/**
 * Document Structure Chunker
 *
 * Splits text based on document structure markers:
 * - Markdown headers (# H1, ## H2, etc.)
 * - PDF page boundaries (---=== PAGE N ===---)
 * - Horizontal rules (---)
 * - Table of contents anchors
 *
 * This strategy is optimized for TREE NODE creation (human navigation),
 * not for embedding retrieval. It preserves semantic boundaries that
 * make sense for hierarchical organization.
 *
 * For embedding strategies, use RecursiveCharacterChunker instead.
 */

import {
  type IChunkingStrategy,
  type Chunk,
  type ChunkingOptions,
  estimateTokens as defaultEstimateTokens,
} from './IChunkingStrategy.js';

/**
 * Options specific to document structure chunking
 */
export interface DocumentStructureOptions extends ChunkingOptions {
  /** Minimum header level to split on (1 = H1, 2 = H2, etc.) Default: 2 */
  minHeaderLevel?: number;

  /** Maximum sections to produce (prevents over-splitting) Default: 50 */
  maxSections?: number;

  /** Whether to include PDF page markers as split points. Default: true */
  splitOnPages?: boolean;

  /** Whether to include horizontal rules as split points. Default: true */
  splitOnHorizontalRules?: boolean;

  /** Minimum section size in characters. Default: 500 */
  minSectionChars?: number;
}

interface SplitCandidate {
  title: string;
  text: string;
  startOffset: number;
  endOffset: number;
  type: 'header' | 'page' | 'hr' | 'toc';
  level?: number;
}

export class DocumentStructureChunker implements IChunkingStrategy {
  readonly name = 'document-structure';

  async chunk(text: string, options?: DocumentStructureOptions): Promise<Chunk[]> {
    const opts = {
      minHeaderLevel: options?.minHeaderLevel ?? 2,
      maxSections: options?.maxSections ?? 50,
      splitOnPages: options?.splitOnPages ?? true,
      splitOnHorizontalRules: options?.splitOnHorizontalRules ?? true,
      minSectionChars: options?.minSectionChars ?? 500,
    };

    // Try different splitting strategies in order of preference
    let candidates: SplitCandidate[] = [];

    // 1. Try PDF page markers first
    if (opts.splitOnPages) {
      candidates = this.splitByPageMarkers(text);
      if (candidates.length >= 2) {
        return this.candidatesToChunks(candidates, opts);
      }
    }

    // 2. Try markdown headers
    candidates = this.splitByHeaders(text, opts.minHeaderLevel);
    if (candidates.length >= 2) {
      return this.candidatesToChunks(candidates, opts);
    }

    // 3. Try horizontal rules
    if (opts.splitOnHorizontalRules) {
      candidates = this.splitByHorizontalRules(text);
      if (candidates.length >= 2) {
        return this.candidatesToChunks(candidates, opts);
      }
    }

    // 4. No structure found - return as single chunk
    return [
      {
        text: text.trim(),
        startOffset: 0,
        endOffset: text.length,
        metadata: { type: 'unsplit' },
      },
    ];
  }

  estimateTokens(text: string): number {
    return defaultEstimateTokens(text);
  }

  /**
   * Split by PDF page markers: ---=== PAGE N ===---
   */
  private splitByPageMarkers(text: string): SplitCandidate[] {
    const pagePattern = /---===\s*PAGE\s*(\d+)\s*===---/gi;
    const candidates: SplitCandidate[] = [];

    let lastEnd = 0;
    let match: RegExpExecArray | null;

    while ((match = pagePattern.exec(text)) !== null) {
      // Content before this marker
      if (match.index > lastEnd) {
        const content = text.slice(lastEnd, match.index);
        if (content.trim().length > 0) {
          candidates.push({
            title: `Page ${candidates.length + 1}`,
            text: content.trim(),
            startOffset: lastEnd,
            endOffset: match.index,
            type: 'page',
          });
        }
      }
      lastEnd = match.index + match[0].length;
    }

    // Content after last marker
    if (lastEnd < text.length) {
      const content = text.slice(lastEnd);
      if (content.trim().length > 0) {
        candidates.push({
          title: `Page ${candidates.length + 1}`,
          text: content.trim(),
          startOffset: lastEnd,
          endOffset: text.length,
          type: 'page',
        });
      }
    }

    return candidates;
  }

  /**
   * Split by markdown headers (# H1, ## H2, etc.)
   */
  private splitByHeaders(text: string, minLevel: number): SplitCandidate[] {
    // Match headers at beginning of line: # Title or ## Title
    const headerPattern = new RegExp(`^(#{1,${minLevel}})\\s+(.+)$`, 'gm');
    const candidates: SplitCandidate[] = [];

    const matches: Array<{ index: number; level: number; title: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = headerPattern.exec(text)) !== null) {
      matches.push({
        index: match.index,
        level: match[1].length,
        title: match[2].trim(),
      });
    }

    // Build sections from header positions
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextIndex = i < matches.length - 1 ? matches[i + 1].index : text.length;
      const sectionText = text.slice(current.index, nextIndex);

      candidates.push({
        title: current.title,
        text: sectionText.trim(),
        startOffset: current.index,
        endOffset: nextIndex,
        type: 'header',
        level: current.level,
      });
    }

    // If there's content before the first header, include it
    if (matches.length > 0 && matches[0].index > 0) {
      const preContent = text.slice(0, matches[0].index).trim();
      if (preContent.length > 0) {
        candidates.unshift({
          title: 'Introduction',
          text: preContent,
          startOffset: 0,
          endOffset: matches[0].index,
          type: 'header',
        });
      }
    }

    return candidates;
  }

  /**
   * Split by horizontal rules (--- or ***)
   */
  private splitByHorizontalRules(text: string): SplitCandidate[] {
    const hrPattern = /^[-*_]{3,}\s*$/gm;
    const candidates: SplitCandidate[] = [];

    let lastEnd = 0;
    let match: RegExpExecArray | null;
    let sectionNum = 1;

    while ((match = hrPattern.exec(text)) !== null) {
      if (match.index > lastEnd) {
        const content = text.slice(lastEnd, match.index);
        if (content.trim().length > 0) {
          candidates.push({
            title: `Section ${sectionNum++}`,
            text: content.trim(),
            startOffset: lastEnd,
            endOffset: match.index,
            type: 'hr',
          });
        }
      }
      lastEnd = match.index + match[0].length;
    }

    // Content after last HR
    if (lastEnd < text.length) {
      const content = text.slice(lastEnd);
      if (content.trim().length > 0) {
        candidates.push({
          title: `Section ${sectionNum}`,
          text: content.trim(),
          startOffset: lastEnd,
          endOffset: text.length,
          type: 'hr',
        });
      }
    }

    return candidates;
  }

  /**
   * Convert candidates to Chunks, applying size filters
   */
  private candidatesToChunks(
    candidates: SplitCandidate[],
    opts: { maxSections: number; minSectionChars: number }
  ): Chunk[] {
    // Filter by minimum size and cap at max sections
    const filtered = candidates
      .filter((c) => c.text.length >= opts.minSectionChars)
      .slice(0, opts.maxSections);

    return filtered.map((c) => ({
      text: c.text,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      metadata: {
        title: c.title,
        type: c.type,
        level: c.level,
      },
    }));
  }
}
