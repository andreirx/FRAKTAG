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

// ============ TREE ENDPOINTS ============

app.get('/api/trees', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const trees = await fraktag.listTrees();
    res.json(trees);
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
    res.json(folders);
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

// Ingest document into specific folder
app.post('/api/trees/:treeId/documents', async (req, res) => {
  if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
  try {
    const { folderId, content, title, gist } = req.body;
    if (!folderId || !content || !title) {
      return res.status(400).json({ error: 'folderId, content, and title are required' });
    }
    const doc = await fraktag.ingestDocument(content, req.params.treeId, folderId, title, gist);
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
