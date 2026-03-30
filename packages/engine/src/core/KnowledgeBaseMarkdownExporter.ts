// src/core/KnowledgeBaseMarkdownExporter.ts
// Deterministic KB -> Markdown export (tree-mirrored filesystem layout)

import { mkdir, writeFile, stat, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { KnowledgeBase } from './KnowledgeBase.js';
import { TreeNode, isFolder, isDocument, isFragment, hasContent } from './types.js';

export interface ExportKnowledgeBaseToMarkdownOptions {
  outDir: string;
  force?: boolean;
}

export interface ExportedTreeStats {
  treeId: string;
  treeName: string;
  outPath: string;
  folderCount: number;
  documentCount: number;
  nodeCount: number;
}

export interface ExportKnowledgeBaseToMarkdownResult {
  kbId: string;
  kbName: string;
  outPath: string;
  trees: ExportedTreeStats[];
}

function stableSlug(input: string): string {
  const s = (input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    // Keep unicode letters/numbers to avoid collapsing non-Latin titles to empty.
    // Replace any run of non-(letter|number) with a dash.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return s.length > 0 ? s : 'untitled';
}

function safeFileBaseName(title: string): string {
  // Keep filenames readable and stable; avoid reserved/special chars.
  const base = stableSlug(title);
  // macOS/Windows dislike very long path components; keep conservative.
  return base.slice(0, 80);
}

function ensureUniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  const next = `${base}-${i}`;
  used.add(next);
  return next;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function mdEscapeInline(text: string): string {
  return (text || '').replace(/\|/g, '\\|');
}

function renderFolderMap(args: {
  folder: TreeNode;
  relativePathFromRoot: string;
  children: Array<{ type: 'folder' | 'document'; title: string; gist: string; link: string }>;
}): string {
  const { folder, relativePathFromRoot, children } = args;

  const lines: string[] = [];
  lines.push(`# ${folder.title}`);
  lines.push('');
  if (folder.gist?.trim()) {
    lines.push(folder.gist.trim());
    lines.push('');
  }
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- **id**: \`${folder.id}\``);
  lines.push(`- **type**: \`${folder.type}\``);
  lines.push(`- **treeId**: \`${folder.treeId}\``);
  lines.push(`- **path**: \`${relativePathFromRoot}\``);
  lines.push('');
  lines.push('## Children');
  lines.push('');
  if (children.length === 0) {
    lines.push('- (none)');
    lines.push('');
    return lines.join('\n');
  }

  for (const child of children) {
    const gist = child.gist?.trim() ? ` — ${mdEscapeInline(child.gist.trim())}` : '';
    lines.push(`- [${mdEscapeInline(child.title)}](${child.link})${gist}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderLeafContentMarkdown(args: {
  node: TreeNode;
  content: string;
  relativePathFromRoot: string;
}): string {
  const { node, content, relativePathFromRoot } = args;
  const lines: string[] = [];
  lines.push(`# ${node.title}`);
  lines.push('');
  lines.push(content || '');
  if (!content?.endsWith('\n')) lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- **id**: \`${node.id}\``);
  lines.push(`- **type**: \`${node.type}\``);
  lines.push(`- **treeId**: \`${node.treeId}\``);
  lines.push(`- **path**: \`${relativePathFromRoot}\``);
  lines.push('');
  return lines.join('\n');
}

function renderLeafMapMarkdown(args: { node: TreeNode; relativePathFromRoot: string }): string {
  const { node, relativePathFromRoot } = args;
  const lines: string[] = [];
  lines.push(`# ${node.title} — MAP`);
  lines.push('');
  if (node.gist?.trim()) {
    lines.push(node.gist.trim());
    lines.push('');
  }
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- **id**: \`${node.id}\``);
  lines.push(`- **type**: \`${node.type}\``);
  lines.push(`- **treeId**: \`${node.treeId}\``);
  if (hasContent(node)) lines.push(`- **contentId**: \`${node.contentId}\``);
  lines.push(`- **path**: \`${relativePathFromRoot}\``);
  lines.push('');
  return lines.join('\n');
}

export class KnowledgeBaseMarkdownExporter {
  async exportKnowledgeBase(kb: KnowledgeBase, options: ExportKnowledgeBaseToMarkdownOptions): Promise<ExportKnowledgeBaseToMarkdownResult> {
    const outDirAbs = resolve(options.outDir);
    const kbDirName = safeFileBaseName(kb.name) + `__${kb.id}`;
    const kbOutPath = join(outDirAbs, kbDirName);

    const exists = await pathExists(kbOutPath);
    if (!options.force && exists) {
      throw new Error(`Output path already exists: ${kbOutPath} (use --force to overwrite)`);
    }
    if (options.force && exists) {
      await rm(kbOutPath, { recursive: true, force: true });
    }

    await mkdir(kbOutPath, { recursive: true });

    const trees = await kb.listTrees();
    const treeStats: ExportedTreeStats[] = [];

    // Stable order for multi-tree KB export.
    const orderedTrees = [...trees].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    for (const tree of orderedTrees) {
      const treeDirName = safeFileBaseName(tree.name || tree.id) + `__${tree.id}`;
      const treeOutPath = join(kbOutPath, treeDirName);
      await mkdir(treeOutPath, { recursive: true });

      const treeFile = await kb.treeStore.getTreeFile(tree.id);
      const nodes = treeFile.nodes;
      const root = nodes[tree.rootNodeId];
      if (!root) {
        continue;
      }

      // Export the tree root folder into the tree directory itself (no extra nesting).
      const stats = await this.exportFolderRecursive({
        kb,
        allNodes: nodes,
        folderNode: root,
        outDir: treeOutPath,
        relativePathFromRoot: '/',
        force: !!options.force,
      });

      treeStats.push({
        treeId: tree.id,
        treeName: tree.name,
        outPath: treeOutPath,
        folderCount: stats.folderCount,
        documentCount: stats.documentCount,
        nodeCount: stats.nodeCount,
      });
    }

    return {
      kbId: kb.id,
      kbName: kb.name,
      outPath: kbOutPath,
      trees: treeStats,
    };
  }

  private async exportFolderRecursive(args: {
    kb: KnowledgeBase;
    allNodes: Record<string, TreeNode>;
    folderNode: TreeNode;
    outDir: string;
    relativePathFromRoot: string;
    force: boolean;
  }): Promise<{ folderCount: number; documentCount: number; nodeCount: number }> {
    const { kb, allNodes, folderNode, outDir, relativePathFromRoot } = args;
    if (!isFolder(folderNode)) {
      throw new Error(`Expected folder node, got ${folderNode.type} (${folderNode.id})`);
    }

    const childNodes = Object.values(allNodes)
      .filter(n => n.parentId === folderNode.id)
      .sort((a, b) => {
        const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        if (so !== 0) return so;
        return (a.title || a.id).localeCompare(b.title || b.id);
      });

    const folderChildren: Array<{ type: 'folder' | 'document'; title: string; gist: string; link: string }> = [];

    let folderCount = 1;
    let documentCount = 0;
    let nodeCount = 1;

    // First pass: allocate stable names for children we actually export at this level.
    const usedNames = new Set<string>();
    const nameByChildId = new Map<string, string>();
    for (const child of childNodes) {
      if (isFolder(child) || isDocument(child)) {
        const base = safeFileBaseName(child.title);
        const unique = ensureUniqueName(base, usedNames);
        nameByChildId.set(child.id, unique);
      } else {
        // Tree invariants: folders do not contain fragments directly.
        // If fragments appear here due to corruption, skip without poisoning name allocation.
      }
    }

    // Export children.
    for (const child of childNodes) {
      const childName = nameByChildId.get(child.id) || safeFileBaseName(child.title);

      if (isFolder(child)) {
        const childDir = join(outDir, childName);
        await mkdir(childDir, { recursive: true });

        folderChildren.push({
          type: 'folder',
          title: child.title,
          gist: child.gist || '',
          link: `./${encodeURIComponent(childName)}/MAP.md`,
        });

        const sub = await this.exportFolderRecursive({
          kb,
          allNodes,
          folderNode: child,
          outDir: childDir,
          relativePathFromRoot: join(relativePathFromRoot, `${childName}/`).replace(/\\/g, '/'),
          force: args.force,
        });
        folderCount += sub.folderCount;
        documentCount += sub.documentCount;
        nodeCount += sub.nodeCount;
        continue;
      }

      if (isDocument(child)) {
        documentCount++;
        nodeCount += 1;
        const contentAtom = await kb.contentStore.get(child.contentId);
        const payload = contentAtom?.payload ?? '';

        const leafMdName = `${childName}.md`;
        const leafMapName = `${childName}.MAP.md`;

        const leafMdPath = join(outDir, leafMdName);
        const leafMapPath = join(outDir, leafMapName);

        await writeFile(leafMdPath, renderLeafContentMarkdown({
          node: child,
          content: payload,
          relativePathFromRoot: join(relativePathFromRoot, leafMdName).replace(/\\/g, '/'),
        }), 'utf-8');

        // Export fragments (if present) into a stable subdirectory next to the document.
        // Rationale: document nodes are leaves in the folder tree, but fragments are content-bearing children.
        // We preserve the tree structure without turning documents into directories by creating
        // `<docBase>__fragments/` alongside `<docBase>.md`.
        const fragmentNodes = Object.values(allNodes)
          .filter(n => n.parentId === child.id)
          .filter(isFragment)
          .sort((a, b) => {
            const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
            if (so !== 0) return so;
            return (a.title || a.id).localeCompare(b.title || b.id);
          });

        const fragmentLinks: Array<{ title: string; link: string; gist: string }> = [];
        if (fragmentNodes.length > 0) {
          const fragDirName = `${childName}__fragments`;
          const fragOutDir = join(outDir, fragDirName);
          await mkdir(fragOutDir, { recursive: true });

          const usedFragNames = new Set<string>();
          for (const frag of fragmentNodes) {
            nodeCount += 1;
            const base = safeFileBaseName(frag.title);
            const fragName = ensureUniqueName(base, usedFragNames);
            const fragMdName = `${fragName}.md`;
            const fragMapName = `${fragName}.MAP.md`;

            const fragContentAtom = hasContent(frag) ? await kb.contentStore.get(frag.contentId) : null;
            const fragPayload = fragContentAtom?.payload ?? '';

            await writeFile(
              join(fragOutDir, fragMdName),
              renderLeafContentMarkdown({
                node: frag,
                content: fragPayload,
                relativePathFromRoot: join(relativePathFromRoot, fragDirName, fragMdName).replace(/\\/g, '/'),
              }),
              'utf-8'
            );
            await writeFile(
              join(fragOutDir, fragMapName),
              renderLeafMapMarkdown({
                node: frag,
                relativePathFromRoot: join(relativePathFromRoot, fragDirName, fragMapName).replace(/\\/g, '/'),
              }),
              'utf-8'
            );

            fragmentLinks.push({
              title: frag.title,
              gist: frag.gist || '',
              link: `./${encodeURIComponent(fragDirName)}/${encodeURIComponent(fragMdName)}`,
            });
          }
        }

        let leafMapText = renderLeafMapMarkdown({
          node: child,
          relativePathFromRoot: join(relativePathFromRoot, leafMapName).replace(/\\/g, '/'),
        });
        if (fragmentLinks.length > 0) {
          leafMapText += '\n## Fragments\n\n';
          for (const f of fragmentLinks) {
            const gist = f.gist?.trim() ? ` — ${mdEscapeInline(f.gist.trim())}` : '';
            leafMapText += `- [${mdEscapeInline(f.title)}](${f.link})${gist}\n`;
          }
          leafMapText += '\n';
        }
        await writeFile(leafMapPath, leafMapText, 'utf-8');

        folderChildren.push({
          type: 'document',
          title: child.title,
          gist: child.gist || '',
          link: `./${encodeURIComponent(leafMdName)}`,
        });
      }
    }

    // Finally, write this folder's MAP.md.
    const mapPath = join(outDir, 'MAP.md');
    await writeFile(mapPath, renderFolderMap({
      folder: folderNode,
      relativePathFromRoot: join(relativePathFromRoot, 'MAP.md').replace(/\\/g, '/'),
      children: folderChildren,
    }), 'utf-8');

    return { folderCount, documentCount, nodeCount };
  }
}

export const __private__ = {
  stableSlug,
  safeFileBaseName,
  ensureUniqueName,
};

