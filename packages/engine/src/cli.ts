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

// Parse named arguments (--name "value" or --flag)
function parseNamedArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        result[key] = nextArg;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

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

KNOWLEDGE BASE MANAGEMENT:
  kb list            List all loaded knowledge bases
  kb create <path>   Create a new knowledge base
                     --name "Name" --principle "Organizing principle"
  kb add-tree <kbId> <treeId>
                     Add a new tree to a knowledge base
                     --name "Tree Name"
  kb info <kbId>     Show knowledge base details

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
  fkt kb list
  fkt kb create ./my-kb --name "My Knowledge" --principle "Organize by topic"
  fkt kb add-tree my-kb topics --name "Topic Tree"
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
    case 'kb': {
      const subCommand = ARG1;
      const namedArgs = parseNamedArgs(process.argv.slice(4));

      switch (subCommand) {
        case 'list': {
          const kbs = fraktag.listKnowledgeBases();
          if (kbs.length === 0) {
            console.log('\n📚 No knowledge bases loaded.');
            console.log('   Add "knowledgeBases" to your config.json or use "fkt kb create"');
          } else {
            console.log(`\n📚 Knowledge Bases (${kbs.length}):\n`);
            for (const kb of kbs) {
              console.log(`  📦 ${kb.name} (${kb.id})`);
              console.log(`     Path: ${kb.path}`);
              console.log(`     Principle: ${kb.organizingPrinciple.slice(0, 60)}...`);
              console.log('');
            }
          }
          break;
        }

        case 'create': {
          const kbPath = ARG2;
          if (!kbPath) {
            console.error('Usage: fkt kb create <path> --name "Name" --principle "Organizing principle"');
            process.exit(1);
          }

          const name = namedArgs.name as string;
          const principle = namedArgs.principle as string;

          if (!name || !principle) {
            console.error('Both --name and --principle are required');
            console.error('Usage: fkt kb create <path> --name "Name" --principle "Organizing principle"');
            process.exit(1);
          }

          // Generate ID from name
          const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

          const kb = await fraktag.createKnowledgeBase(kbPath, {
            id,
            name,
            organizingPrinciple: principle
          });

          console.log(`\n✅ Created knowledge base: ${kb.name}`);
          console.log(`   ID: ${kb.id}`);
          console.log(`   Path: ${kb.path}`);
          console.log(`   Principle: ${kb.organizingPrinciple}`);
          console.log(`\n💡 Add this to your config.json knowledgeBases array:`);
          console.log(`   { "path": "${kbPath}", "enabled": true }`);
          break;
        }

        case 'add-tree': {
          const kbId = ARG2;
          const treeId = ARG3;

          if (!kbId || !treeId) {
            console.error('Usage: fkt kb add-tree <kbId> <treeId> [--name "Tree Name"]');
            process.exit(1);
          }

          const treeName = namedArgs.name as string | undefined;
          await fraktag.addTreeToKnowledgeBase(kbId, treeId, treeName);

          console.log(`\n✅ Added tree "${treeId}" to knowledge base "${kbId}"`);
          break;
        }

        case 'info': {
          const kbId = ARG2;
          if (!kbId) {
            console.error('Usage: fkt kb info <kbId>');
            process.exit(1);
          }

          const kb = fraktag.getKnowledgeBase(kbId);
          if (!kb) {
            console.error(`Knowledge base "${kbId}" not found`);
            process.exit(1);
          }

          const trees = await kb.listTrees();

          console.log(`\n📦 Knowledge Base: ${kb.name}`);
          console.log(`   ID: ${kb.id}`);
          console.log(`   Path: ${kb.path}`);
          console.log(`   Principle: ${kb.organizingPrinciple}`);
          console.log(`   Default Tree: ${kb.defaultTreeId}`);
          console.log(`\n🌲 Trees (${trees.length}):`);
          for (const treeId of trees) {
            console.log(`   - ${treeId}`);
          }
          break;
        }

        default:
          console.error(`Unknown kb subcommand: ${subCommand}`);
          console.error('Available: list, create, add-tree, info');
          process.exit(1);
      }
      break;
    }

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
