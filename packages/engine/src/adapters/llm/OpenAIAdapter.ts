// packages/engine/src/adapters/llm/OpenAIAdapter.ts

import { ILLMAdapter } from './ILLMAdapter.js';
import { substituteTemplate } from '../../prompts/default.js';
import { Semaphore } from '../../utils/Semaphore.js';

export interface OpenAIConfig {
    apiKey: string;
    model: string;
    endpoint?: string;
    maxRetries?: number;
    timeoutMs?: number;
    concurrency?: number;
}

export class OpenAIAdapter implements ILLMAdapter {
    private apiKey: string;
    private model: string;
    private endpoint: string;
    private maxRetries: number;
    private timeoutMs: number;
    private semaphore: Semaphore;

    constructor(config: OpenAIConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.endpoint = config.endpoint || 'https://api.openai.com/v1';
        this.maxRetries = config.maxRetries ?? 3;
        // FIX 1: Dynamic Timeout based on model class
        // GPT-5/O-Series need way more time to think.
        const isReasoning = this.model.includes('gpt-5') || this.model.includes('o1') || this.model.includes('o3');
        this.timeoutMs = config.timeoutMs ?? (isReasoning ? 120_000 : 30_000); // 2 minutes for experts
        // Default 10 for OpenAI (cloud can handle it), user can tune
        this.semaphore = new Semaphore(config.concurrency || 10);
    }

    private log(msg: string, data?: any) {
        const ts = new Date().toISOString().split('T')[1].slice(0, -1);
        if (data) console.log(`[${ts}] ${msg}`, data);
        else console.log(`[${ts}] ${msg}`);
    }

    async complete(
        prompt: string,
        variables: Record<string, string | number | string[]>,
        options?: { maxTokens?: number }
    ): Promise<string> {
        return this.semaphore.run(() => this._complete(prompt, variables, options));
    }

    private async _complete(
        prompt: string,
        variables: Record<string, string | number | string[]>,
        options?: { maxTokens?: number }
    ): Promise<string> {
        const processedVars: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(variables)) {
            processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
        }

        const finalPrompt = substituteTemplate(prompt, processedVars);
        const estTokens = Math.ceil(finalPrompt.length / 4);

        // Config logic
        const expectsJSON = prompt.includes('Respond ONLY with JSON');
        const isSplitRequest = prompt.includes('Split this content');
        const isGPT5 = this.model.includes('gpt-5') || this.model.includes('o3') || this.model.includes('o4');

//        process.stdout.write(`\n==== DEBUG REQUEST ====${finalPrompt}`);
        process.stdout.write('\n');

        const body: any = {
            model: this.model,
            messages: [{ role: 'user', content: finalPrompt }],
            stream: true,
        };

        if (!isGPT5) {
            body.temperature = expectsJSON ? 0.1 : 0.3;
        }

        if (options?.maxTokens && options.maxTokens > 0) {
            body.max_completion_tokens = options.maxTokens;
        }

        if (expectsJSON && !this.model.includes('nano')) {
            body.response_format = { type: "json_object" };
        }

