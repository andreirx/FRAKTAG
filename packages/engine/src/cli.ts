#!/usr/bin/env node
import { Fraktag } from './index.js';
import {readFile, readdir, stat, access, writeFile, mkdir} from 'fs/promises';
import {join, resolve} from 'path';
import { FileProcessor } from './utils/FileProcessor.js'; // Import the new processor

const COMMAND = process.argv[2];
const ARG1 = process.argv[3];
const ARG2 = process.argv[4];

async function main() {
    // Load Config
    const fraktag = await Fraktag.fromConfigFile('./data/config.json');
    const processor = new FileProcessor();

    switch (COMMAND) {
        case 'setup':
            console.log('Initializing Trees...');
            // Just loading the config initializes the trees defined in it
            console.log('Done.');
            break;

        case 'init':
            const targetDir = resolve(process.cwd(), '.fraktag');

            // 1. Create Structure
            await mkdir(join(targetDir, 'content'), { recursive: true });
            await mkdir(join(targetDir, 'trees'), { recursive: true });
            await mkdir(join(targetDir, 'indexes'), { recursive: true });

            // 2. Create Default Config (Safe for Git)
            const defaultConfig = {
                instanceId: "local-repo",
                storagePath: ".", // Relative to config.json, so it points to .fraktag/
                llm: {
                    adapter: "openai", // or ollama
                    model: "gpt-4o",
                    basicModel: "gpt-4o-mini",
                    // NO API KEY HERE - Use Env Vars
                },
                trees: [
                    {
                        id: "project",
                        name: "Project Knowledge",
                        organizingPrinciple: "Organize by Module, Feature, and Architecture Layer.",
                        autoPlace: true,
                        dogma: { strictness: "strict" }
                    }
                ],
                ingestion: {
                    splitThreshold: 1500,
                    maxDepth: 5,
                    chunkOverlap: 100
                }
            };

            const configPath = join(targetDir, 'config.json');

            // Check if exists
            try {
                await access(configPath);
                console.log('⚠️  .fraktag/config.json already exists. Skipping overwrite.');
            } catch {
                await writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
                console.log('✅ Created .fraktag/config.json');
            }

            console.log('\nFractal Brain initialized in .fraktag/');
            console.log('👉 Tip: Add .env to .gitignore and put FRAKTAG_OPENAI_KEY=... there.');
            break;

        case 'ingest-file':
            if (!ARG1) throw new Error('Usage: ingest-file <path> [treeId]');
            await handleIngest(fraktag, processor, ARG1, ARG2);
            break;

        case 'ingest-dir':
            if (!ARG1) throw new Error('Usage: ingest-dir <path> [treeId]');
            const files = await readdir(ARG1);
            for (const f of files) {
                if (f.startsWith('.')) continue;
                const path = join(ARG1, f);
                if ((await stat(path)).isDirectory()) continue;

                await handleIngest(fraktag, processor, path, ARG2);
            }
            console.log('Batch ingestion complete.');
            break;

        case 'browse':
            const treeId = ARG1 || 'default';
            const root = await fraktag.browse({ treeId, resolution: 'L1' });
            printTree(root, 0);
            break;

        case 'retrieve':
            if (!ARG1) throw new Error('Usage: retrieve <query> [treeId]');
            const query = ARG1;
            const searchTreeId = ARG2 || 'notes';

            const results = await fraktag.retrieve({
                treeId: searchTreeId,
                query: query,
                maxDepth: 5,
                resolution: 'L2' // We want high fidelity content
            });

            console.log('\n=========================================');
            console.log(`RESULTS FOR: "${query}"`);
            console.log('=========================================');

            results.nodes.forEach((res, i) => {
                console.log(`\n[Result ${i+1}] Path: ${res.path}`);
                console.log('-----------------------------------------');
                console.log(res.content.trim());
            });
            break;

        case 'ask':
            if (!ARG1) throw new Error('Usage: ask <query> [treeId]');
            const q = ARG1;
            const tId = ARG2 || 'notes';

            const response = await fraktag.ask(q, tId);

            console.log('\n=========================================');
            console.log('🤖 ORACLE ANSWER');
            console.log('=========================================\n');
            console.log(response.answer);
            console.log('\n-----------------------------------------');
            console.log('📚 References:', response.references.length);
            break;

        case 'verify':
            const vId = ARG1 || 'default';
            const res = await fraktag.verifyTree(vId);
            console.log(res);
            break;

        case 'tree':
            const tIdTree = ARG1 || 'notes';
            console.log(await fraktag.printTree(tIdTree));
            break;

        case 'audit':
            const tIdAudit = ARG1 || 'notes';
            const applyFlag = process.argv.includes('--apply');

            console.log('Running Audit...');
            const report = await fraktag.audit(tIdAudit);

            if (!report.issues || report.issues.length === 0) {
                console.log("✅ The tree looks healthy.");
                break;
            }

            console.log('\n=========================================');
            console.log(`🌿 GARDENER FOUND ${report.issues.length} ISSUES`);
            console.log('=========================================\n');

            const operations: any[] = [];

            report.issues.forEach((issue: any, index: number) => {
                const icon = issue.severity === 'HIGH' ? '🔴' : '🟡';
                console.log(`${index + 1}. ${icon} [${issue.type}] ${issue.description}`);
                if (issue.operation) {
                    console.log(`   🛠️  Proposed Action: ${issue.operation.action}`);
                    if (issue.operation.newParentName) console.log(`       -> Create Parent: "${issue.operation.newParentName}"`);
                    if (issue.operation.newName) console.log(`       -> Rename to: "${issue.operation.newName}"`);
                    if (issue.operation.newParentId) console.log(`       -> Move to Parent ID: "${issue.operation.newParentId}"`);

                    operations.push(issue.operation);
                }
                console.log('');
            });

            if (operations.length === 0) break;

            if (applyFlag) {
                console.log('🚀 Auto-applying fixes (--apply)...');
                for (const op of operations) {
                    const res = await fraktag.applyFix(tIdAudit, op);
                    console.log(`   ✅ ${res}`);
                }
            } else {
                console.log('\nTo apply these fixes, run:');
                console.log(`fkt audit ${tIdAudit} --apply`);
                // Alternatively, implement interactive readline here if you prefer
            }
            break;

        case 'reset':
            if (!ARG1) throw new Error('Usage: reset <treeId> [--prune]');
            const treeToReset = ARG1;
            const prune = process.argv.includes('--prune');

            await fraktag.reset(treeToReset, { pruneContent: prune });
            break;


        default:
            console.log('Commands: \n  setup, \n  init,  \n  ingest-file <file>, \n  ingest-dir <dir>, \n  browse <treeId>, \n  retrieve "topic" <treeId>, \n  ask "question" <treeId>, \n  verify <treeId>, \n  tree <treeId>, \n  audit <treeId> [--apply], \n  reset <treeId> [--prune]');
    }
}

