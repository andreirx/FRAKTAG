import { IEmbeddingAdapter } from './IEmbeddingAdapter.js';

interface OpenAIEmbeddingResponse {
    data: Array<{ embedding: number[] }>;
}

export class OpenAIEmbeddingAdapter implements IEmbeddingAdapter {
    private endpoint: string;

    constructor(
        private apiKey: string,
        private model: string = 'text-embedding-3-small',
        endpoint?: string // Add endpoint parameter
    ) {
        // Default to real OpenAI if no endpoint provided
        this.endpoint = endpoint || 'https://api.openai.com/v1';
    }

    async embed(text: string): Promise<number[]> {
        try {
            // Use the dynamic endpoint
            // Ensure endpoint doesn't end with / if we append /embeddings,
            // but usually config has /v1. Let's handle standard OpenAI pathing.
            // If endpoint is "http://localhost:11434/v1", append "/embeddings"

            const url = this.endpoint.endsWith('/embeddings')
                ? this.endpoint
                : `${this.endpoint.replace(/\/$/, '')}/embeddings`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    input: text,
                    dimensions: this.model === 'text-embedding-3-small' ? 1536 : undefined
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
