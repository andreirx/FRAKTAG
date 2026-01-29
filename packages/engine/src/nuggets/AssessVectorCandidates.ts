// packages/engine/src/nuggets/AssessVectorCandidates.ts

import { BaseNugget } from './BaseNugget.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export interface AssessVectorCandidatesInput {
  query: string;
  neighborhoods: string;
}

export interface AssessVectorCandidatesOutput {
  relevantNodeIds: string[];
}

export class AssessVectorCandidatesNugget extends BaseNugget<AssessVectorCandidatesInput, AssessVectorCandidatesOutput> {
  readonly name = 'AssessVectorCandidates';
  readonly promptTemplate = DEFAULT_PROMPTS.assessVectorCandidates;
  readonly expectsJSON = true;

  prepareVariables(input: AssessVectorCandidatesInput): Record<string, string> {
    return {
      query: input.query,
      neighborhoods: input.neighborhoods,
    };
  }

  protected parseOutput(raw: string): AssessVectorCandidatesOutput {
    const parsed = this.parseJSON<{ relevantNodeIds?: string[] }>(raw);
    return {
      relevantNodeIds: parsed.relevantNodeIds || [],
    };
  }
}
