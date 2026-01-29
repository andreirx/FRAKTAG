// packages/engine/src/nuggets/BaseNugget.ts

import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';

/**
 * An LLM Nugget = typed function wrapping an LLM call.
 * - TInput: typed input interface
 * - TOutput: typed output interface
 * - promptTemplate: the prompt (the implementation)
 * - parseOutput(): validates LLM response into TOutput
 * - run(input): end-to-end execution
 */
export abstract class BaseNugget<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly promptTemplate: string;
  abstract readonly expectsJSON: boolean;

  constructor(protected llm: ILLMAdapter, protected promptOverride?: string) {}

  /** Map typed input to template variables. */
  abstract prepareVariables(input: TInput): Record<string, string | number | string[]>;

  /** Parse raw LLM string into typed output. */
  protected abstract parseOutput(raw: string): TOutput;

  /** End-to-end execution: prepare → call LLM → parse. */
  async run(input: TInput, options?: { maxTokens?: number }): Promise<TOutput> {
    const prompt = this.promptOverride || this.promptTemplate;
    const variables = this.prepareVariables(input);
    const raw = await this.llm.complete(prompt, variables, {
      maxTokens: options?.maxTokens,
      expectsJSON: this.expectsJSON,
    });
    return this.parseOutput(raw);
  }

  /** Safe JSON parse with nugget-specific error message. Delegates to extractJSON. */
  protected parseJSON<T>(raw: string): T {
    return this.extractJSON<T>(raw);
  }

  /** Extract a JSON array from raw text. Applies sanitization before parsing. */
  protected parseJSONArray<T>(raw: string): T[] {
    let clean = raw.trim();
    // Remove markdown code blocks
    clean = clean.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');

    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');

    if (start === -1 || end === -1) {
      throw new Error(`[${this.name}] No JSON array found: ${raw.slice(0, 200)}`);
    }

    let jsonStr = this.sanitizeJSON(clean.slice(start, end + 1));

    try {
      return JSON.parse(jsonStr) as T[];
    } catch (e) {
      throw new Error(`[${this.name}] JSON array parse failed: ${e}\nInput: ${jsonStr.slice(0, 200)}`);
    }
  }

  /**
   * Robust JSON object extraction with sanitization.
   * Handles common LLM output quirks:
   * - Markdown code fences around JSON
   * - Double-quoted keys like " "relevantIds" " → "relevantIds"
   * - Trailing commas before } or ]
   */
  protected extractJSON<T>(text: string): T {
    let clean = text.trim();
    // Remove markdown code blocks
    clean = clean.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');

    // Find JSON object bounds
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      throw new Error(`[${this.name}] No JSON object found: ${text.slice(0, 200)}`);
    }

    let jsonStr = this.sanitizeJSON(clean.slice(start, end + 1));

    try {
      return JSON.parse(jsonStr) as T;
    } catch (e) {
      throw new Error(`[${this.name}] Invalid JSON syntax: ${e}\nInput: ${jsonStr.slice(0, 200)}`);
    }
  }

  /** Apply robustness fixes to a JSON string before parsing. */
  private sanitizeJSON(jsonStr: string): string {
    // 1. Fix double-quoted keys: " "key" " → "key"
    //    Matches patterns like "  "someKey"  : where extra quotes/spaces surround the real key
    jsonStr = jsonStr.replace(/"\s+"(\w+)"/g, '"$1"');

    // 2. Remove trailing commas before } or ]
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

    return jsonStr;
  }
}
