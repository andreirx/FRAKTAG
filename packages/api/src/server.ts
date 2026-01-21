import express from 'express';
import cors from 'cors';
import { Fraktag } from '@fraktag/engine';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Engine (Point to your existing data)
// Adjust path relative to where you run this script
const CONFIG_PATH = path.resolve(__dirname, '../../../packages/engine/data/config.json');

let fraktag: Fraktag;

async function init() {
    console.log(`🔌 Connecting to Brain at: ${CONFIG_PATH}`);
    fraktag = await Fraktag.fromConfigFile(CONFIG_PATH);
    console.log('✅ Engine Ready');
}

// --- ENDPOINTS ---

// 1. Get All Trees
app.get('/api/trees', async (req, res) => {
    const trees = await fraktag.listTrees();
    res.json(trees);
});

app.get('/api/trees/:id/visual', async (req, res) => {
    const visual = await fraktag.printTree(req.params.id);
    res.send(visual); // Send as raw text
});

// 2. Get Full Tree Structure (Recursive)
app.get('/api/trees/:id/structure', async (req, res) => {
    try {
        // We need to expose a method in TreeStore to get the raw JSON structure
        // Or we manually construct it here using public APIs.
        // Let's assume we add a helper or use the internal store via 'any' for the prototype
        // Better: Add `getRawTreeData` to Fraktag class later.
        // For now, let's reconstruct it.

        // Hack: We need the raw nodes to build the visualizer
        // Let's use the public browse method recursively or update the Engine to expose "getTreeNodes"

        // FAST PATH: Read the JSON file directly? No, stick to Engine.
        // Let's stick to the browse API.
        const root = await fraktag.browse({ treeId: req.params.id, resolution: 'L1' });
        res.json(root);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// 3. Get Node Details (Content)
app.get('/api/node/:id', async (req, res) => {
    const content = await fraktag.getContent(req.params.id); // Wait, this gets ContentAtom
    // We actually want the Node Metadata + Content
    // We need to fetch node info from TreeStore first
    // Let's implement a 'getNode' in Fraktag index.ts?
    // For now, let's assume we pass ContentID
    if (content) res.json(content);
    else res.status(404).json({ error: "Content not found" });
});

// 4. Chat/Ask
app.post('/api/ask', async (req, res) => {
    const { query, treeId } = req.body;
    const result = await fraktag.ask(query, treeId);
    res.json(result);
});

init().then(() => {
    app.listen(3000, () => console.log('🚀 API running on http://localhost:3000'));
});
