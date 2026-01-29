// packages/engine/src/nuggets/GlobalMapScan.ts

import { BaseNugget } from './BaseNugget.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export interface GlobalMapScanInput {
  query: string;
  treeMap: string;
}

export interface GlobalMapScanOutput {
  targetIds: string[];
  reasoning: string;
}

export class GlobalMapScanNugget extends BaseNugget<GlobalMapScanInput, GlobalMapScanOutput> {
  readonly name = 'GlobalMapScan';
  readonly promptTemplate = DEFAULT_PROMPTS.globalMapScan;
  readonly expectsJSON = true;

  prepareVariables(input: GlobalMapScanInput): Record<string, string> {
    return {
      query: input.query,
      treeMap: input.treeMap,
    };
  }

  protected parseOutput(raw: string): GlobalMapScanOutput {
    const parsed = this.parseJSON<{ targetIds?: string[]; reasoning?: string }>(raw);
    return {
      targetIds: parsed.targetIds || [],
      reasoning: parsed.reasoning || '',
    };
  }
}
