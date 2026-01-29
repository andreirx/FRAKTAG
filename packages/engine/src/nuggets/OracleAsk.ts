// packages/engine/src/nuggets/OracleAsk.ts

import { BaseNugget } from './BaseNugget.js';

export interface OracleAskInput {
  context: string;
  query: string;
}

const ORACLE_ASK_PROMPT = `You are the Oracle. Answer the user's question using ONLY the provided context.

    Guidelines:
    - Cite your sources using the source as [number], AND also mention the Title for example "according to ... [1]".
    - Use the Titles provided in the context to explain where information comes from.
    - If the context mentions specific terms, define them as the text does.
    - Do not use outside knowledge. If the answer isn't in the text, say so.

    Context:
    {{context}}

    Question: {{query}}

    Answer:`;

export class OracleAskNugget extends BaseNugget<OracleAskInput, string> {
  readonly name = 'OracleAsk';
  readonly promptTemplate = ORACLE_ASK_PROMPT;
  readonly expectsJSON = false;

  prepareVariables(input: OracleAskInput): Record<string, string> {
    return {
      context: input.context,
      query: input.query,
    };
  }

  protected parseOutput(raw: string): string {
    return raw;
  }
}
