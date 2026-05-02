# Plan: Apple Silicon Local LLM Support

Status: PLANNING (not yet implemented)

## Current State

- Active config: `packages/engine/data/config.json`
  - Adapter: `openai`
  - `model` / `basicModel`: `gpt-4.1-mini`
  - `expertModel`: `gpt-4.1`
- MLX LM Server installed (`/opt/homebrew/bin/mlx_lm.server`), not running
- Downloaded MLX models in HuggingFace cache:
  - `mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit`
  - `mlx-community/Qwen3-Coder-30B-A3B-Instruct-6bit`
- Local embeddings available: `nomic-ai/nomic-embed-text-v1.5`

## Goal

Add support for local inference on Apple Silicon.

**Current preference** (not final): LM Studio. Subject to verification.

## FRAKTAG Council-of-Three Wiring (Actual Constraint)

In `packages/engine/src/index.ts`, the engine creates three LLM adapters:

```typescript
this.smartLlm = this.createLLMAdapter(config.llm);

if (config.llm.basicModel) {
  const basicConfig = { ...config.llm, model: config.llm.basicModel };
  this.basicLlm = this.createLLMAdapter(basicConfig);
}

if (config.llm.expertModel) {
  const expertConfig = { ...config.llm, model: config.llm.expertModel };
  this.expertLlm = this.createLLMAdapter(expertConfig);
}
```

**The constraint**: One shared `endpoint`, three different `model` values, three adapter instances.

- If backend respects the `model` field in requests → Council-of-Three works on single endpoint
- If backend is truly single-model-per-server → current config structure cannot express per-role endpoints

This is an architectural pressure point. Extending config to support per-role endpoints would require changes to `LLMConfig` type and `createLLMAdapter` logic.

## Backend Compatibility

### LM Studio

- Endpoint: `http://localhost:1234/v1`
- Documented endpoints: `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/embeddings`
- Model selection: LM Studio requires model identifier in requests and exposes model-listing/management APIs
- Multiple models: Native SDK/CLI ecosystem supports loading multiple models
- **Verdict**: Plausibly compatible; must verify request-level routing by `model` field against the OpenAI-compatible endpoint before assuming Council-of-Three works.
- Sources: [OpenAI-compat docs](https://lmstudio.ai/docs/developer/openai-compat), [Server docs](https://lmstudio.ai/docs/developer/core/server)

### MLX LM Server

- Default port: `localhost:8080` (per [mlx-lm SERVER.md](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md))
- **Port mismatch in repo**: `MLXAdapter.ts` defaults to `http://localhost:11434/v1` (Ollama's port), `config.MLXexample.json` also uses `11434`
- Model selection: Single model loaded at server startup via `-m` flag
- **Verdict**: Requires config to explicitly set correct port. Council-of-Three collapses to single model unless multiple server instances run on different ports.

### llama.cpp (llama-server)

- Default port: `localhost:8080`
- Model selection: Not verified. Requires investigation before planning.
- Native endpoints available (`/completion`) but not currently relevant (see Option C below).

## Adapter Architecture Options

### Option A: Separate adapters per backend

- Pro: Explicit adapter name in config, room for backend-specific features
- Con: Code duplication — all OpenAI-compatible adapters share ~95% transport

### Option B: Unified `OpenAICompatibleAdapter`

- Generalize `MLXAdapter` to accept any OpenAI-compatible endpoint
- Config uses `endpoint` + optional `flavor` tag for telemetry
- Works with: LM Studio, MLX, llama.cpp, vLLM, LocalAI
- Con: No backend-specific features without conditional logic

### Option C: Native llama.cpp `/completion` endpoint

- Access to GBNF grammar-constrained JSON at decoder level
- **Not the current bottleneck**: `ILLMAdapter` and `BaseLLMAdapter` only expose `expectsJSON: boolean`. No schema/grammar object crosses the boundary. Until the port contract changes, transport choice does not affect structured-output reliability.
- Defer unless JSON parsing failures become frequent.

## Known Issues to Fix

1. **MLX port mismatch**: `MLXAdapter.ts` defaults to 11434, `mlx_lm.server` defaults to 8080. Either fix the adapter default or document that config must always specify `endpoint`.

2. **Config.json API key**: Contains plaintext OpenAI key. Treat as compromised if real. Rotate.

## Implementation Steps (when ready)

### Phase 1: Verification (blocking)

1. Install LM Studio, load multiple models
2. Test: does `/v1/chat/completions` route by `model` field, or ignore it?
3. Record findings in this document

### Phase 2: Decisions (after verification)

4. Decide MLX port handling: fix adapter default to 8080, or require explicit config
5. Decide adapter strategy:
   - Option A: Explicit `LMStudioAdapter` class
   - Option B: Generalized `OpenAICompatibleAdapter` with flavor tag
   - Decision depends on verification results and whether backend-specific features are needed

### Phase 3: Implementation (after decisions)

6. Implement chosen adapter strategy
7. Add config example for LM Studio
8. Update `testConnection()` to handle varying `/v1/models` responses
9. Test Council-of-Three with local backend

## Open Questions

- Does LM Studio support loading multiple models simultaneously and routing by `model` field?
- Should we extend `LLMConfig` to support per-role endpoints for single-model backends?
- Embedding adapter: continue using OpenAI cloud or switch to local nomic?

## References

- Engine wiring: `packages/engine/src/index.ts` (lines 86-100)
- LLM adapters: `packages/engine/src/adapters/llm/`
- Port contract: `ILLMAdapter.ts`, `BaseLLMAdapter.ts`
- MLX config example: `packages/engine/data/config.MLXexample.json`
