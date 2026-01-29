// packages/engine/src/nuggets/AnswerGist.ts

import { BaseNugget } from './BaseNugget.js';

export interface AnswerGistInput {
  answer: string;
}

const ANSWER_GIST_PROMPT = `Summarize this AI answer in 1-2 sentences. Do not start with "This answer..." — just state the key point.

{{answer}}`;

export class AnswerGistNugget extends BaseNugget<AnswerGistInput, string> {
  readonly name = 'AnswerGist';
  readonly promptTemplate = ANSWER_GIST_PROMPT;
  readonly expectsJSON = false;

  prepareVariables(input: AnswerGistInput): Record<string, string> {
    return {
      answer: input.answer,
    };
  }

  protected parseOutput(raw: string): string {
    return raw.trim().slice(0, 200);
  }
}
