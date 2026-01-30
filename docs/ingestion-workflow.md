# Ingestion Workflow

Two paths for adding content to the tree.

## Human-Supervised Ingestion (UI)

The default workflow — AI assists, human approves:

1. **Upload** — Drag-and-drop file into IngestionDialog
2. **Split Detection** — Programmatic methods find natural boundaries:
   - H1/H2/H3 headers, `---` horizontal rules
   - Numbered sections (`1.`, `A.`, `I.`, `1.1.`)
   - Custom regex patterns
   - AI-assisted splitting (fallback)
3. **Human Review** — Edit, merge, nested-split sections. Document minimap shows split positions.
4. **Placement** — AI proposes folder with confidence score. Human can override or create folders inline.
5. **Commit** — Creates nodes with full audit trail to `trees/{treeId}.audit.log`

Key behaviors:
- Smart title detection for repeated delimiter patterns
- Auto-recovery when AI splits miss content
- Large section warnings (>5000 chars)
- Per-section nested splitting for further granularity

## Direct Ingestion (Agent/MCP)

Bypasses the human review flow. Used by MCP tools and CLI when the agent has already reasoned about placement.

```typescript
await fraktag.directIngest(content, treeId, targetFolder, title, gist);
```

- `targetFolder` accepts path strings (`/Learnings/Debugging`) or folder UUIDs
- Missing intermediate folders are created automatically
- No LLM calls — title and gist must be provided
- Content marked `createdBy: 'agent-mcp'`, `editMode: 'readonly'`
- Immediately vector-indexed for retrieval

## Content Edit Modes

- **Editable** — User-created notes, direct editing in UI with auto-save
- **Read-only** — Ingested/agent-created content, versioning only via "Replace Version"

## Audit Trail

Every ingestion generates entries in `trees/{treeId}.audit.log`:
```
[timestamp] [ACTOR] ACTION: details (session: id)
```
Actors: `HUMAN`, `AI`, `SYSTEM`, `agent-mcp`. Append-only, never overwritten.
