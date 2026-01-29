// packages/engine/src/adapters/llm/BaseLLMAdapter.ts

import { ILLMAdapter } from './ILLMAdapter.js';
import { substituteTemplate } from '../../prompts/default.js';
import { Semaphore } from '../../utils/Semaphore.js';

/**
 * Options passed from the base class to adapter-specific perform methods.
 * Adapters use these to configure their transport (e.g. response_format, format: 'json').
 */
export interface LLMRequestOptions {
  maxTokens?: number;
  expectsJSON?: boolean;
}

/**
 * Abstract base class for LLM adapters.
 * Handles all shared concerns: concurrency, variable processing, template substitution,
 * output cleaning, JSON extraction, and logging.
 *
 * Concrete adapters only implement transport-specific methods:
 * - performComplete() — make the actual API call and return raw text
 * - performStream() — make a streaming API call, call onChunk for each piece
 * - testConnection() — check if the service is reachable
 */
export abstract class BaseLLMAdapter implements ILLMAdapter {
  readonly modelName?: string;
  readonly adapterName?: string;
  protected semaphore: Semaphore;

  constructor(concurrency: number = 1, modelName?: string, adapterName?: string) {
    this.semaphore = new Semaphore(concurrency);
    this.modelName = modelName;
    this.adapterName = adapterName;
  }

  // ============ PUBLIC API (final — not meant to be overridden) ============

  async complete(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    options?: { maxTokens?: number; expectsJSON?: boolean }
  ): Promise<string> {
    return this.semaphore.run(async () => {
      const finalPrompt = this.preparePrompt(prompt, variables);
      const expectsJSON = options?.expectsJSON ?? this.detectJSONExpectation(prompt);

      const raw = await this.performComplete(finalPrompt, {
        maxTokens: options?.maxTokens,
        expectsJSON
      });

      if (!raw || raw.trim().length === 0) {
        throw new Error('Received empty response from API');
      }

      return expectsJSON ? this.extractJSON(raw) : this.cleanOutput(raw);
    });
  }

  async stream(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    onChunk: (chunk: string) => void,
    options?: { maxTokens?: number }
  ): Promise<string> {
    return this.semaphore.run(async () => {
      const finalPrompt = this.preparePrompt(prompt, variables);
      const raw = await this.performStream(finalPrompt, onChunk, {
        maxTokens: options?.maxTokens
      });
      return this.cleanOutput(raw);
    });
  }

  // ============ ABSTRACT — each adapter implements these ============

  /**
   * Make a completion API call and return the raw text response.
   * The base class handles variable substitution, JSON extraction, and output cleaning.
   */
  protected abstract performComplete(
    finalPrompt: string,
    options?: LLMRequestOptions
  ): Promise<string>;

  /**
   * Make a streaming API call. Call onChunk for each piece of text received.
   * Return the full concatenated raw text.
   */
  protected abstract performStream(
    finalPrompt: string,
    onChunk: (chunk: string) => void,
    options?: LLMRequestOptions
  ): Promise<string>;

  /**
   * Test the connection to the LLM service.
   */
  public abstract testConnection(): Promise<boolean>;

  // ============ SHARED HELPERS ============

  /**
   * Process variables and substitute into prompt template.
   */
  protected preparePrompt(
    prompt: string,
    variables: Record<string, string | number | string[]>
  ): string {
    const processedVars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
    }
    return substituteTemplate(prompt, processedVars);
  }

  /**
   * Detect whether a prompt expects JSON output.
   */
  protected detectJSONExpectation(prompt: string): boolean {
    return prompt.includes('Respond ONLY with JSON') || prompt.includes('Return a JSON list');
  }

  /**
   * Clean LLM output: remove thinking tags and code fences.
   */
  protected cleanOutput(text: string): string {
    let clean = text.trim();
    // Remove XML Thinking tags (DeepSeek style: <think>, <thought>, <reasoning>)
    clean = clean.replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
    // Remove Markdown Code Fences — extract content if present, otherwise strip backticks
    const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) clean = jsonMatch[1];
    else clean = clean.replace(/```/g, '');
    return clean.trim();
  }

  /**
   * Extract JSON object from text — finds first { to last }.
   * Throws if no JSON object is found (prevents garbage propagation).
   */
  protected extractJSON(text: string): string {
    // First clean thinking tags and code fences that might wrap the JSON
    const cleaned = this.cleanOutput(text);
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end >= start) {
      return cleaned.slice(start, end + 1);
    }
    throw new Error(`No JSON object found in LLM response: "${text.slice(0, 80)}..."`);
  }

  /**
   * Timestamped log output.
   */
  protected log(msg: string, data?: any): void {
    const ts = new Date().toISOString().split('T')[1].slice(0, -1);
    if (data) console.log(`[${ts}] ${msg}`, data);
    else console.log(`[${ts}] ${msg}`);
  }

  /**
   * Create a stream progress tracker for consistent logging across all adapters.
   * Call onToken() for each content chunk, onThinking() for reasoning tokens,
   * and finish() when the stream is complete.
   */
  protected startStreamProgress(): StreamProgress {
    return new StreamProgress(this.log.bind(this));
  }

  /**
   * Parse an OpenAI-compatible SSE response stream.
   * Handles buffering, `data:` line splitting, delta.content extraction,
   * reasoning_content (thinking phase), and buffer flush.
   *
   * Used by OpenAI and MLX adapters (both speak the same SSE protocol).
   */
  protected async readSSEResponse(
    response: Response,
    progress: StreamProgress,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
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
              const delta = json.choices[0]?.delta;

              if (delta?.reasoning_content) {
                progress.onThinking();
              }

              const content = delta?.content || '';
              if (content) {
                fullText += content;
                progress.onToken();
                if (onChunk) onChunk(content);
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
            if (onChunk) onChunk(content);
          }
        } catch (e) {}
      }
    }

    progress.finish(fullText.length);
    return fullText;
  }
}

/**
 * Encapsulates streaming progress logging: ⏳ prefix, TTFT measurement,
 * progress dots, thinking indicators, and ✅ completion.
 */
export class StreamProgress {
  private start = Date.now();
  private firstTokenReceived = false;
  private logFn: (msg: string) => void;

  constructor(logFn: (msg: string) => void) {
    this.logFn = logFn;
    process.stdout.write('   ⏳ Generating: ');
  }

  /** Call for each content token received. Handles TTFT + progress dots. */
  onToken(): void {
    if (!this.firstTokenReceived) {
      const latency = Date.now() - this.start;
      process.stdout.write(` [TTFT: ${latency}ms] `);
      this.firstTokenReceived = true;
    }
    if (Math.random() > 0.8) process.stdout.write('.');
  }

  /** Call for reasoning/thinking tokens (e.g. OpenAI o-series). */
  onThinking(): void {
    if (!this.firstTokenReceived) {
      process.stdout.write(' (Thinking) ');
      this.firstTokenReceived = true;
    }
    if (Math.random() > 0.9) process.stdout.write('°');
  }

  /** Call when the stream is complete. Prints newline and completion log. */
  finish(totalLength: number): void {
    process.stdout.write('\n');
    this.logFn(`   ✅ Complete. Raw Output Length: ${totalLength} chars`);
  }
}
