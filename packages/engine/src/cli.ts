#!/usr/bin/env node
// packages/engine/src/cli.ts
// FRAKTAG CLI - Strict Taxonomy Edition

import { readFile, readdir, stat, access, writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { Fraktag } from './index.js';
import { FileProcessor } from './utils/FileProcessor.js';

const COMMAND = process.argv[2];
const ARG1 = process.argv[3];
const ARG2 = process.argv[4];
const ARG3 = process.argv[5];
const ARG4 = process.argv[6];

async function findConfig(): Promise<string> {
  // 1. Environment variable
  if (process.env.FRAKTAG_CONFIG) {
    return process.env.FRAKTAG_CONFIG;
  }

  // 2. Current directory data/config.json
  const localConfig = resolve(process.cwd(), 'data', 'config.json');
  if (existsSync(localConfig)) return localConfig;

  // 3. Packages directory (dev mode)
  const devConfig = resolve(process.cwd(), 'packages', 'engine', 'data', 'config.json');
  if (existsSync(devConfig)) return devConfig;

  // 4. Fallback
  return './data/config.json';
}

async function main() {
  if (!COMMAND || COMMAND === 'help' || COMMAND === '--help') {
    console.log(`
FRAKTAG CLI - Strict Taxonomy Edition

TREE MANAGEMENT:
  setup              Initialize trees from config (with seed folders)
  tree [treeId]      Print visual tree structure
  folders [treeId]   List all leaf folders (where documents can be placed)
  stats [treeId]     Show tree statistics

FOLDER OPERATIONS:
  create-folder <treeId> <parentId> <title> <gist>
                     Create a new folder

INGESTION (Human-Assisted):
  analyze <file>     Analyze file for split points (no ingestion)
  ingest <file> <treeId> <folderId> [title]
                     Ingest file into specific folder

RETRIEVAL:
  retrieve <query> [treeId]
                     Query-driven retrieval
  ask <query> [treeId]
                     RAG synthesis with sources
  browse [treeId] [nodeId]
                     Browse tree structure

MAINTENANCE:
  verify [treeId]    Check tree integrity
  audit [treeId]     AI-powered structure audit
  reset [treeId] [--prune]
                     Reset tree to empty state

Examples:
  fkt setup
  fkt tree notes
  fkt folders notes
  fkt analyze ./document.pdf
  fkt ingest ./document.pdf notes root-notes-general "My Document"
  fkt ask "What is the main topic?" notes
`);
    return;
  }

  const configPath = await findConfig();
  console.log(`📁 Config: ${configPath}`);

  // Handle init before loading fraktag
  if (COMMAND === 'init') {
    const targetDir = resolve(process.cwd(), '.fraktag');

    await mkdir(join(targetDir, 'content'), { recursive: true });
    await mkdir(join(targetDir, 'trees'), { recursive: true });
    await mkdir(join(targetDir, 'indexes'), { recursive: true });

    const defaultConfig = {
      instanceId: "local-repo",
      storagePath: ".",
      llm: {
        adapter: "openai",
        model: "gpt-4o",
        basicModel: "gpt-4o-mini",
      },
      trees: [
        {
          id: "project",
          name: "Project Knowledge",
          organizingPrinciple: "Organize by Module, Feature, and Architecture Layer.",
          autoPlace: false,
          seedFolders: [
            { title: "Architecture", gist: "System design, patterns, and structure" },
            { title: "Features", gist: "Feature specifications and implementations" },
            { title: "API", gist: "API documentation and endpoints" },
            { title: "Notes", gist: "General notes and observations" }
          ]
        }
      ],
      ingestion: {
        splitThreshold: 1500,
        maxDepth: 5,
        chunkOverlap: 100
      }
    };

    const confPath = join(targetDir, 'config.json');

    try {
      await access(confPath);
      console.log('⚠️  .fraktag/config.json already exists. Skipping overwrite.');
    } catch {
      await writeFile(confPath, JSON.stringify(defaultConfig, null, 2));
      console.log('✅ Created .fraktag/config.json');
    }

    console.log('\nFractal Brain initialized in .fraktag/');
    console.log('👉 Tip: Set FRAKTAG_OPENAI_KEY in your environment.');
    return;
  }

  // Load Fraktag for all other commands
  const fraktag = await Fraktag.fromConfigFile(configPath);
  const processor = new FileProcessor();

  switch (COMMAND) {
    case 'setup': {
      const trees = await fraktag.listTrees();
      console.log(`\n🌲 Trees initialized: ${trees.length}`);
      for (const tree of trees) {
        const fullTree = await fraktag.getFullTree(tree.id);
        const nodeCount = Object.keys(fullTree.nodes).length;
        console.log(`   - ${tree.name} (${tree.id}): ${nodeCount} nodes`);
      }
      break;
    }

    case 'tree': {
      const treeId = ARG1 || 'notes';
      const visual = await fraktag.printTree(treeId);
      console.log('\n' + visual);
      break;
    }

    case 'folders': {
      const treeId = ARG1 || 'notes';
      const leafFolders = await fraktag.getLeafFolders(treeId);
      console.log(`\n📂 Leaf Folders in ${treeId} (${leafFolders.length} total):\n`);
      for (const folder of leafFolders) {
        console.log(`  ID: ${folder.id}`);
        console.log(`  Title: ${folder.title}`);
        console.log(`  Gist: ${folder.gist}`);
        console.log(`  Path: ${folder.path}`);
        console.log('');
      }
      break;
    }

    case 'stats': {
      const treeId = ARG1 || 'notes';
      const fullTree = await fraktag.getFullTree(treeId);
      const nodes = Object.values(fullTree.nodes);

      let folderCount = 0, docCount = 0, fragCount = 0;
      for (const node of nodes) {
        if ((node as any).type === 'folder') folderCount++;
        else if ((node as any).type === 'document') docCount++;
        else if ((node as any).type === 'fragment') fragCount++;
      }

      console.log(`\n📊 Tree Stats for ${treeId}:`);
      console.log(`   Total Nodes: ${nodes.length}`);
      console.log(`   Folders: ${folderCount}`);
      console.log(`   Documents: ${docCount}`);
      console.log(`   Fragments: ${fragCount}`);
      break;
    }

    case 'create-folder': {
      if (!ARG1 || !ARG2 || !ARG3 || !ARG4) {
        console.error('Usage: fkt create-folder <treeId> <parentId> <title> <gist>');
        process.exit(1);
      }
      const folder = await fraktag.createFolder(ARG1, ARG2, ARG3, ARG4);
      console.log(`\n✅ Created folder: ${folder.id}`);
      console.log(`   Title: ${folder.title}`);
      console.log(`   Path: ${folder.path}`);
      break;
    }

    case 'analyze': {
      if (!ARG1) {
        console.error('Usage: fkt analyze <file>');
        process.exit(1);
      }

      const absPath = resolve(ARG1);
      console.log(`\n🔍 Analyzing: ${absPath}`);

      const buffer = await readFile(absPath);
      const text = await processor.process(absPath, buffer);

      if (!text) {
        console.error('❌ Could not read file');
        process.exit(1);
      }

      const analysis = fraktag.analyzeSplits(text, absPath);

      console.log(`\n📄 Suggested Title: ${analysis.suggestedTitle}`);
      console.log(`📏 Total Length: ${analysis.fullText.length} chars`);
      console.log(`🔪 Split Method: ${analysis.splitMethod}`);
      console.log(`📑 Detected Splits: ${analysis.detectedSplits.length}`);

      if (analysis.detectedSplits.length > 0) {
        console.log('\n--- Detected Sections ---\n');
        for (let i = 0; i < analysis.detectedSplits.length; i++) {
          const split = analysis.detectedSplits[i];
          console.log(`[${i + 1}] "${split.title}" (${split.text.length} chars, confidence: ${split.confidence.toFixed(2)})`);
          console.log(`    Preview: ${split.text.slice(0, 100).replace(/\n/g, ' ')}...`);
          console.log('');
        }
      }
      break;
    }

    case 'ingest': {
      if (!ARG1 || !ARG2 || !ARG3) {
        console.error('Usage: fkt ingest <file> <treeId> <folderId> [title]');
        console.error('\nFirst run "fkt folders <treeId>" to see available folder IDs.');
        process.exit(1);
      }

      const filePath = ARG1;
      const treeId = ARG2;
      const folderId = ARG3;
      const customTitle = ARG4;

      const absPath = resolve(filePath);
      console.log(`\n📥 Ingesting: ${absPath}`);
      console.log(`   Tree: ${treeId}`);
      console.log(`   Folder: ${folderId}`);

      const buffer = await readFile(absPath);
      const text = await processor.process(absPath, buffer);

      if (!text || text.trim().length === 0) {
        console.error('❌ Could not read file or file is empty');
        process.exit(1);
      }

      const title = customTitle || await fraktag.generateTitle(text, treeId);
      console.log(`   Title: ${title}`);

      const doc = await fraktag.ingestDocument(text, treeId, folderId, title);

      console.log(`\n✅ Document created:`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Path: ${doc.path}`);
      console.log(`   Gist: ${doc.gist.slice(0, 100)}...`);
      break;
    }

    // Legacy command - deprecated
    case 'ingest-file': {
      console.warn('⚠️  ingest-file is deprecated. Use: fkt ingest <file> <treeId> <folderId>');
      if (!ARG1) throw new Error('Usage: ingest-file <path> [treeId]');
      const buffer = await readFile(resolve(ARG1));
      const text = await processor.process(ARG1, buffer);
      if (!text) {
        console.log('   ⏭️  Skipped (Binary or Unsupported)');
        break;
      }
      const result = await fraktag.ingest({
        content: text,
        sourceUri: ARG1,
        targetTrees: ARG2 ? [ARG2] : undefined
      });
      console.log(`   ✅ Ingested. Placements: ${result.placements.length}`);
      break;
    }

    case 'retrieve': {
      if (!ARG1) {
        console.error('Usage: fkt retrieve <query> [treeId]');
        process.exit(1);
      }
      const query = ARG1;
      const treeId = ARG2 || 'notes';

      const results = await fraktag.retrieve({
        treeId,
        query,
        maxDepth: 5,
        resolution: 'L2'
      });

      console.log(`\n📌 Found ${results.nodes.length} relevant nodes:\n`);
      for (const node of results.nodes) {
        console.log(`[${node.nodeId}] ${node.path}`);
        console.log(`   ${node.content.slice(0, 200)}...`);
        console.log('');
      }
      break;
    }

    case 'ask': {
      if (!ARG1) {
        console.error('Usage: fkt ask <query> [treeId]');
        process.exit(1);
      }
      const query = ARG1;
      const treeId = ARG2 || 'notes';

      const response = await fraktag.ask(query, treeId);

      console.log('\n🔮 Answer:\n');
      console.log(response.answer);
      console.log('\n📚 References:');
      response.references.forEach((ref, i) => console.log(`   [${i + 1}] ${ref}`));
      break;
    }

    case 'browse': {
      const treeId = ARG1 || 'notes';
      const nodeId = ARG2;

      const result = await fraktag.browse({ treeId, nodeId, resolution: 'L0' });

      console.log(`\n📍 Current: ${result.node.title} (${result.node.type})`);
      console.log(`   Path: ${result.node.path}`);
      console.log(`   Gist: ${result.node.gist}`);

      if (result.parent) {
        console.log(`\n⬆️  Parent: ${result.parent.title} (${result.parent.id})`);
      }

      if (result.children.length > 0) {
        console.log(`\n📂 Children (${result.children.length}):`);
        for (const child of result.children) {
          const icon = child.type === 'folder' ? '📂' : (child.type === 'document' ? '📄' : '🧩');
          console.log(`   ${icon} ${child.title} (${child.id})`);
        }
      }
      break;
    }

    case 'verify': {
      const treeId = ARG1 || 'notes';
      const result = await fraktag.verifyTree(treeId);

      if (result.valid) {
        console.log(`\n✅ Tree ${treeId} is valid!`);
      } else {
        console.log(`\n❌ Tree ${treeId} has issues:`);
        if (result.orphanNodes.length > 0) {
          console.log(`   Orphan nodes: ${result.orphanNodes.join(', ')}`);
        }
        if (result.missingContentRefs.length > 0) {
          console.log(`   Missing content refs: ${result.missingContentRefs.join(', ')}`);
        }
        if (result.constraintViolations.length > 0) {
          console.log(`   Constraint violations:`);
          result.constraintViolations.forEach(v => console.log(`      - ${v}`));
        }
        if (result.errors.length > 0) {
          console.log(`   Errors: ${result.errors.join(', ')}`);
        }
      }
      break;
    }

    case 'audit': {
      const treeId = ARG1 || 'notes';
      const applyFlag = process.argv.includes('--apply');

      console.log('Running Audit...');
      const report = await fraktag.audit(treeId);

      if (!report.issues || report.issues.length === 0) {
        console.log('✅ The tree looks healthy.');
        break;
      }

      console.log(`\n🌿 GARDENER FOUND ${report.issues.length} ISSUES\n`);

      const operations: any[] = [];

      report.issues.forEach((issue: any, index: number) => {
        const icon = issue.severity === 'HIGH' ? '🔴' : '🟡';
        console.log(`${index + 1}. ${icon} [${issue.type}] ${issue.description}`);
        if (issue.operation) {
          console.log(`   🛠️  Proposed: ${issue.operation.action}`);
          operations.push(issue.operation);
        }
        console.log('');
      });

      if (operations.length > 0 && applyFlag) {
        console.log('🚀 Auto-applying fixes...');
        for (const op of operations) {
          const res = await fraktag.applyFix(treeId, op);
          console.log(`   ✅ ${res}`);
        }
      } else if (operations.length > 0) {
        console.log('\nTo apply fixes, run:');
        console.log(`fkt audit ${treeId} --apply`);
      }
      break;
    }

    case 'reset': {
      const treeId = ARG1 || 'notes';
      const prune = process.argv.includes('--prune');

      console.log(`\n⚠️  Resetting tree: ${treeId}${prune ? ' (with content prune)' : ''}`);
      await fraktag.reset(treeId, { pruneContent: prune });
      break;
    }

    default:
      console.error(`Unknown command: ${COMMAND}`);
      console.error('Run "fkt help" for usage.');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
