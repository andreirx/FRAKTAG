# LLM Nugget Pattern

All LLM calls in the engine are wrapped in **Nuggets** — typed functions in `packages/engine/src/nuggets/`.

## Why

- Single source of truth for each prompt.
- Typed input/output contracts (`TInput`, `TOutput`).
- JSON sanitization handled centrally (`extractJSON()` strips fences, fixes trailing commas, double-quoted key hallucinations).
- `expectsJSON` declared per nugget — adapter enables JSON mode automatically.
- Diagnostic testing via `NuggetTester` + `DiagnosticLLMProxy`.

## Rule

**Never call `llm.complete()` directly** in Navigator, Fractalizer, or `index.ts`. Always go through a nugget's `.run()` method.

## Creating a New Nugget

1. Create `src/nuggets/MyNugget.ts`
2. Define `TInput` and `TOutput` interfaces
3. Extend `BaseNugget<TInput, TOutput>`
4. Set `expectsJSON = true` if output is JSON
5. Implement `prepareVariables(input: TInput)` → returns template variable map
6. Implement `parseOutput(raw: string, input: TInput)` → returns `TOutput`
7. Re-export from `src/nuggets/index.ts`
8. Add test case to `NuggetTester.ts` `buildTestCases()`

## Streaming Path

When streaming (e.g., `askStream`), you can't use `.run()` because the output arrives in chunks. Instead:

```typescript
const nugget = new OracleAskNugget(this.smartLlm);
const vars = nugget.prepareVariables(input);
const prompt = substituteTemplate(nugget.promptTemplate, vars);
await this.smartLlm.stream(prompt, {}, onChunk);
```

The nugget is still the single source of truth for the prompt template.

## Custom Prompt Overrides

Config-driven prompt overrides are passed via the nugget constructor's `promptOverride` parameter. This allows users to customize prompts without modifying code.

## Existing Nuggets (12)

| Nugget | Used By | Purpose |
|--------|---------|---------|
| GlobalMapScan | Navigator | Scan tree map for retrieval targets |
| AssessVectorCandidates | Navigator | Filter vector search results |
| AssessNeighborhood | Navigator | Evaluate children relevance during drill |
| GenerateGist | Fractalizer | 1-2 sentence semantic summary |
| GenerateTitle | Fractalizer | 3-10 word title |
| ProposePlacement | Fractalizer | Suggest folder for document |
| AiSplit | Fractalizer | AI-assisted content splitting |
| OracleAsk | index.ts | RAG synthesis (single query) |
| OracleChat | index.ts | RAG synthesis (conversational) |
| AnswerGist | index.ts | Summarize an answer |
| TurnGist | index.ts | Summarize a Q&A turn |
| AnalyzeTreeStructure | Arborist | Structural audit |
