import { IStorage } from '../adapters/storage/IStorage.js';
import { IEmbeddingAdapter } from '../adapters/embeddings/IEmbeddingAdapter.js';

interface VectorEntry {
    id: string;
    vector: number[];
    textPreview: string;
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

    async add(id: string, text: string): Promise<void> {
        // Basic dedupe check to avoid re-embedding same ID
        const existingIndex = this.index.findIndex(e => e.id === id);
        if (existingIndex >= 0) return; // Already indexed

        const vector = await this.embedder.embed(text);
        if (vector.length === 0) return; // Embedding failed

        this.index.push({
            id,
            vector,
            textPreview: text.slice(0, 100).replace(/\n/g, ' ')
        });
        this.dirty = true;
    }

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
