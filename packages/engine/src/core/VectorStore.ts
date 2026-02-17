import { IStorage } from '../adapters/storage/IStorage.js';
import { IEmbeddingAdapter } from '../adapters/embeddings/IEmbeddingAdapter.js';
import type { Chunk } from '../adapters/chunking/IChunkingStrategy.js';

/**
 * Vector entry stored in the index
 *
 * Supports both legacy (single embedding per node) and multi-chunk modes:
 * - Legacy: id = nodeId, nodeId undefined
 * - Multi-chunk: id = `${nodeId}:chunk:${index}`, nodeId = parent node
 */
interface VectorEntry {
    id: string;              // chunkId or nodeId (legacy)
    vector: number[];
    textPreview: string;
    // Multi-chunk metadata (optional for backward compatibility)
    nodeId?: string;         // Parent node ID
    chunkIndex?: number;     // 0-based index within node
    totalChunks?: number;    // Total chunks for this node
    startOffset?: number;    // Position in original content
    endOffset?: number;
}

/**
 * Search result with node-level aggregation
 */
export interface VectorSearchResult {
    nodeId: string;
    score: number;
    /** Number of chunks that matched for this node */
    matchedChunks: number;
    /** Best matching chunk's text preview */
    bestChunkPreview?: string;
}

export class VectorStore {
    private index: VectorEntry[] = [];
    private dirty = false;

    constructor(
        private storage: IStorage,
        private embedder: IEmbeddingAdapter
    ) {}

    async load(treeId: string): Promise<void> {
        // Ensure indexes directory exists
        await this.storage.ensureDir('indexes');
        const data = await this.storage.read<VectorEntry[]>(`indexes/${treeId}.vectors.json`);
        this.index = data || [];
    }

    async save(treeId: string): Promise<void> {
        if (!this.dirty) return;
        await this.storage.ensureDir('indexes');
        await this.storage.write(`indexes/${treeId}.vectors.json`, this.index);
        this.dirty = false;
    }

    /**
     * Add a single embedding for a node (legacy mode)
     *
     * For multi-chunk support, use addChunks() instead.
     */
    async add(id: string, text: string): Promise<void> {
        // Basic dedupe check to avoid re-embedding same ID
        const existingIndex = this.index.findIndex(e => e.id === id);
        if (existingIndex >= 0) {
            // If text changed significantly, we might want to update, but for now we assume ID uniqueness
            // To force update, call remove() first
            return;
        }

        // SAFETY TRUNCATION: Prevent OOM/Crash on huge texts (e.g. 13k chars)
        // 8192 chars is approx 2048 tokens, a safe limit for most local embedding models
        // the "semantic fingerprint" of a document is almost always established in the first 2,000 words (8k chars)
        const safeText = text.length > 8192 ? text.slice(0, 8192) : text;

        const vector = await this.embedder.embed(safeText);
        if (vector.length === 0) return; // Embedding failed

        this.index.push({
            id,
            vector,
            textPreview: text.slice(0, 100).replace(/\n/g, ' '),
            // Legacy mode: single chunk
            nodeId: id,
            chunkIndex: 0,
            totalChunks: 1,
        });
        this.dirty = true;
    }

    /**
     * Add multiple embedding chunks for a node
     *
     * Each chunk gets its own embedding, enabling better retrieval coverage
     * for long documents. Chunks are identified by `{nodeId}:chunk:{index}`.
     *
     * @param nodeId - The parent tree node ID
     * @param chunks - Array of text chunks with offset information
     * @returns Number of chunks successfully indexed
     */
    async addChunks(nodeId: string, chunks: Chunk[]): Promise<number> {
        if (chunks.length === 0) return 0;

        // Remove any existing chunks for this node first
        await this.removeByNodeId(nodeId);

        let indexed = 0;
        const totalChunks = chunks.length;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkId = `${nodeId}:chunk:${i}`;

            // Embed the chunk
            const vector = await this.embedder.embed(chunk.text);
            if (vector.length === 0) continue; // Skip failed embeddings

            this.index.push({
                id: chunkId,
                vector,
                textPreview: chunk.text.slice(0, 100).replace(/\n/g, ' '),
                nodeId,
                chunkIndex: i,
                totalChunks,
                startOffset: chunk.startOffset,
                endOffset: chunk.endOffset,
            });
            indexed++;
        }

