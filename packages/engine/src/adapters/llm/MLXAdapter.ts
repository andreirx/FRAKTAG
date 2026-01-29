import { ILLMAdapter } from './ILLMAdapter.js';
import { substituteTemplate } from '../../prompts/default.js';
import { Semaphore } from '../../utils/Semaphore.js';

// Minimal interface for OpenAI-compatible response
interface OpenAIResponse {
    choices: Array<{
        message?: { content: string };
        delta?: { content: string };
    }>;
}

export interface MLXConfig {
    endpoint?: string;
    model: string;
    timeoutMs?: number;
    concurrency?: number;
}

export class MLXAdapter implements ILLMAdapter {
    private endpoint: string;
    private model: string;
    private timeoutMs: number;
    private semaphore: Semaphore;

    constructor(config: MLXConfig) {
        this.endpoint = config.endpoint || 'http://localhost:11434/v1';
        this.model = config.model;
        this.timeoutMs = config.timeoutMs || 600000;
        this.semaphore = new Semaphore(config.concurrency || 1);
    }

    async complete(
        prompt: string,
        variables: Record<string, string | number | string[]> = {},
        options?: { maxTokens?: number }
    ): Promise<string> {
        return this.semaphore.run(() => this._performRequest(prompt, variables, false, options));
    }

    async stream(
        prompt: string,
        variables: Record<string, string | number | string[]> = {},
        onChunk: (chunk: string) => void,
        options?: { maxTokens?: number }
    ): Promise<string> {
        return this.semaphore.run(() => this._performRequest(prompt, variables, true, options, onChunk));
    }

    private async _performRequest(
        prompt: string,
        variables: Record<string, string | number | string[]>,
        stream: boolean,
        options?: { maxTokens?: number },
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const processedVars: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(variables)) {
            processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
        }

        const finalPrompt = substituteTemplate(prompt, processedVars);

        const body: any = {
            model: this.model,
            messages: [{ role: 'user', content: finalPrompt }],
            stream: stream,
            temperature: 0.1,
        };

        if (options?.maxTokens) {
            body.max_tokens = options.maxTokens;
        }

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeoutMs);

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

            if (!stream) {
                // FIX: Type Casting to handle 'unknown' return type
                const json = (await response.json()) as OpenAIResponse;
                const content = json.choices[0]?.message?.content || '';
                return this.cleanOutput(content);
            }

            if (!response.body) throw new Error('No response body');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let done = false;

            // Use process.stdout only if available (Node environment)
            const canLog = typeof process !== 'undefined' && process.stdout;
            if (canLog) process.stdout.write('   ⏳ MLX Generating: ');

            while (!done) {
                const { value, done: doneReading } = await reader.read();
                done = doneReading;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') continue;
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(trimmed.slice(6));
                                const content = json.choices[0]?.delta?.content || '';
                                if (content) {
                                    fullText += content;
                                    if (canLog) process.stdout.write('.');
                                    if (onChunk) onChunk(content);
                                }
                            } catch (e) { }
                        }
                    }
                }
            }

            if (canLog) process.stdout.write('\n');
            return this.cleanOutput(fullText);

        } catch (error: any) {
            if (error.name === 'AbortError') throw new Error(`MLX Request timed out after ${this.timeoutMs}ms`);
            throw error;
        } finally {
            clearTimeout(id);
        }
    }

    private cleanOutput(text: string): string {
        let clean = text.trim();
        clean = clean.replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
        const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) clean = jsonMatch[1];
        else clean = clean.replace(/```/g, '');
        return clean.trim();
    }

    async testConnection(): Promise<boolean> {
        try {
            const res = await fetch(`${this.endpoint}/models`);
            return res.ok;
        } catch { return false; }
    }
}
