// packages/engine/src/adapters/llm/OllamaAdapter.ts

import { ILLMAdapter } from './ILLMAdapter.js';
import { substituteTemplate } from '../../prompts/default.js';

export interface OllamaConfig {
  endpoint: string;
  model: string;
}

export class OllamaAdapter implements ILLMAdapter {
  private endpoint: string;
  private model: string;

  constructor(config: OllamaConfig) {
    this.endpoint = config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint;
    this.model = config.model;
  }

  async complete(prompt: string, variables: Record<string, string | number | string[]>): Promise<string> {
    const processedVars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
    }

    const finalPrompt = substituteTemplate(prompt, processedVars);

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: finalPrompt,
          stream: false,
          options: {
            temperature: 0.1, // Low temp for JSON stability
            num_ctx: 32768    // Use large context
          }
        }),
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
      const data = await response.json() as { response?: string };
      if (!data.response) throw new Error('Invalid Ollama response');

      return this.cleanOutput(data.response);
    } catch (error) {
      console.error("LLM Error", error);
      throw error;
    }
  }

  private cleanOutput(text: string): string {
    let clean = text.trim();
    // Remove <think> blocks from R1 models
    clean = clean.replace(/<think>[\s\S]*?<\/think>/g, '');
    // Remove Markdown code blocks
    clean = clean.replace(/```json/g, '').replace(/```/g, '');
    return clean.trim();
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      return res.ok;
    } catch { return false; }
  }
}
