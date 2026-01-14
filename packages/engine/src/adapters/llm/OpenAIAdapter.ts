// packages/engine/src/adapters/llm/OpenAIAdapter.ts

import { ILLMAdapter } from './ILLMAdapter.js';
import { substituteTemplate } from '../../prompts/default.js';

export interface OpenAIConfig {
    apiKey: string;
    model: string;
    endpoint?: string;
}

export class OpenAIAdapter implements ILLMAdapter {
    private apiKey: string;
    private model: string;
    private endpoint: string;

    constructor(config: OpenAIConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.endpoint = config.endpoint || 'https://api.openai.com/v1';
    }

    private log(msg: string, data?: any) {
        const ts = new Date().toISOString().split('T')[1].slice(0, -1);
        if (data) {
            console.log(`[${ts}] ${msg}`, data);
        } else {
            console.log(`[${ts}] ${msg}`);
        }
    }

    async complete(
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

        this.log(`🚀 LLM CALL [${this.model}]`);
        this.log(`   📝 Input: ~${estTokens} tokens`);

        const expectsJSON = prompt.includes('Respond ONLY with JSON') || prompt.includes('Return a JSON list');
        const isGPT5 = this.model.includes('gpt-5') || this.model.includes('o3') || this.model.includes('o4');

        // Build Body
        const body: any = {
            model: this.model,
            messages: [{ role: 'user', content: finalPrompt }],
            stream: true,
        };

        // GPT-5/O-series constraints: No temperature
        if (!isGPT5) {
            body.temperature = expectsJSON ? 0.1 : 0.3;
        }

        // Dynamic Max Tokens
        if (options?.maxTokens && options.maxTokens > 0) {
            body.max_completion_tokens = options.maxTokens; // New OpenAI API field
        } else if (prompt.includes('Split this content')) {
            body.max_completion_tokens = 16000; // Allow huge output for splits
        } else {
            body.max_completion_tokens = 4096;
        }

        // JSON Mode (If supported)
        if (expectsJSON && !this.model.includes('nano')) {
            // Some nano models might not support json_object, but let's assume standard ones do
            body.response_format = { type: "json_object" };
        }

        try {
            const response = await fetch(`${this.endpoint}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`OpenAI API error (${response.status}): ${err}`);
            }
            if (!response.body) throw new Error('No response body');

            // Streaming Reader
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let done = false;
            let chunkCount = 0;

            process.stdout.write('   ⏳ Generating: ');

            while (!done) {
                const { value, done: doneReading } = await reader.read();
                done = doneReading;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.trim() === '') continue;
                        if (line.trim() === 'data: [DONE]') continue;
                        if (!line.startsWith('data: ')) continue;

                        try {
                            const jsonStr = line.replace('data: ', '');
                            const json = JSON.parse(jsonStr);
                            const content = json.choices[0]?.delta?.content || '';

                            if (content) {
                                fullText += content;
                                chunkCount++;
                                if (chunkCount % 5 === 0) process.stdout.write('.');
                            }
                        } catch (e) { }
                    }
                }
            }
            process.stdout.write('\n');

            this.log(`   ✅ Complete. Raw Output Length: ${fullText.length} chars`);

            if (expectsJSON) {
                return this.extractJSON(fullText);
            }

            return fullText.trim();

        } catch (error) {
            this.log(`   ❌ LLM Error: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
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
}
