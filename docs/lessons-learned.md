# Lessons Learned

Hard-won knowledge from debugging and development. Read this to avoid repeating past mistakes.

## req.on('close') vs res.on('close')

**Problem:** Adding `req.on('close')` to detect client disconnect caused ALL requests to abort immediately with `AbortError` at the Phase 1→2 transition.

**Root cause:** The HTTP request's `close` event fires when the POST body is fully consumed, not when the client disconnects. For POST requests with a body, this happens almost immediately.

**Fix:** Use `res.on('close')` instead — the response's close event fires on actual client disconnect. Also guard with `!res.writableFinished` to avoid aborting after a successful response completes.

```typescript
// WRONG — fires immediately after POST body read
req.on('close', () => abortController.abort());

// RIGHT — fires when client actually disconnects
res.on('close', () => {
  if (!res.writableFinished) {
    abortController.abort();
  }
});
```

## workspace:* vs * in package.json

**Problem:** `"@fraktag/engine": "workspace:*"` in `package.json` caused npm install failures.

**Root cause:** The `workspace:` protocol is a pnpm/yarn feature. npm uses plain `"*"` for workspace resolution.

**Fix:** Use `"@fraktag/engine": "*"` in npm workspaces.

## contextWindow is chars, not tokens

`contextWindow` in config is measured in **characters** and controls how much source content is packed into retrieval prompts. It is NOT the model's context window (that's `numCtx` for Ollama, measured in tokens).

Rule of thumb: `contextWindow < numCtx * 3` (since 1 token ~ 3-4 chars), leaving room for prompt template + question + conversation history.

## Folders are Branch XOR Leaf

A folder that contains sub-folders cannot accept documents, and vice versa. This is enforced by `TreeStore.validateParentChild()` at write time. The error messages are descriptive but the constraint catches people off guard when they try to add a document to a folder that already has sub-folders.

## LLM JSON Mode Requires expectsJSON

The adapter only enables JSON mode (e.g., `response_format: json_object` for OpenAI) when the nugget declares `expectsJSON = true`. If you forget this property on a new nugget that expects JSON output, the LLM will return unparseable prose.
