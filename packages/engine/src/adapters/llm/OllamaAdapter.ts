import { ILLMAdapter } from './ILLMAdapter.js';
import { substituteTemplate } from '../../prompts/default.js';
import { Semaphore } from '../../utils/Semaphore.js';
// We need to import undici types to satisfy TS, or use any if not installed
import { Agent } from 'undici';

export interface OllamaConfig {
  endpoint: string;
  model: string;
  timeoutMs?: number;
  numCtx?: number;
  concurrency?: number;
}

export class OllamaAdapter implements ILLMAdapter {
  private endpoint: string;
  private model: string;
  private timeoutMs: number;
  private numCtx: number;
  private semaphore: Semaphore;

  constructor(config: OllamaConfig) {
    this.endpoint = config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs || 600000; // Default 10 minutes (up from 5)
    this.numCtx = config.numCtx || 32768;        // Default 32k (down from 128k)
    // Default 1 for Ollama (serial) - user must set OLLAMA_NUM_PARALLEL on their server to match
    this.semaphore = new Semaphore(config.concurrency || 1);
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
      variables: Record<string, string | number | string[]> = {},
      options?: { maxTokens?: number }
  ): Promise<string> {
    return this.semaphore.run(() => this._complete(prompt, variables, options));
  }

  private async _complete(
      prompt: string,
      variables: Record<string, string | number | string[]> = {},
      options?: { maxTokens?: number }
  ): Promise<string> {
    const processedVars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
    }

    const finalPrompt = substituteTemplate(prompt, processedVars);
    const estTokens = Math.ceil(finalPrompt.length / 4);

    // Heuristic: If prompt contains "Split this content", we need more output capacity.
    const isSplitRequest = prompt.includes('Split this content');
    const predictLimit = options?.maxTokens
        ? options.maxTokens
        : (isSplitRequest ? -1 : 4096);

    // Check if we expect JSON (heuristic based on prompt content)
    const expectsJSON = prompt.includes('Respond ONLY with JSON') || prompt.includes('Return a JSON list');

    const body: any = {
      model: this.model,
      prompt: finalPrompt,
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: this.numCtx, // Configurable context
        num_predict: predictLimit
      }
    };

    // ENABLE NATIVE OLLAMA JSON MODE
    if (expectsJSON) {
      body.format = 'json';
    }

    try {
      // Create a custom dispatcher to override the default 300s timeout
      const dispatcher = new Agent({
        headersTimeout: this.timeoutMs,
        connectTimeout: this.timeoutMs,
        bodyTimeout: 0 // Infinite body timeout for streaming
      });

      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // @ts-ignore - dispatcher is a Node.js specific extension to fetch
        dispatcher: dispatcher,
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
      if (!response.body) throw new Error('No response body');

      // Stream Reader
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
          // Ollama sends multiple JSON objects in one chunk sometimes
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.response) {
                fullText += json.response;
                chunkCount++;
                if (chunkCount % 10 === 0) process.stdout.write('.');
              }
              if (json.done) done = true;
            } catch (e) { }
          }
        }
      }
      process.stdout.write('\n');

      this.log(`   ✅ Complete. Raw Output Length: ${fullText.length} chars`);

      const json = this.extractJSON(fullText);
      if (expectsJSON) return json;

      return this.cleanOutput(fullText);

    } catch (error) {
      this.log(`   ❌ LLM Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async stream(
      prompt: string,
      variables: Record<string, string | number | string[]> = {},
      onChunk: (chunk: string) => void,
      options?: { maxTokens?: number }
  ): Promise<string> {
    return this.semaphore.run(() => this._stream(prompt, variables, onChunk, options));
  }

  private async _stream(
      prompt: string,
      variables: Record<string, string | number | string[]> = {},
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
      prompt: finalPrompt,
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: this.numCtx,
        num_predict: options?.maxTokens || 4096
      }
    };

    try {
      // Use custom dispatcher for timeout handling (same as complete)
      // Note: Re-using the dispatcher logic from complete() is best practice
      // ensuring we import Agent/undici correctly as per previous step
      const { Agent } = await import('undici');
      const dispatcher = new Agent({
        headersTimeout: this.timeoutMs,
        connectTimeout: this.timeoutMs,
        bodyTimeout: 0
      });

      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // @ts-ignore
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
                // CRITICAL: Call the callback!
                onChunk(json.response);
              }
              if (json.done) done = true;
            } catch (e) { }
          }
        }
      }

      const cleaned = this.cleanOutput(fullText);
      return cleaned;

    } catch (error) {
      this.log(`❌ Stream Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // Same helper methods as before...
  private extractJSON(text: string): string {
    // 1. Find the first '{'
    const start = text.indexOf('{');
    // 2. Find the last '}'
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return this.cleanOutput(text);
    const jsonCandidate = text.slice(start, end + 1);

    // 4. Quick validity check (optional, but good for debugging)
    try {
      JSON.parse(jsonCandidate);
      return jsonCandidate;
    } catch (e) {
      this.log("   ⚠️  Warning: Extracted JSON was invalid, returning standard clean");
      // If extraction failed (e.g. nested braces messed us up), fallback
      return this.cleanOutput(text);
    }
  }

  private cleanOutput(text: string): string {
    let clean = text.trim();
    
    // 1. Remove XML Thinking tags (<think>, <thought>, <reasoning>)
    // Matches <tag>...content...</tag> case insensitive, multiline
    clean = clean.replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
    
    // 2. Remove Markdown Code Fences (```json ... ```)
    const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) clean = jsonMatch[1];
    else clean = clean.replace(/```/g, '');
    return clean.trim();
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      return res.ok;
    } catch { return false; }
  }
}
