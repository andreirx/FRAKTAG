// packages/engine/src/nuggets/AssessNeighborhood.ts

import { BaseNugget } from './BaseNugget.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export interface AssessNeighborhoodInput {
  query: string;
  parentContext: string;
  depthContext: string;
  childrenList: string;
}

export interface AssessNeighborhoodOutput {
  relevantIds: string[];
}

export class AssessNeighborhoodNugget extends BaseNugget<AssessNeighborhoodInput, AssessNeighborhoodOutput> {
  readonly name = 'AssessNeighborhood';
  readonly promptTemplate = DEFAULT_PROMPTS.assessNeighborhood;
  readonly expectsJSON = true;

  prepareVariables(input: AssessNeighborhoodInput): Record<string, string> {
    return {
      query: input.query,
      parentContext: input.parentContext,
      depthContext: input.depthContext,
      childrenList: input.childrenList,
    };
  }

  protected parseOutput(raw: string): AssessNeighborhoodOutput {
    const parsed = this.parseJSON<{ relevantIds?: string[] }>(raw);
    return {
      relevantIds: parsed.relevantIds || [],
    };
  }
}
