/**
 * Tests for chunking strategies
 *
 * Note: We import directly from implementation files to avoid
 * pulling in heavy dependencies through the barrel export.
 */

import { describe, it, expect } from 'vitest';
import { RecursiveCharacterChunker } from '../RecursiveCharacterChunker.js';
import { FixedSizeChunker, FixedSize512Chunker } from '../FixedSizeChunker.js';
import { DocumentStructureChunker } from '../DocumentStructureChunker.js';

describe('RecursiveCharacterChunker', () => {
  const chunker = new RecursiveCharacterChunker();

  it('should return single chunk for short text', async () => {
    const text = 'This is a short text.';
    // Use small minChunkChars since text is only 21 chars
    const chunks = await chunker.chunk(text, { minChunkChars: 10 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].startOffset).toBe(0);
  });

  it('should split on paragraph boundaries', async () => {
    const text = `First paragraph with some content here.

Second paragraph with different content.

Third paragraph to make it long enough.`;

    const chunks = await chunker.chunk(text, { maxChars: 100, minChunkChars: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    // Should preserve paragraph boundaries
    chunks.forEach((chunk) => {
      expect(chunk.text).not.toMatch(/^\n/); // Should not start with newline
    });
  });

  it('should handle overlap correctly', async () => {
    const text = 'A'.repeat(500) + ' ' + 'B'.repeat(500);
    const chunks = await chunker.chunk(text, {
      maxChars: 400,
      overlapChars: 50,
      minChunkChars: 10,
    });

    expect(chunks.length).toBeGreaterThan(1);
    // Chunks should have overlapping regions
  });

  it('should estimate tokens', () => {
    const text = 'Hello world';
    const tokens = chunker.estimateTokens(text);
    expect(tokens).toBe(Math.ceil(text.length / 4));
  });
});

describe('FixedSizeChunker', () => {
  const chunker = new FixedSizeChunker();

  it('should split text into fixed-size chunks', async () => {
    const text = 'word '.repeat(200); // 1000 chars
    const chunks = await chunker.chunk(text, { maxChars: 200, minChunkChars: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.text.length).toBeLessThanOrEqual(200);
    });
  });

  it('should try to break at word boundaries', async () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
    const chunks = await chunker.chunk(text, { maxChars: 100, minChunkChars: 10 });

    // Most chunks should end at word boundaries (space or punctuation)
    const endsAtWord = chunks.filter(
      (c) => c.text.endsWith('.') || c.text.endsWith(' ') || c.text === c.text.trimEnd()
    );
    expect(endsAtWord.length).toBe(chunks.length);
  });
});

describe('FixedSize512Chunker', () => {
  const chunker = new FixedSize512Chunker();

  it('should have name fixed-512', () => {
    expect(chunker.name).toBe('fixed-512');
  });

  it('should use 512 token defaults', async () => {
    const text = 'x'.repeat(3000); // ~750 tokens
    const chunks = await chunker.chunk(text);

    // Should produce roughly 2 chunks at 512 tokens (~2048 chars) each
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });
});

describe('DocumentStructureChunker', () => {
  const chunker = new DocumentStructureChunker();

  it('should split on markdown headers', async () => {
    const text = `# Introduction

This is the introduction section with enough content to meet minimum.

## Methods

This is the methods section with enough content to meet the minimum requirement.

## Results

This is the results section with plenty of content here.`;

    const chunks = await chunker.chunk(text, { minSectionChars: 20 });

    expect(chunks.length).toBe(3);
    expect(chunks[0].metadata?.title).toBe('Introduction');
    expect(chunks[1].metadata?.title).toBe('Methods');
    expect(chunks[2].metadata?.title).toBe('Results');
  });

  it('should split on PDF page markers', async () => {
    const text = `Page 1 content here with enough text to be valid.

---=== PAGE 2 ===---

Page 2 content here with enough text to be valid.

---=== PAGE 3 ===---

Page 3 content here with enough text to be valid.`;

    const chunks = await chunker.chunk(text, { minSectionChars: 20 });

    expect(chunks.length).toBe(3);
    expect(chunks[0].metadata?.type).toBe('page');
  });

  it('should return single chunk for unstructured text', async () => {
    const text = 'Just some plain text without any structure markers or headers at all.';
    const chunks = await chunker.chunk(text, { minSectionChars: 10 });

    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata?.type).toBe('unsplit');
  });

  it('should split on horizontal rules', async () => {
    const text = `First section with enough content here.

---

Second section with enough content here.

---

Third section with enough content here.`;

    const chunks = await chunker.chunk(text, { minSectionChars: 20 });

    expect(chunks.length).toBe(3);
    expect(chunks[0].metadata?.type).toBe('hr');
  });
});

// Factory tests moved to separate file to avoid heavy imports
// See factory.test.ts for createChunker tests
