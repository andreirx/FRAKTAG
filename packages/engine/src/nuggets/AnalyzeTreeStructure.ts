// packages/engine/src/nuggets/AnalyzeTreeStructure.ts

import { BaseNugget } from './BaseNugget.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export interface AnalyzeTreeStructureInput {
  organizingPrinciple: string;
  dogma: string;
  treeMap: string;
}

export interface TreeIssue {
  type: string;
  severity: string;
  description: string;
  operation?: {
    action: string;
    [key: string]: any;
  };
}

export interface AnalyzeTreeStructureOutput {
  issues: TreeIssue[];
}

export class AnalyzeTreeStructureNugget extends BaseNugget<AnalyzeTreeStructureInput, AnalyzeTreeStructureOutput> {
  readonly name = 'AnalyzeTreeStructure';
  readonly promptTemplate = DEFAULT_PROMPTS.analyzeTreeStructure;
  readonly expectsJSON = true;

  prepareVariables(input: AnalyzeTreeStructureInput): Record<string, string> {
    return {
      organizingPrinciple: input.organizingPrinciple,
      dogma: input.dogma,
      treeMap: input.treeMap,
    };
  }

  protected parseOutput(raw: string): AnalyzeTreeStructureOutput {
    const parsed = this.parseJSON<{ issues?: TreeIssue[] }>(raw);
    return {
      issues: parsed.issues || [],
    };
  }
}
