import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { KnowledgeBase } from '../KnowledgeBase.js';
import { KnowledgeBaseMarkdownExporter, __private__ } from '../KnowledgeBaseMarkdownExporter.js';

describe('KnowledgeBaseMarkdownExporter (helpers)', () => {
  it('stableSlug produces non-empty, filesystem-safe slugs', () => {
    expect(__private__.stableSlug('Hello World')).toBe('hello-world');
    expect(__private__.stableSlug('')).toBe('untitled');
    expect(__private__.stableSlug('   ')).toBe('untitled');
    expect(__private__.stableSlug('Café Déjà Vu')).toBe('cafe-deja-vu');
  });

  it('ensureUniqueName is deterministic and increments suffixes', () => {
    const used = new Set<string>();
    expect(__private__.ensureUniqueName('a', used)).toBe('a');
    expect(__private__.ensureUniqueName('a', used)).toBe('a-2');
    expect(__private__.ensureUniqueName('a', used)).toBe('a-3');
  });
});

describe('KnowledgeBaseMarkdownExporter (integration)', () => {
  it('exports folder MAP.md and leaf .md/.MAP.md with collision-safe names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fraktag-kb-export-test-'));
    const kbPath = join(root, 'kb');

    const kb = await KnowledgeBase.create(kbPath, {
      id: 'kb-test',
      name: 'Test KB',
      organizingPrinciple: 'Test export',
      seedFolders: [
        { title: 'Docs', gist: 'Documentation' }
      ]
    });

    const tree = await kb.createTree('main');
    const treeId = tree.id;

    const treeFile = await kb.treeStore.getTreeFile(treeId);
    const rootId = treeFile.config.rootNodeId;
    const rootChildren = Object.values(treeFile.nodes).filter(n => n.parentId === rootId);
    const docsFolder = rootChildren.find(n => n.title === 'Docs');
    expect(docsFolder).toBeTruthy();
    if (!docsFolder) throw new Error('seed folder not created');

    const c1 = await kb.contentStore.create({ payload: 'Alpha', mediaType: 'text/plain', createdBy: 'test' });
    const c2 = await kb.contentStore.create({ payload: 'Beta', mediaType: 'text/plain', createdBy: 'test' });

    const doc1 = await kb.treeStore.createDocument(treeId, docsFolder.id, 'Same Title', 'Gist 1', c1.id);
    await kb.treeStore.createDocument(treeId, docsFolder.id, 'Same Title', 'Gist 2', c2.id);

    // Add a fragment under the first document to validate fragment export.
    const fc = await kb.contentStore.create({ payload: 'Fragment Alpha', mediaType: 'text/plain', createdBy: 'test' });
    await kb.treeStore.createFragment(treeId, doc1.id, 'Part 1', 'Frag gist', fc.id);

    const outDir = join(root, 'out');
    const exporter = new KnowledgeBaseMarkdownExporter();
    const result = await exporter.exportKnowledgeBase(kb, { outDir, force: true });

    expect(result.kbId).toBe('kb-test');
    expect(result.trees.length).toBe(1);

    // Root output always includes __<kbId> suffix
    expect(result.outPath).toContain('test-kb__kb-test');

    // Validate that the docs folder got exported as a directory with MAP.md.
    const treeOut = result.trees[0].outPath;
    const docsDir = join(treeOut, 'docs');
    const docsMap = join(docsDir, 'MAP.md');
    const mapText = await readFile(docsMap, 'utf-8');
    expect(mapText).toContain('# Docs');
    expect(mapText).toContain('## Children');

    // Validate collision-safe leaf names exist.
    const leaf1 = join(docsDir, 'same-title.md');
    const leaf2 = join(docsDir, 'same-title-2.md');
    const leaf1Map = join(docsDir, 'same-title.MAP.md');
    const leaf2Map = join(docsDir, 'same-title-2.MAP.md');

    const leaf1Text = await readFile(leaf1, 'utf-8');
    const leaf2Text = await readFile(leaf2, 'utf-8');
    expect(leaf1Text).toContain('Alpha');
    expect(leaf2Text).toContain('Beta');

    const leaf1MapText = await readFile(leaf1Map, 'utf-8');
    const leaf2MapText = await readFile(leaf2Map, 'utf-8');
    expect(leaf1MapText).toContain('Gist 1');
    expect(leaf2MapText).toContain('Gist 2');

    // Fragment export: sidecar fragments folder next to the document.
    const fragDir = join(docsDir, 'same-title__fragments');
    const fragMd = join(fragDir, 'part-1.md');
    const fragMap = join(fragDir, 'part-1.MAP.md');
    const fragMdText = await readFile(fragMd, 'utf-8');
    expect(fragMdText).toContain('Fragment Alpha');
    const fragMapText = await readFile(fragMap, 'utf-8');
    expect(fragMapText).toContain('Frag gist');
    expect(leaf1MapText).toContain('## Fragments');

    await rm(root, { recursive: true, force: true });
  });

  it('force=false throws if output exists; force=true cleans output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fraktag-kb-export-test-force-'));
    const kbPath = join(root, 'kb');

    const kb = await KnowledgeBase.create(kbPath, {
      id: 'kb-test',
      name: 'Test KB',
      organizingPrinciple: 'Test export',
      seedFolders: [{ title: 'Docs', gist: 'Documentation' }]
    });
    await kb.createTree('main');

    const outDir = join(root, 'out');
    const exporter = new KnowledgeBaseMarkdownExporter();
    const first = await exporter.exportKnowledgeBase(kb, { outDir, force: true });

    // Create a ghost file inside the output.
    const ghostPath = join(first.outPath, 'GHOST.md');
    await (await import('fs/promises')).writeFile(ghostPath, 'ghost', 'utf-8');

    // force=false should throw because the kb output path exists.
    await expect(exporter.exportKnowledgeBase(kb, { outDir, force: false }))
      .rejects.toThrow(/Output path already exists/);

    // force=true should clean (rm -rf) and recreate, removing the ghost.
    await exporter.exportKnowledgeBase(kb, { outDir, force: true });
    await expect((await import('fs/promises')).readFile(ghostPath, 'utf-8'))
      .rejects.toBeTruthy();

    await rm(root, { recursive: true, force: true });
  });
});

