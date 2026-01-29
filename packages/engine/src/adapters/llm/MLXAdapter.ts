// packages/engine/src/adapters/llm/MLXAdapter.ts
// OpenAI-compatible adapter for MLX LM Server (Apple Silicon local inference).

import { BaseLLMAdapter, LLMRequestOptions } from './BaseLLMAdapter.js';

export interface MLXConfig {
    endpoint?: string;
    model: string;
    timeoutMs?: number;
    concurrency?: number;
}

export class MLXAdapter extends BaseLLMAdapter {
    private endpoint: string;
    private model: string;
    private timeoutMs: number;

    constructor(config: MLXConfig) {
        super(config.concurrency || 1, config.model, 'mlx');
        this.endpoint = config.endpoint || 'http://localhost:11434/v1';
        this.model = config.model;
        this.timeoutMs = config.timeoutMs || 600000; // 10 minutes
    }

    // ============ TRANSPORT ============

    protected async performComplete(
        finalPrompt: string,
        options?: LLMRequestOptions
    ): Promise<string> {
        const body = this.buildRequestBody(finalPrompt, true, options);
        this.log(`🚀 LLM CALL [${this.model}]`);
        return this.performStreamedRequest(body);
    }

    protected async performStream(
        finalPrompt: string,
        onChunk: (chunk: string) => void,
        options?: LLMRequestOptions
    ): Promise<string> {
        const body = this.buildRequestBody(finalPrompt, true, options);
        this.log(`🚀 LLM STREAM [${this.model}]`);
        return this.performStreamedRequest(body, onChunk);
    }

    async testConnection(): Promise<boolean> {
        try {
            const res = await fetch(`${this.endpoint}/models`);
            return res.ok;
        } catch { return false; }
    }

    // ============ INTERNALS ============

    private buildRequestBody(
        finalPrompt: string,
        stream: boolean,
        options?: LLMRequestOptions
    ): any {
        const body: any = {
            model: this.model,
            messages: [{ role: 'user', content: finalPrompt }],
            stream,
            temperature: options?.expectsJSON ? 0.1 : 0.3,
        };

        if (options?.maxTokens && options.maxTokens > 0) {
            body.max_tokens = options.maxTokens;
        }

        return body;
    }

    private async performStreamedRequest(
        body: any,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeoutMs);
        const progress = this.startStreamProgress();

        try {
            const response = await fetch(`${this.endpoint}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            clearTimeout(id);

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`MLX API error (${response.status}): ${err}`);
            }

            return await this.readSSEResponse(response, progress, onChunk);

        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error(`Request timed out after ${this.timeoutMs}ms`);
            }
            throw error;
        } finally {
            clearTimeout(id);
        }
    }
}
