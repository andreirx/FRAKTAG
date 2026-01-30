# MCP Integration (Claude Code Memory)

The `@fraktag/mcp` package turns FRAKTAG into Claude Code's persistent Repository Memory via the Model Context Protocol.

## Design: Inversion of Control

Claude Code IS the brain, FRAKTAG is the memory. Two tool tiers:

- **Smart tools** — FRAKTAG's LLM does the reasoning (full Navigator pipeline).
- **Raw tools** — No LLM. Claude Code gets raw data and reasons over it directly.

## Tools

| Tool | LLM? | Purpose |
|------|-------|---------|
| `fraktag_search` | Yes | Full retrieval pipeline (vector + map scan + drill) |
| `fraktag_ask` | Yes | RAG synthesis with source references |
| `fraktag_ingest` | No | Save documents with auto folder creation |
| `fraktag_list_trees` | No | Discover available trees |
| `fraktag_browse` | No | Navigate tree structure, find folders |
| `fraktag_vector_search` | No | Raw vector similarity search |
| `fraktag_tree_map` | No | Full table of contents |
| `fraktag_get_node` | No | Fetch specific node content |

## Organizing Principle (Taxonomy)

Repository Memory uses four top-level categories:

```
/Architecture   — System design decisions, component boundaries, technology choices
/Patterns       — Reusable code patterns, style guides, naming conventions
/Learnings      — Post-mortems, bug root causes, lessons learned
/Operational    — Scripts, deployment procedures, configuration guides
```

Sub-folders created automatically when ingesting to deeper paths.

## Config Discovery

The MCP server finds its config in order:
1. `FRAKTAG_CONFIG` environment variable
2. `.fraktag/config.json` in current working directory
3. `packages/engine/data/config.json` (dev fallback)

## Setup

```bash
./scripts/setup-memory.sh   # Bootstrap repo-memory tree with taxonomy
./scripts/setup-mcp.sh      # Build MCP server + write .mcp.json for Claude Code
# Restart Claude Code
```

## Nightly Compounding

```bash
./scripts/nightly-compound.sh           # Review today's git activity, save learnings
./scripts/nightly-compound.sh --days 3  # Look back 3 days
```

Drives Claude Code to review commits, identify patterns/decisions/lessons, and save them to the appropriate taxonomy folders.