        if (indexed > 0) {
            this.dirty = true;
        }
        return indexed;
    }

    /**
     * Get all chunk IDs for a node
     */
    getChunkIds(nodeId: string): string[] {
        return this.index
            .filter(e => e.nodeId === nodeId || e.id === nodeId)
            .map(e => e.id);
    }

    /**
     * Check if a node has multi-chunk embeddings
     */
    hasMultipleChunks(nodeId: string): boolean {
        const entries = this.index.filter(e => e.nodeId === nodeId);
        return entries.length > 1 || (entries.length === 1 && (entries[0].totalChunks ?? 1) > 1);
    }

    /**
     * Search for similar nodes (legacy API returning chunk/node IDs)
     *
     * For multi-chunk aware search with node aggregation, use searchNodes().
     */
    async search(queryText: string, topK: number = 5): Promise<{ id: string; score: number }[]> {
        const queryVector = await this.embedder.embed(queryText);
        if (queryVector.length === 0) return [];

        const results = this.index.map(entry => ({
            id: entry.id,
            score: this.cosineSimilarity(queryVector, entry.vector)
        }));

        // Sort descending (higher score = closer)
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    /**
     * Search with node-level aggregation
     *
     * When multiple chunks from the same node match, aggregates their scores
     * using max score (best chunk wins) and returns deduplicated node IDs.
     *
     * @param queryText - The search query
     * @param topK - Maximum number of nodes to return
     * @returns Array of node results with aggregated scores
     */
    async searchNodes(queryText: string, topK: number = 5): Promise<VectorSearchResult[]> {
        const queryVector = await this.embedder.embed(queryText);
        if (queryVector.length === 0) return [];

        // Score all entries
        const entryScores = this.index.map(entry => ({
            entry,
            score: this.cosineSimilarity(queryVector, entry.vector)
        }));

        // Aggregate by nodeId (using max score)
        const nodeScores = new Map<string, {
            maxScore: number;
            matchedChunks: number;
            bestPreview: string;
        }>();

        for (const { entry, score } of entryScores) {
            // Resolve nodeId (for legacy entries, nodeId might be undefined)
            const nodeId = entry.nodeId ?? entry.id;

            const existing = nodeScores.get(nodeId);
            if (!existing) {
                nodeScores.set(nodeId, {
                    maxScore: score,
                    matchedChunks: 1,
                    bestPreview: entry.textPreview,
                });
            } else {
                existing.matchedChunks++;
                if (score > existing.maxScore) {
                    existing.maxScore = score;
                    existing.bestPreview = entry.textPreview;
                }
            }
        }

        // Convert to array and sort
        const results: VectorSearchResult[] = [];
        for (const [nodeId, data] of nodeScores) {
            results.push({
                nodeId,
                score: data.maxScore,
                matchedChunks: data.matchedChunks,
                bestChunkPreview: data.bestPreview,
            });
        }

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    /**
     * Remove a single entry by exact ID
     */
    async remove(id: string): Promise<void> {
        const initialLength = this.index.length;
        this.index = this.index.filter(e => e.id !== id);

        if (this.index.length !== initialLength) {
            this.dirty = true;
        }
    }

    /**
     * Remove all chunks for a node
     *
     * Handles both legacy (single entry with id=nodeId) and
     * multi-chunk (entries with nodeId field) modes.
     */
    async removeByNodeId(nodeId: string): Promise<number> {
        const initialLength = this.index.length;

        // Remove entries where:
        // 1. id exactly matches nodeId (legacy single-entry mode)
        // 2. nodeId field matches (multi-chunk mode)
        // 3. id starts with `${nodeId}:chunk:` (chunk ID pattern)
        this.index = this.index.filter(e =>
            e.id !== nodeId &&
            e.nodeId !== nodeId &&
            !e.id.startsWith(`${nodeId}:chunk:`)
        );

        const removed = initialLength - this.index.length;
        if (removed > 0) {
            this.dirty = true;
        }
        return removed;
    }

    /**
     * Delete the vector index for a specific tree
     */
    async deleteIndex(treeId: string): Promise<void> {
        this.index = [];
        this.dirty = false;
        const path = `indexes/${treeId}.vectors.json`;
        if (await this.storage.exists(path)) {
            await this.storage.delete(path);
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        // Safety check for dimension mismatch
        if (vecA.length !== vecB.length) return 0;

        let dot = 0.0, normA = 0.0, normB = 0.0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
