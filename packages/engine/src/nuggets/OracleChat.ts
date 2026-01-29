// packages/engine/src/nuggets/OracleChat.ts

import { BaseNugget } from './BaseNugget.js';

export interface OracleChatInput {
  historyContext: string;
  ragContext: string;
  question: string;
}

const ORACLE_CHAT_PROMPT = `You are the Oracle. Answer the User Question using the provided Context and History.

Guidelines:
1. **Prioritize Context:** Use [SOURCE X] to answer facts. Cite them as [1], [2].
2. **Use History:** Use "Recent Conversation History" to understand follow-up questions (e.g. "explain that", "rewrite code", "what about...").
3. **Honesty:** If the answer isn't in Context or History, say so.
4. Be concise but thorough.

{{historyContext}}
{{ragContext}}

User Question: {{question}}

Answer:`;

export class OracleChatNugget extends BaseNugget<OracleChatInput, string> {
  readonly name = 'OracleChat';
  readonly promptTemplate = ORACLE_CHAT_PROMPT;
  readonly expectsJSON = false;

  prepareVariables(input: OracleChatInput): Record<string, string> {
    return {
      historyContext: input.historyContext,
      ragContext: input.ragContext,
      question: input.question,
    };
  }

  protected parseOutput(raw: string): string {
    return raw;
  }
}
