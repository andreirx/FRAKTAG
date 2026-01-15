import { IEmbeddingAdapter } from './IEmbeddingAdapter.js';

interface OllamaEmbeddingResponse {
    embedding: number[];
}

export class OllamaEmbeddingAdapter implements IEmbeddingAdapter {
    constructor(
        private endpoint: string = 'http://localhost:11434',
        private model: string = 'nomic-embed-text'
    ) {}

    async embed(text: string): Promise<number[]> {
        try {
            const response = await fetch(`${this.endpoint}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: this.model, prompt: text }),
            });

            if (!response.ok) throw new Error(`Ollama embedding error: ${response.statusText}`);

            // FIX: Cast the response to the interface to satisfy TypeScript
            const data = (await response.json()) as OllamaEmbeddingResponse;
            return data.embedding;
        } catch (e) {
            console.error("Embedding failed", e);
            return []; // Return empty vector on failure to avoid crashing flow
        }
    }
}
