# Node Type Rules

Three strict types: `folder | document | fragment`.

## Hierarchy Constraints

- **FolderNode**: Pure structure, no content. Contains EITHER sub-folders OR documents — never both.
- **DocumentNode**: Leaf content. Only placed in leaf folders. References a ContentStore atom via `contentId`.
- **FragmentNode**: Child of DocumentNode only. Chunked content for granular retrieval.

## Type Guards

Always use these instead of manual type checks:
- `isFolder(node)` — narrows to FolderNode
- `isDocument(node)` — narrows to DocumentNode
- `isFragment(node)` — narrows to FragmentNode
- `hasContent(node)` — true for document or fragment (has `contentId`)

Defined in `packages/engine/src/core/types.ts`.

## Validation

`TreeStore.validateParentChild()` enforces all rules at write time:
- Documents in a folder → that folder becomes a "leaf folder" and rejects sub-folders.
- Sub-folders in a folder → that folder becomes a "branch folder" and rejects documents.
- Fragments can only be children of documents or other fragments.
- Folders cannot contain fragments directly.

## Every Node Has

- `title` — human-readable label
- `gist` — semantic summary (used by Navigator for retrieval, shown in UI)
- `path` — computed hierarchical path (`/root/parent/child/`)
- `sortOrder` — position among siblings
