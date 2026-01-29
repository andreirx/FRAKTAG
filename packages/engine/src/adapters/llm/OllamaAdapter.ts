// packages/engine/src/adapters/llm/OllamaAdapter.ts

import { BaseLLMAdapter, LLMRequestOptions } from './BaseLLMAdapter.js';
import { Agent } from 'undici';

export interface OllamaConfig {
  endpoint: string;
  model: string;
  timeoutMs?: number;
  numCtx?: number;
  concurrency?: number;
}

export class OllamaAdapter extends BaseLLMAdapter {
  private endpoint: string;
  private model: string;
  private timeoutMs: number;
  private numCtx: number;

  constructor(config: OllamaConfig) {
    super(config.concurrency || 1, config.model, 'ollama');
    this.endpoint = config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs || 600000; // 10 minutes
    this.numCtx = config.numCtx || 32768;
  }

  // ============ TRANSPORT ============

  protected async performComplete(
    finalPrompt: string,
    options?: LLMRequestOptions
  ): Promise<string> {
    const isSplitRequest = finalPrompt.includes('Split this content');
    const predictLimit = options?.maxTokens
      ? options.maxTokens
      : (isSplitRequest ? -1 : 4096);

    const body: any = {
      model: this.model,
      prompt: finalPrompt,
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: this.numCtx,
        num_predict: predictLimit
      }
    };

    if (options?.expectsJSON) {
      body.format = 'json';
    }

    this.log(`🚀 LLM CALL [${this.model}]`);
    return this.performOllamaStream(body);
  }

  protected async performStream(
    finalPrompt: string,
    onChunk: (chunk: string) => void,
    options?: LLMRequestOptions
  ): Promise<string> {
    const body: any = {
      model: this.model,
      prompt: finalPrompt,
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: this.numCtx,
        num_predict: options?.maxTokens || 4096
      }
    };

    this.log(`🚀 LLM STREAM [${this.model}]`);
    return this.performOllamaStream(body, onChunk);
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      return res.ok;
    } catch { return false; }
  }

  // ============ INTERNALS ============

  /**
   * Ollama uses NDJSON streaming (not SSE).
   * Each line is a JSON object with { response, done }.
   */
  private async performOllamaStream(
    body: any,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const dispatcher = new Agent({
      headersTimeout: this.timeoutMs,
      connectTimeout: this.timeoutMs,
      bodyTimeout: 0 // Infinite body timeout for streaming
    });

    const progress = this.startStreamProgress();

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // @ts-ignore - dispatcher is a Node.js specific extension to fetch
        dispatcher,
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.response) {
                fullText += json.response;
                progress.onToken();
                if (onChunk) onChunk(json.response);
              }
              if (json.done) done = true;
            } catch (e) { }
          }
        }
      }

      progress.finish(fullText.length);
      return fullText;

    } catch (error) {
      this.log(`   ❌ LLM Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
