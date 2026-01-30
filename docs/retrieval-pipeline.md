# Retrieval Pipeline (Navigator)

The Navigator finds information using an ensemble strategy: vector similarity + structural graph scanning.

## Three Phases

### Phase 1: Vector Paratroopers
Semantic search via embeddings. Returns candidate nodes with cosine similarity scores.
- "Smart Check" distinguishes folders (queue for drilling) from leaves (return immediately).
- Fast but can miss structurally important nodes that don't match semantically.

### Phase 2: Global Map Scan
Passes the compressed tree map (gists only) to the LLM to identify relevant branches.
- Chunks the map based on `contextWindow` setting.
- Finds targets that vector search missed (structural relevance vs semantic similarity).
- Uses the Scout (basicModel) for speed.

### Phase 3: Precision Drilling
Recursively explores candidate branches identified by Phase 1 and 2.
- **The Scout** reads each neighborhood (parent + children) and decides which paths to follow.
- **The Magnet** scores content fragments for relevance (0-10).
- Configurable depth limits prevent runaway exploration.

## Budget Control

- `contextWindow` (config) controls how much source content is packed into the final oracle prompt.
- The retrieval budget only covers source content — prompt template, question, and conversation history are additional overhead.
- For local models: set `contextWindow` conservatively below `numCtx * 3` (1 token ~ 3-4 chars).

## MCP Raw Tools (Inversion of Control)

The MCP server exposes each phase independently so Claude Code can be the brain:

| MCP Tool | Navigator Equivalent |
|----------|---------------------|
| `fraktag_vector_search` | Phase 1 (vector only, no LLM filtering) |
| `fraktag_tree_map` | Phase 2 input (the map itself, no LLM scan) |
| `fraktag_get_node` | Phase 3 drill (fetch content, no LLM scoring) |

Claude Code performs the reasoning that Navigator's nuggets normally do.
