// packages/engine/src/nuggets/GenerateGist.ts

import { BaseNugget } from './BaseNugget.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export interface GenerateGistInput {
  content: string;
  organizingPrinciple: string;
}

export class GenerateGistNugget extends BaseNugget<GenerateGistInput, string> {
  readonly name = 'GenerateGist';
  readonly promptTemplate = DEFAULT_PROMPTS.generateGist;
  readonly expectsJSON = false;

  prepareVariables(input: GenerateGistInput): Record<string, string> {
    return {
      content: input.content,
      organizingPrinciple: input.organizingPrinciple,
    };
  }

  protected parseOutput(raw: string): string {
    return raw.trim();
  }
}
