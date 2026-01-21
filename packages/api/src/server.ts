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
app.use(express.json());

// CONFIGURATION LOADING
const ENV_CONFIG = process.env.FRAKTAG_CONFIG;
// Adjust relative path to point to engine/data/config.json from packages/api/src
const LOCAL_DEV_CONFIG = path.resolve(__dirname, '../../../packages/engine/data/config.json');

let configPath = ENV_CONFIG || LOCAL_DEV_CONFIG;

// Fallback logic for finding config
if (!ENV_CONFIG && !fs.existsSync(configPath)) {
    console.warn(`⚠️  Config not found at: ${configPath}`);
    // Try root relative (assuming running from monorepo root context)
    const rootPath = path.resolve(process.cwd(), 'packages/engine/data/config.json');
    if (fs.existsSync(rootPath)) {
        configPath = rootPath;
    }
}

let fraktag: Fraktag;

async function init() {
    console.log(`🔌 Connecting to Brain Config: ${configPath}`);
    try {
        if (!fs.existsSync(configPath)) {
            throw new Error(`Config file does not exist at ${configPath}`);
        }
        fraktag = await Fraktag.fromConfigFile(configPath);
        console.log('✅ Engine Ready');
    } catch (e) {
        console.error("❌ Failed to initialize Engine:", e);
        // Don't exit process in dev, just log error so we can fix config and restart
    }
}

// --- ENDPOINTS ---

// 1. Get All Trees
app.get('/api/trees', async (req, res) => {
    if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
    try {
        const trees = await fraktag.listTrees();
        res.json(trees);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 2. Get Full Tree Structure (FIXED)
app.get('/api/trees/:id/structure', async (req, res) => {
    if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
    try {
        // OLD: const root = await fraktag.browse(...) <-- Wrong format for UI
        // NEW: Get the raw monolithic state
        const treeDump = await fraktag.getFullTree(req.params.id);
        res.json(treeDump);
    } catch (e: any) {
        res.status(404).json({ error: e.message });
    }
});

// 3. RESTORED: Get Visual Tree (Bash-style)
app.get('/api/trees/:id/visual', async (req, res) => {
    if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
    try {
        const visual = await fraktag.printTree(req.params.id);
        res.send(visual);
    } catch (e: any) {
        res.status(500).send(e.message);
    }
});

// 4. Get Node Content (Raw Payload)
app.get('/api/content/:id', async (req, res) => {
    if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
    try {
        // Direct call to content store via engine wrapper
        const content = await fraktag.getContent(req.params.id);
        if (content) res.json(content);
        else res.status(404).json({ error: "Content not found" });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// 5. Chat/Ask
app.post('/api/ask', async (req, res) => {
    if (!fraktag) return res.status(503).json({ error: "Engine not ready" });
    try {
        const { query, treeId } = req.body;
        const result = await fraktag.ask(query, treeId);
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

init().then(() => {
    app.listen(3000, () => console.log('🚀 API running on http://localhost:3000'));
});