// Helper to DRY up file/dir ingestion logic
async function handleIngest(fraktag: Fraktag, processor: FileProcessor, filePath: string, treeId?: string) {
    try {
        console.log(`Processing ${filePath}...`);

        // 1. Read as Binary Buffer
        const buffer = await readFile(filePath);

        // 2. Convert to Text (or null if binary/unsupported)
        const text = await processor.process(filePath, buffer);

        if (!text) {
            console.log(`   ⏭️  Skipped (Binary or Unsupported)`);
            return;
        }

        if (text.trim().length === 0) {
            console.log(`   ⏭️  Skipped (Empty)`);
            return;
        }

        // 3. Ingest Text
        const result = await fraktag.upsert({
            content: text,
            externalId: filePath,
            sourceUri: filePath,
            targetTrees: treeId ? [treeId] : undefined
        });

        console.log(`   ✅ Ingested. Placements: ${result.placements.length}`);
    } catch (e) {
        console.error(`   ❌ Failed to ingest ${filePath}:`, e);
    }
}

function printTree(nodeResult: any, depth: number) {
    const indent = '  '.repeat(depth);
    console.log(`${indent}📂 ${nodeResult.node.gist} (${nodeResult.node.id})`);
    if (nodeResult.node.summary) console.log(`${indent}   📝 ${nodeResult.node.summary.slice(0, 50)}...`);

    if (nodeResult.children) {
        for (const child of nodeResult.children) {
            console.log(`${indent}  - ${child.gist} (${child.id})`);
        }
    }
}

main().catch(console.error);
