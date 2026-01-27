// packages/api/src/server.ts
// FRAKTAG API - Strict Taxonomy Edition

import express from 'express';
import cors from 'cors';
import { Fraktag } from '@fraktag/engine';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

let fraktag: Fraktag;

function findConfig(): string {
  // 1. Environment variable
  if (process.env.FRAKTAG_CONFIG) {
    return process.env.FRAKTAG_CONFIG;
  }

  // 2. Relative to API package (dev mode)
  const devConfig = path.resolve(__dirname, '../../../packages/engine/data/config.json');
  if (fs.existsSync(devConfig)) return devConfig;

  // 3. Root relative (running from monorepo root)
  const rootConfig = path.resolve(process.cwd(), 'packages/engine/data/config.json');
  if (fs.existsSync(rootConfig)) return rootConfig;

  // 4. CWD data folder
  const cwdConfig = path.resolve(process.cwd(), 'data/config.json');
  if (fs.existsSync(cwdConfig)) return cwdConfig;

  throw new Error('Config not found. Set FRAKTAG_CONFIG env var.');
}

// ============ KNOWLEDGE BASE ENDPOINTS ============

// List all loaded knowledge bases
app.get('/api/knowledge-bases', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const kbs = fraktag.listKnowledgeBases();
    res.json(kbs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Discover all knowledge bases in the storage path (both loaded and unloaded)
app.get('/api/knowledge-bases/discover', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const discovered = await fraktag.discoverKnowledgeBases();
    const storagePath = fraktag.getKbStoragePath();
    res.json({ storagePath, knowledgeBases: discovered });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get knowledge base details
app.get('/api/knowledge-bases/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const kb = fraktag.getKnowledgeBase(req.params.id);
    if (!kb) {
      return res.status(404).json({ error: `Knowledge base "${req.params.id}" not found` });
    }
    // Get trees from central storage filtered by this KB
    const treesForKB = await fraktag.listTreesForKB(req.params.id);
    const treeIds = treesForKB.map(t => t.id);
    res.json({
      ...kb.toJSON(),
      trees: treeIds
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new knowledge base (simplified - no path needed)
app.post('/api/knowledge-bases', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { name, organizingPrinciple, seedFolders, dogma, path: kbPath } = req.body;
    if (!name || !organizingPrinciple) {
      return res.status(400).json({ error: 'name and organizingPrinciple are required' });
    }

    let kb;
    if (kbPath) {
      // Legacy: explicit path provided
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      kb = await fraktag.createKnowledgeBase(kbPath, {
        id,
        name,
        organizingPrinciple,
        seedFolders,
        dogma
      });
    } else {
      // New: create in storage path (no path needed)
      kb = await fraktag.createKnowledgeBaseInStorage({
        name,
        organizingPrinciple,
        seedFolders,
        dogma
      });
    }

    res.json(kb.toJSON());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Add a tree to a knowledge base
app.post('/api/knowledge-bases/:id/trees', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { treeId, treeName } = req.body;
    if (!treeId) {
      return res.status(400).json({ error: 'treeId is required' });
    }

    await fraktag.addTreeToKnowledgeBase(req.params.id, treeId, treeName);
    res.json({ success: true, kbId: req.params.id, treeId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Export trees to a new portable knowledge base
app.post('/api/knowledge-bases/export', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { treeIds, name, organizingPrinciple } = req.body;
    if (!treeIds || !Array.isArray(treeIds) || treeIds.length === 0) {
      return res.status(400).json({ error: 'treeIds array is required' });
    }
    if (!name || !organizingPrinciple) {
      return res.status(400).json({ error: 'name and organizingPrinciple are required' });
    }

    const result = await fraktag.exportTreesToNewKB(treeIds, {
      name,
      organizingPrinciple
    });

    res.json({
      kb: result.kb.toJSON(),
      stats: result.stats
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Load an existing knowledge base from a path
app.post('/api/knowledge-bases/load', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { path: kbPath } = req.body;
    if (!kbPath) {
      return res.status(400).json({ error: 'path is required' });
    }

    const kb = await fraktag.loadKnowledgeBase(kbPath);
    res.json(kb.toJSON());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ CONVERSATION ENDPOINTS ============

// ============ CONVERSATION ENDPOINTS ============

// List all conversation sessions
app.get('/api/conversations', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const sessions = await fraktag.listConversationSessions();
    res.json(sessions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new conversation session
app.post('/api/conversations', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { title, linkedContext } = req.body;
    if (!linkedContext || !linkedContext.treeIds || linkedContext.treeIds.length === 0) {
      return res.status(400).json({ error: 'linkedContext with treeIds is required' });
    }
    const session = await fraktag.createConversationSession(
      title || '',
      linkedContext
    );
    res.json(session);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get turns in a conversation session
app.get('/api/conversations/:sessionId/turns', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const turns = await fraktag.getConversationTurns(req.params.sessionId);
    res.json(turns);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update a conversation session (title, etc.)
app.patch('/api/conversations/:sessionId', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    await fraktag.updateConversationSession(req.params.sessionId, { title });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a conversation session
app.delete('/api/conversations/:sessionId', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    await fraktag.deleteConversationSession(req.params.sessionId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Streaming chat endpoint
app.post('/api/chat/stream', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });

  const { sessionId, question, treeIds } = req.body;

  if (!sessionId || !question || !treeIds || treeIds.length === 0) {
    return res.status(400).json({
      error: 'sessionId, question, and treeIds are required'
    });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (type: string, data: any) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await fraktag.chat(
        sessionId,
        question,
        treeIds,
        (event) => {
          switch (event.type) {
            case 'source':
              sendEvent('source', event.data);
              break;
            case 'answer_chunk':
              sendEvent('answer_chunk', { text: event.data.text || event.data });
              break;
            case 'done':
              sendEvent('done', event.data);
              break;
            case 'error':
              sendEvent('error', { message: event.data });
              break;
          }
        }
    );
  } catch (e: any) {
    sendEvent('error', { message: e.message || 'Unknown error' });
  } finally {
    res.end();
  }
});

// ============ TREE ENDPOINTS ============

app.get('/api/trees', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const kbId = req.query.kbId as string | undefined;
    const type = req.query.type as 'knowledge' | 'conversation' | undefined;
    let trees;
    if (kbId && kbId !== 'all') {
      trees = await fraktag.listTreesForKB(kbId);
      // Apply type filter on top of KB filter
      if (type) {
        trees = trees.filter(t => (t.type || 'knowledge') === type);
      }
    } else {
      trees = await fraktag.listTrees(type);
    }
    res.json(trees);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new tree in the internal knowledge base
app.post('/api/trees', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { treeId, treeName } = req.body;
    if (!treeId || !treeName) {
      return res.status(400).json({ error: 'treeId and treeName are required' });
    }

    // Check if tree already exists
    const existingTrees = await fraktag.listTrees();
    if (existingTrees.some(t => t.id === treeId)) {
      return res.status(409).json({ error: `Tree "${treeId}" already exists` });
    }

    // Create the tree in internal KB
    await fraktag.createTree(treeId, treeName);
    res.json({ success: true, treeId, treeName });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trees/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const tree = await fraktag.getTree(req.params.id);
    res.json(tree);
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// Update tree config (name, organizing principle)
app.patch('/api/trees/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { name, organizingPrinciple } = req.body;
    if (name === undefined && organizingPrinciple === undefined) {
      return res.status(400).json({ error: 'At least one of name or organizingPrinciple is required' });
    }
    const updates: { name?: string; organizingPrinciple?: string } = {};
    if (name !== undefined) updates.name = name;
    if (organizingPrinciple !== undefined) updates.organizingPrinciple = organizingPrinciple;

    const tree = await fraktag.updateTree(req.params.id, updates);
    res.json(tree);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trees/:id/structure', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    fraktag.clearCache(req.params.id);
    const structure = await fraktag.getFullTree(req.params.id);
    res.json(structure);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trees/:id/visual', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const visual = await fraktag.printTree(req.params.id);
    res.type('text/plain').send(visual);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trees/:id/folders', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const folders = await fraktag.getLeafFolders(req.params.id);
    const tree = await fraktag.getFullTree(req.params.id);

    // Build a lookup map of node id -> node for path building
    // getFullTree returns { config, nodes } where nodes is a flat Record<string, node>
    const nodeMap = new Map<string, { id: string; title: string; parentId: string | null }>();
    for (const node of Object.values(tree.nodes)) {
      nodeMap.set(node.id, { id: node.id, title: node.title, parentId: node.parentId });
    }

    // For each folder, build a human-readable path using titles
    const enrichedFolders = folders.map(folder => {
      const pathParts: string[] = [];
      let currentId: string | null = folder.id;

      while (currentId) {
        const node = nodeMap.get(currentId);
        if (node) {
          pathParts.unshift(node.title);
          currentId = node.parentId;
        } else {
          break;
        }
      }

      // Fallback: if path building failed, use folder title
      if (pathParts.length === 0) {
        pathParts.push(folder.title);
      }

      return {
        id: folder.id,
        title: folder.title,
        gist: folder.gist,
        path: pathParts.join(' > '),
      };
    });

    res.json(enrichedFolders);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ FOLDER OPERATIONS ============

app.post('/api/trees/:id/folders', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { parentId, title, gist } = req.body;
    if (!parentId || !title || !gist) {
      return res.status(400).json({ error: 'parentId, title, and gist are required' });
    }
    const folder = await fraktag.createFolder(req.params.id, parentId, title, gist);
    res.json(folder);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ NODE OPERATIONS ============

// Get node with content (for hydration)
app.get('/api/nodes/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const node = await fraktag.getNodeWithContent(req.params.id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json(node);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update node title and/or gist
app.patch('/api/nodes/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { title, gist } = req.body;
    if (!title && !gist) {
      return res.status(400).json({ error: 'At least one of title or gist is required' });
    }
    const updated = await fraktag.updateNode(req.params.id, { title, gist });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a content node (document or fragment)
app.delete('/api/nodes/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const result = await fraktag.deleteNode(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Move node to new parent
app.patch('/api/nodes/:id/move', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { newParentId } = req.body;
    if (!newParentId) {
      return res.status(400).json({ error: 'newParentId is required' });
    }
    const updated = await fraktag.moveNode(req.params.id, newParentId);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ CONTENT ENDPOINTS ============

app.get('/api/content/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const content = await fraktag.getContent(req.params.id);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    res.json(content);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update editable content payload
app.patch('/api/content/:id', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { payload, nodeId } = req.body;
    if (payload === undefined) {
      return res.status(400).json({ error: 'payload is required' });
    }
    // Pass nodeId to also update vector index
    const updated = await fraktag.updateEditableContent(req.params.id, payload, nodeId);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get content version history
app.get('/api/content/:id/history', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const history = await fraktag.getContentHistory(req.params.id);
    res.json(history);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get latest version of content
app.get('/api/content/:id/latest', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const latest = await fraktag.getLatestContent(req.params.id);
    if (!latest) {
      return res.status(404).json({ error: 'Content not found' });
    }
    res.json(latest);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Replace node content with new version (for readonly content)
app.post('/api/nodes/:id/replace-version', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    const result = await fraktag.replaceContentVersion(req.params.id, content, 'user');
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ FILE PARSING ENDPOINTS ============

// Parse file (PDF, text, etc.) and extract text content
app.post('/api/parse', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { fileName, content } = req.body;
    if (!fileName || !content) {
      return res.status(400).json({ error: 'fileName and content (base64) are required' });
    }

    // Decode base64 content to Buffer
    const buffer = Buffer.from(content, 'base64');

    // Parse the file
    const text = await fraktag.parseFile(fileName, buffer);

    if (text === null) {
      return res.status(400).json({ error: 'Could not parse file. Unsupported format or corrupted content.' });
    }

    res.json({ text, fileName, originalSize: buffer.length, textLength: text.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ INGESTION ENDPOINTS ============

// Analyze content for splits (no ingestion)
app.post('/api/analyze', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { content, sourceUri } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    const analysis = fraktag.analyzeSplits(content, sourceUri || 'unknown');
    res.json(analysis);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Ingest document into specific folder (readonly by default)
app.post('/api/trees/:treeId/documents', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { folderId, content, title, gist, editMode } = req.body;
    if (!folderId || !content || !title) {
      return res.status(400).json({ error: 'folderId, content, and title are required' });
    }
    const doc = await fraktag.ingestDocument(
      content,
      req.params.treeId,
      folderId,
      title,
      gist,
      editMode || 'readonly'
    );
    res.json(doc);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create editable document (user note)
app.post('/api/trees/:treeId/editable-documents', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { folderId, title, content, gist } = req.body;
    if (!folderId || !title) {
      return res.status(400).json({ error: 'folderId and title are required' });
    }
    const doc = await fraktag.createEditableDocument(
      req.params.treeId,
      folderId,
      title,
      content || '',
      gist || ''
    );
    res.json(doc);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create fragment under document
app.post('/api/trees/:treeId/fragments', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { documentId, content, title, gist } = req.body;
    if (!documentId || !content || !title) {
      return res.status(400).json({ error: 'documentId, content, and title are required' });
    }
    const fragment = await fraktag.createFragment(content, req.params.treeId, documentId, title, gist);
    res.json(fragment);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Generate title for content
app.post('/api/generate/title', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { content, treeId } = req.body;
    if (!content || !treeId) {
      return res.status(400).json({ error: 'content and treeId are required' });
    }
    const title = await fraktag.generateTitle(content, treeId);
    res.json({ title });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Generate gist for content
app.post('/api/generate/gist', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { content, treeId } = req.body;
    if (!content || !treeId) {
      return res.status(400).json({ error: 'content and treeId are required' });
    }
    const gist = await fraktag.generateGist(content, treeId);
    res.json({ gist });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// AI-assisted splits for content
app.post('/api/generate/splits', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { content, treeId } = req.body;
    if (!content || !treeId) {
      return res.status(400).json({ error: 'content and treeId are required' });
    }
    const splits = await fraktag.generateAiSplits(content, treeId);
    res.json({ splits });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Propose placement for document
app.post('/api/propose-placement', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { treeId, documentTitle, documentGist } = req.body;
    if (!treeId || !documentTitle) {
      return res.status(400).json({ error: 'treeId and documentTitle are required' });
    }
    const proposal = await fraktag.proposePlacement(treeId, documentTitle, documentGist || '');
    res.json(proposal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ RETRIEVAL ENDPOINTS ============

app.post('/api/retrieve', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { treeId, query, maxDepth, resolution } = req.body;
    if (!treeId || !query) {
      return res.status(400).json({ error: 'treeId and query are required' });
    }
    const result = await fraktag.retrieve({
      treeId,
      query,
      maxDepth: maxDepth || 5,
      resolution: resolution || 'L2'
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ask', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { query, treeId } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    const result = await fraktag.ask(query, treeId || 'notes');
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Streaming ask endpoint using Server-Sent Events
app.post('/api/ask/stream', async (req, res) => {
  if (!fraktag) {
    res.status(503).json({ error: "Engine not ready" });
    return;
  }

  const { query, treeId } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Helper to send SSE events
  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await fraktag.askStream(
      query,
      (treeId as string) || 'notes',
      (event) => {
        switch (event.type) {
          case 'source':
            sendEvent('source', event.data);
            break;
          case 'answer_chunk':
            sendEvent('chunk', { text: event.data });
            break;
          case 'done':
            sendEvent('done', event.data);
            break;
          case 'error':
            sendEvent('error', { message: event.data });
            break;
        }
      }
    );
  } catch (e: any) {
    sendEvent('error', { message: e.message || 'Unknown error' });
  } finally {
    res.end();
  }
});

app.post('/api/browse', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { treeId, nodeId, resolution } = req.body;
    if (!treeId) {
      return res.status(400).json({ error: 'treeId is required' });
    }
    const result = await fraktag.browse({
      treeId,
      nodeId,
      resolution: resolution || 'L0'
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ AUDIT ENDPOINTS ============

// Append audit entries to tree audit log
app.post('/api/trees/:id/audit-log', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { entries, sessionId } = req.body;
    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries array is required' });
    }
    await fraktag.appendAuditBatch(req.params.id, entries, sessionId);
    res.json({ success: true, count: entries.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ MAINTENANCE ENDPOINTS ============

app.post('/api/trees/:id/verify', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const result = await fraktag.verifyTree(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trees/:id/audit', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const result = await fraktag.audit(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trees/:id/reset', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { pruneContent } = req.body;
    await fraktag.reset(req.params.id, { pruneContent });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ START SERVER ============

async function init() {
  try {
    const configPath = findConfig();
    console.log(`📁 Loading config: ${configPath}`);

    fraktag = await Fraktag.fromConfigFile(configPath);
    console.log('✅ Fraktag engine initialized');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 API server running on http://localhost:${PORT}`);
    });
  } catch (e: any) {
    console.error('❌ Failed to start:', e.message);
    process.exit(1);
  }
}

init();
