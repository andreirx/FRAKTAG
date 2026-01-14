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
    options?: { maxTokens?: number } // Add this parameter
  ): Promise<string> {
    const processedVars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
    }

    const finalPrompt = substituteTemplate(prompt, processedVars);
    const estTokens = Math.ceil(finalPrompt.length / 4);

    this.log(`🚀 LLM CALL [${this.model}]`);
    this.log(`   📝 Input: ~${estTokens} tokens`);
    this.log(`   ❓ Prompt Preview: ${finalPrompt.slice(0, 100).replace(/\n/g, ' ')}...`);

    // Heuristic: If prompt contains "Split this content", we need MASSIVE output capacity.
    const isSplitRequest = prompt.includes('Split this content');
    const predictLimit = options?.maxTokens 
        ? options.maxTokens 
        : (isSplitRequest ? -1 : 4096); // -1 = Infinite/Context Limit

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: finalPrompt,
          stream: true,
          options: {
            temperature: 0.1,
            num_ctx: 131072,
            num_predict: predictLimit // Use dynamic limit
          }
        }),
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
            } catch (e) {
              // Partial JSON line, ignore
            }
          }
        }
      }
      process.stdout.write('\n'); // Newline after dots

      this.log(`   ✅ Complete. Raw Output Length: ${fullText.length} chars`);
      
      const cleaned = this.cleanOutput(fullText);

      // LOG RAW IF CLEAN IS EMPTY
      if (cleaned.length === 0 && fullText.length > 0) {
          console.warn("   ⚠️  WARNING: Output cleaned to empty string!");
          console.warn("   RAW START: ", fullText.slice(0, 500));
      }      
      // Log truncation for debug
      if (cleaned.length < 500) {
        this.log(`   🧹 Cleaned Output: ${cleaned}`);
      } else {
        this.log(`   🧹 Cleaned Output (First 500): ${cleaned.slice(0, 500)}...`);
      }

      return cleaned;

    } catch (error) {
      this.log(`   ❌ LLM Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private cleanOutput(text: string): string {
    let clean = text.trim();
    
    // 1. Remove XML Thinking tags (<think>, <thought>, <reasoning>)
    // Matches <tag>...content...</tag> case insensitive, multiline
    clean = clean.replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
    
    // 2. Remove Markdown Code Fences (```json ... ```)
    const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        clean = jsonMatch[1];
    } else {
        // Fallback: Just strip ``` if no proper block found
        clean = clean.replace(/```/g, '');
    }

    return clean.trim();
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      return res.ok;
    } catch { return false; }
  }
}
