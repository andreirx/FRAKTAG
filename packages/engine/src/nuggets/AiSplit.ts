// packages/engine/src/nuggets/AiSplit.ts

import { BaseNugget } from './BaseNugget.js';

export interface AiSplitInput {
  content: string;
  organizingPrinciple: string;
}

export type AiSplitOutput = { title: string; text: string }[];

const AI_SPLIT_PROMPT = `Analyze this content and split it into logical sections. Each section should be self-contained and cover a distinct topic.

Organizing principle: {{organizingPrinciple}}

Content:
---
{{content}}
---

Return a JSON array of sections with "title" and "text" properties.
Example: [{"title": "Introduction", "text": "content here..."}, {"title": "Main Topic", "text": "..."}]

IMPORTANT: Return ONLY valid JSON array, no other text.`;

export class AiSplitNugget extends BaseNugget<AiSplitInput, AiSplitOutput> {
  readonly name = 'AiSplit';
  readonly promptTemplate = AI_SPLIT_PROMPT;
  readonly expectsJSON = false; // Returns JSON array, not object — handled in parseOutput

  prepareVariables(input: AiSplitInput): Record<string, string> {
    return {
      content: input.content,
      organizingPrinciple: input.organizingPrinciple,
    };
  }

  protected parseOutput(raw: string): AiSplitOutput {
    const arr = this.parseJSONArray<{ title?: string; text?: string }>(raw);
    return arr.map(s => ({
      title: String(s.title || 'Untitled Section'),
      text: String(s.text || ''),
    }));
  }
}
