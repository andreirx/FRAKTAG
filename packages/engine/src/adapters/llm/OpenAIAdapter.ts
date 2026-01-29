// packages/engine/src/adapters/llm/OpenAIAdapter.ts

import { BaseLLMAdapter, LLMRequestOptions } from './BaseLLMAdapter.js';

export interface OpenAIConfig {
    apiKey: string;
    model: string;
    endpoint?: string;
    maxRetries?: number;
    timeoutMs?: number;
    concurrency?: number;
}

export class OpenAIAdapter extends BaseLLMAdapter {
    private apiKey: string;
    private model: string;
    private endpoint: string;
    private maxRetries: number;
    private timeoutMs: number;

    constructor(config: OpenAIConfig) {
        super(config.concurrency || 1, config.model, 'openai');
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.endpoint = config.endpoint || 'https://api.openai.com/v1';
        this.maxRetries = config.maxRetries ?? 3;
        // Dynamic timeout: reasoning models (GPT-5, O-series) need more time
        const isReasoning = this.model.includes('gpt-5') || this.model.includes('o1') || this.model.includes('o3');
        this.timeoutMs = config.timeoutMs ?? (isReasoning ? 120_000 : 30_000);
    }

    // ============ TRANSPORT ============

    protected async performComplete(
        finalPrompt: string,
        options?: LLMRequestOptions
    ): Promise<string> {
        const body = this.buildRequestBody(finalPrompt, true, options);

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    const backoff = Math.pow(2, attempt) * 1000;
                    this.log(`   ⚠️  Retry ${attempt}/${this.maxRetries} in ${backoff}ms...`);
                    await new Promise(r => setTimeout(r, backoff));
                }

                this.log(`🚀 LLM CALL [${this.model}] (Attempt ${attempt})`);
                return await this.performStreamedRequest(body);

            } catch (error: any) {
                lastError = error;
                const isFatal = error.message.includes('401') || error.message.includes('invalid_api_key');
                if (isFatal) throw error;
                this.log(`   ❌ Error (Attempt ${attempt}): ${error.message}`);
            }
        }

        throw lastError || new Error('Failed after max retries');
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
            const response = await fetch(`${this.endpoint}/models`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            return response.ok;
        } catch { return false; }
    }

    // ============ INTERNALS ============

    private buildRequestBody(
        finalPrompt: string,
        stream: boolean,
        options?: LLMRequestOptions
    ): any {
        const isGPT5 = this.model.includes('gpt-5') || this.model.includes('o3') || this.model.includes('o4');

        const body: any = {
            model: this.model,
            messages: [{ role: 'user', content: finalPrompt }],
            stream,
        };

        if (!isGPT5) {
            body.temperature = options?.expectsJSON ? 0.1 : 0.3;
        }

        if (options?.maxTokens && options.maxTokens > 0) {
            body.max_completion_tokens = options.maxTokens;
        }

        if (options?.expectsJSON && !this.model.includes('nano')) {
            body.response_format = { type: 'json_object' };
        }

        return body;
    }

    /**
     * Execute a streaming request and collect the full response.
     * If onChunk is provided, call it for each content delta (used by stream()).
     */
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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            clearTimeout(id);

            if (!response.ok) {
                const err = await response.text();
                if (response.status === 429) throw new Error(`Rate Limited (429): ${err}`);
                throw new Error(`OpenAI API error (${response.status}): ${err}`);
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
