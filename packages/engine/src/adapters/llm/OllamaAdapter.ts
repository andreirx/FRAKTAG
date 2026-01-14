// src/adapters/llm/OllamaAdapter.ts

import { ILLMAdapter } from './ILLMAdapter.js';
import { substituteTemplate } from '../../prompts/default.js';

export interface OllamaConfig {
  endpoint: string;  // e.g., 'http://localhost:11434'
  model: string;     // e.g., 'llama3'
}

export class OllamaAdapter implements ILLMAdapter {
  private endpoint: string;
  private model: string;

  constructor(config: OllamaConfig) {
    this.endpoint = config.endpoint.endsWith('/')
      ? config.endpoint.slice(0, -1)
      : config.endpoint;
    this.model = config.model;
  }

  async complete(prompt: string, variables: Record<string, string | number | string[]>): Promise<string> {
    // Substitute variables in the prompt template
    const processedVariables: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (Array.isArray(value)) {
        processedVariables[key] = value.join('\n');
      } else {
        processedVariables[key] = value;
      }
    }

    const finalPrompt = substituteTemplate(prompt, processedVariables);

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: finalPrompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as { response?: string };

      if (!data.response) {
        throw new Error('Ollama API returned invalid response format');
      }

      return data.response.trim();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to complete prompt with Ollama: ${error.message}`);
      }
      throw new Error('Failed to complete prompt with Ollama: Unknown error');
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
