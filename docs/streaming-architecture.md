# Streaming Architecture

Real-time feedback during Q&A and chat flows.

## The Chain

```
LLM Adapter (stream + onChunk)
  → Engine (askStream/chatStream emits events)
    → API (SSE endpoint with res.write)
      → UI (EventSource with progressive state)
```

## SSE Events

| Event | Payload | When |
|-------|---------|------|
| `thinking` | `{ phase, message }` | Navigator progress (vector search, map scan, drilling) |
| `source` | `{ title, path, gist, content }` | Each source discovered during retrieval |
| `chunk` | `{ text }` | Answer text tokens from LLM |
| `done` | `{ references }` | Retrieval + synthesis complete |
| `error` | `{ message }` | Any error during the pipeline |

## Abort Support

The abort chain threads an `AbortSignal` from UI to Navigator:

1. **UI**: `AbortController` → `fetch` signal → user clicks Stop button
2. **API**: `res.on('close')` with `!res.writableFinished` guard → creates server-side `AbortController`
3. **Engine**: Signal passed to `retrieve()`, `askStream()`, `chat()`
4. **Navigator**: `checkAbort()` called between phases and inside loops

### Critical Lesson

**Use `res.on('close')`, NOT `req.on('close')`**. The request's `close` event fires when the POST body is fully consumed (immediately), not when the client disconnects. The response's `close` event fires on actual client disconnect.

Also guard the abort trigger: `if (!res.writableFinished)` — prevents aborting after a successful response.

## API Endpoint Pattern

```typescript
// Guard every write
const sendEvent = (event: string, data: any) => {
  if (!res.writableEnded) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
};

// Abort on client disconnect
const abortController = new AbortController();
res.on('close', () => {
  if (!res.writableFinished) {
    abortController.abort();
  }
});
```

## UI Pattern

```typescript
const abortControllerRef = useRef<AbortController>(new AbortController());
const eventSource = new EventSource(url);
eventSource.addEventListener('thinking', (e) => { /* update thinking state */ });
eventSource.addEventListener('source', (e) => { /* append to sources */ });
eventSource.addEventListener('chunk', (e) => { /* append to answer */ });
```
