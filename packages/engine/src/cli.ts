// packages/engine/src/cli.ts

import { Fraktag } from './index.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

const COMMAND = process.argv[2];
const ARG1 = process.argv[3];
const ARG2 = process.argv[4];

async function main() {
    // Load Config
    const fraktag = await Fraktag.fromConfigFile('./data/config.json');

    switch (COMMAND) {
        case 'setup':
            console.log('Initializing Trees...');
            // Just loading the config initializes the trees defined in it
            console.log('Done.');
            break;

        case 'ingest-file':
            if (!ARG1) throw new Error('Usage: ingest-file <path> [treeId]');
            const content = await readFile(ARG1, 'utf-8');
            console.log(`Ingesting ${ARG1}...`);
            const result = await fraktag.upsert({
                content,
                externalId: ARG1, // Use filepath as ID
                sourceUri: ARG1,
                targetTrees: ARG2 ? [ARG2] : undefined
            });
            console.log('Placements:', JSON.stringify(result.placements, null, 2));
            break;

        case 'ingest-dir':
            if (!ARG1) throw new Error('Usage: ingest-dir <path> [treeId]');
            const files = await readdir(ARG1);
            for (const f of files) {
                if (f.startsWith('.')) continue;
                const path = join(ARG1, f);
                if ((await stat(path)).isDirectory()) continue;

                console.log(`Processing ${f}...`);
                const txt = await readFile(path, 'utf-8');
                await fraktag.upsert({
                    content: txt,
                    externalId: path,
                    sourceUri: path,
                    targetTrees: ARG2 ? [ARG2] : undefined
                });
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

        default:
            console.log('Commands: setup, ingest-file <file>, ingest-dir <dir>, browse <treeId>, verify <treeId>');
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
