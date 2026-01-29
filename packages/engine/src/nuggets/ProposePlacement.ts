// packages/engine/src/nuggets/ProposePlacement.ts

import { BaseNugget } from './BaseNugget.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export interface ProposePlacementInput {
  documentTitle: string;
  documentGist: string;
  leafFolders: string;
}

export interface ProposePlacementOutput {
  targetFolderId: string;
  confidence: number;
  reasoning: string;
  newFolderSuggestion?: {
    title: string;
    gist: string;
    parentId: string;
  };
}

export class ProposePlacementNugget extends BaseNugget<ProposePlacementInput, ProposePlacementOutput> {
  readonly name = 'ProposePlacement';
  readonly promptTemplate = DEFAULT_PROMPTS.proposePlacement;
  readonly expectsJSON = true;

  prepareVariables(input: ProposePlacementInput): Record<string, string> {
    return {
      documentTitle: input.documentTitle,
      documentGist: input.documentGist,
      leafFolders: input.leafFolders,
    };
  }

  protected parseOutput(raw: string): ProposePlacementOutput {
    const parsed = this.parseJSON<any>(raw);
    return {
      targetFolderId: parsed.targetFolderId || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      reasoning: parsed.reasoning || '',
      newFolderSuggestion: parsed.newFolderSuggestion,
    };
  }
}
