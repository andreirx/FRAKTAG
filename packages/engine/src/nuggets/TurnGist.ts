// packages/engine/src/nuggets/TurnGist.ts

import { BaseNugget } from './BaseNugget.js';

export interface TurnGistInput {
  question: string;
  answer: string;
}

const TURN_GIST_PROMPT = `Summarize this Q&A exchange in one sentence.

Question: {{question}}
Answer: {{answer}}`;

export class TurnGistNugget extends BaseNugget<TurnGistInput, string> {
  readonly name = 'TurnGist';
  readonly promptTemplate = TURN_GIST_PROMPT;
  readonly expectsJSON = false;

  prepareVariables(input: TurnGistInput): Record<string, string> {
    return {
      question: input.question,
      answer: input.answer,
    };
  }

  protected parseOutput(raw: string): string {
    return raw.trim().slice(0, 200);
  }
}
