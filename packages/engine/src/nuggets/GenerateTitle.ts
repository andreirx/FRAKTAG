// packages/engine/src/nuggets/GenerateTitle.ts

import { BaseNugget } from './BaseNugget.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export interface GenerateTitleInput {
  content: string;
  organizingPrinciple: string;
}

export class GenerateTitleNugget extends BaseNugget<GenerateTitleInput, string> {
  readonly name = 'GenerateTitle';
  readonly promptTemplate = DEFAULT_PROMPTS.generateTitle;
  readonly expectsJSON = false;

  prepareVariables(input: GenerateTitleInput): Record<string, string> {
    return {
      content: input.content,
      organizingPrinciple: input.organizingPrinciple,
    };
  }

  protected parseOutput(raw: string): string {
    return raw.trim().slice(0, 100);
  }
}