        // --- RETRY LOOP ---
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    const backoff = Math.pow(2, attempt) * 1000;
                    this.log(`   ⚠️  Retry ${attempt}/${this.maxRetries} in ${backoff}ms...`);
                    await new Promise(r => setTimeout(r, backoff));
                }

                this.log(`🚀 LLM CALL [${this.model}] (Attempt ${attempt})`);

                const result = await this.performRequest(body);

                // Validate Result
                if (!result || result.trim().length === 0) {
                    throw new Error("Received empty response from API");
                }

                if (expectsJSON) {
                    return this.extractJSON(result);
                }
                return this.cleanOutput(result);

            } catch (error: any) {
                lastError = error;
                const isFatal = error.message.includes('401') || error.message.includes('invalid_api_key');
                if (isFatal) throw error;
                this.log(`   ❌ Error (Attempt ${attempt}): ${error.message}`);
            }
        }

        throw lastError || new Error("Failed after max retries");
    }

    private async performRequest(body: any): Promise<string> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeoutMs);
        const start = Date.now();

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

            clearTimeout(id); // Clear initial timeout, we have headers

            if (!response.ok) {
                const err = await response.text();
                if (response.status === 429) throw new Error(`Rate Limited (429): ${err}`);
                throw new Error(`OpenAI API error (${response.status}): ${err}`);
            }
            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';
            let firstTokenReceived = false;

            process.stdout.write('   ⏳ Generating: ');

            while (true) {
                const { value, done } = await reader.read();
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = done ? '' : lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') continue;
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(trimmed.slice(6));
                                const delta = json.choices[0]?.delta;

                                // FIX 2: Handle Reasoning Content (The "Thinking" phase)
                                // Some models emit this before 'content'
                                if (delta?.reasoning_content) {
                                    if (!firstTokenReceived) {
                                        process.stdout.write(' (Thinking) ');
                                        firstTokenReceived = true;
                                    }
                                    // Optionally log reasoning dots
                                    if (Math.random() > 0.9) process.stdout.write('°');
                                }

                                // Handle Actual Content
                                const content = delta?.content || '';
                                if (content) {
                                    if (!firstTokenReceived) {
                                        const latency = Date.now() - start;
                                        // Clear thinking indicator if present
                                        process.stdout.write(` [TTFT: ${latency}ms] `);
                                        firstTokenReceived = true;
                                    }
                                    fullText += content;
                                    if (Math.random() > 0.8) process.stdout.write('.');
                                }
                            } catch (e) { }
                        }
                    }
                }
                if (done) break;
            }

            // ... (keep buffer flush logic) ...
            if (buffer.trim()) {
                const trimmed = buffer.trim();
                if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        fullText += json.choices[0]?.delta?.content || '';
                    } catch (e) {}
                }
            }

            process.stdout.write('\n');
            this.log(`   ✅ Complete. Raw Output Length: ${fullText.length} chars`);
            return fullText;

        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error(`Request timed out after ${this.timeoutMs}ms`);
            }
            throw error;
        } finally {
            clearTimeout(id);
        }
    }

    private cleanOutput(text: string): string {
        let clean = text.trim();
        // Remove XML Thinking tags (DeepSeek style)
        clean = clean.replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
        // Remove Markdown Code Fences
        clean = clean.replace(/```(?:json)?/g, '').replace(/```/g, '');
        return clean.trim();
    }

    private extractJSON(text: string): string {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end >= start) {
            return text.slice(start, end + 1);
        }
        return text.trim();
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

    /**
     * Stream a completion, calling onChunk for each piece of text received
     */
    async stream(
        prompt: string,
        variables: Record<string, string | number | string[]>,
        onChunk: (chunk: string) => void,
        options?: { maxTokens?: number }
    ): Promise<string> {
        return this.semaphore.run(() => this._stream(prompt, variables, onChunk, options));
    }

    private async _stream(
        prompt: string,
        variables: Record<string, string | number | string[]>,
        onChunk: (chunk: string) => void,
        options?: { maxTokens?: number }
    ): Promise<string> {
        const processedVars: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(variables)) {
            processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
        }

        const finalPrompt = substituteTemplate(prompt, processedVars);

        const body: any = {
            model: this.model,
            messages: [{ role: 'user', content: finalPrompt }],
            stream: true,
        };

        const isGPT5 = this.model.includes('gpt-5') || this.model.includes('o3') || this.model.includes('o4');
        if (!isGPT5) {
            body.temperature = 0.3;
        }

        if (options?.maxTokens && options.maxTokens > 0) {
            body.max_completion_tokens = options.maxTokens;
        }

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeoutMs);

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
                throw new Error(`OpenAI API error (${response.status}): ${err}`);
            }
            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = done ? '' : lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') continue;
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(trimmed.slice(6));
                                const content = json.choices[0]?.delta?.content || '';
                                if (content) {
                                    fullText += content;
                                    onChunk(content);
                                }
                            } catch (e) { }
                        }
                    }
                }
                if (done) break;
            }

            // Flush remaining buffer
            if (buffer.trim()) {
                const trimmed = buffer.trim();
                if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const content = json.choices[0]?.delta?.content || '';
                        if (content) {
                            fullText += content;
                            onChunk(content);
                        }
                    } catch (e) {}
                }
            }

            return this.cleanOutput(fullText);

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
