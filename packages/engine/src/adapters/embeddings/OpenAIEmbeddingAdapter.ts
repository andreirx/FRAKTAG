import { IEmbeddingAdapter } from './IEmbeddingAdapter.js';

interface OpenAIEmbeddingResponse {
    data: Array<{ embedding: number[] }>;
}

export class OpenAIEmbeddingAdapter implements IEmbeddingAdapter {
    constructor(
        private apiKey: string,
        private model: string = 'text-embedding-3-small'
    ) {}

    async embed(text: string): Promise<number[]> {
        try {
            const response = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    input: text,
                    dimensions: 1536 // Optional, usually automatic
                }),
            });

            if (!response.ok) throw new Error(`OpenAI embedding error: ${response.statusText}`);

            const data = (await response.json()) as OpenAIEmbeddingResponse;
            return data.data[0].embedding;
        } catch (e) {
            console.error("Embedding failed", e);
            return [];
        }
    }
}
