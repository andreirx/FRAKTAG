#!/usr/bin/env node
// packages/engine/src/cli.ts
// FRAKTAG CLI - Agent-Ready Edition

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { Fraktag } from './index.js';
import { FileProcessor } from './utils/FileProcessor.js';

const COMMAND = process.argv[2];
const ARG1 = process.argv[3];
const ARG2 = process.argv[4];
const ARG3 = process.argv[5];
const ARG4 = process.argv[6];

// Parse flags like --json, --force, --title "My Title"
function parseArgs(args: string[]): { flags: Record<string, boolean>, options: Record<string, string> } {
  const flags: Record<string, boolean> = {};
  const options: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { flags, options };
}

// Global args parsing
const { flags, options } = parseArgs(process.argv.slice(2));
const OUTPUT_JSON = flags.json;

// Helper to print output - JSON for agents, text for humans
function output(data: any, textFallback?: string) {
  if (OUTPUT_JSON) {
    console.log(JSON.stringify(data, null, 2));
  } else if (textFallback) {
    console.log(textFallback);
  } else if (typeof data === 'string') {
    console.log(data);
  }
}

// Log only in non-JSON mode
function log(msg: string) {
  if (!OUTPUT_JSON) console.log(msg);
}

async function findConfig(): Promise<string> {
  // 1. Environment variable
  if (process.env.FRAKTAG_CONFIG) {
    return process.env.FRAKTAG_CONFIG;
  }

  // 2. Local Repo Context (.fraktag/config.json) - for git repo usage
  const localRepoConfig = resolve(process.cwd(), '.fraktag', 'config.json');
  if (existsSync(localRepoConfig)) return localRepoConfig;

  // 3. Current directory data/config.json
  const localConfig = resolve(process.cwd(), 'data', 'config.json');
  if (existsSync(localConfig)) return localConfig;

  // 4. Packages directory (dev mode)
  const devConfig = resolve(process.cwd(), 'packages', 'engine', 'data', 'config.json');
  if (existsSync(devConfig)) return devConfig;

  // 5. Fallback for init command
  return './data/config.json';
}

async function main() {
  if (!COMMAND || COMMAND === 'help' || COMMAND === '--help') {
    console.log(`
FRAKTAG CLI - Agent & Human Interface

USAGE: fkt <command> [args] [--flags]

GLOBAL FLAGS:
  --json             Output as JSON (for agents/scripts)

INITIALIZATION:
  init               Initialize .fraktag/ in current directory
                     Creates a portable KB for git repo documentation

KNOWLEDGE BASE:
  kb list            List all loaded knowledge bases
  kb create <path>   Create a new knowledge base
                     --name "Name" --principle "Organizing principle"
  kb add-tree <kbId> <treeId>
                     Add a new tree to a knowledge base
  kb info <kbId>     Show knowledge base details

TREE MANAGEMENT:
  setup              Initialize trees from config (with seed folders)
  tree [treeId]      Print visual tree structure
  folders [treeId]   List all leaf folders (for ingestion targets)
  stats [treeId]     Show tree statistics

FOLDER OPERATIONS:
  create-folder <treeId> <parentId> <title> <gist>
                     Create a new folder

NODE OPERATIONS (CRUD):
  node get <id>      Get node with its content
  node update <id>   Update node metadata
                     --title "New Title" --gist "New gist"
  node delete <id>   Delete node and its children
  node move <id> <newParentId>
                     Move node to a different parent

CONTENT OPERATIONS:
  content get <id>   Get content atom by ID
  content update <id> <file>
                     Update EDITABLE content from file
  content replace <nodeId> <file>
                     Create new VERSION of readonly content (preserving history)

INGESTION:
  analyze <file>     Analyze file for split points (no ingestion)
  ingest <file> <treeId> <folderId> [title]
                     Ingest file into specific folder

RETRIEVAL:
  retrieve <query> [treeId]
                     Query-driven retrieval (returns matching nodes)
  ask <query> [treeId]
                     RAG synthesis with sources
  browse [treeId] [nodeId]
                     Browse tree structure

MAINTENANCE:
  verify [treeId]    Check tree integrity
  audit [treeId]     AI-powered structure audit
                     --apply to auto-fix issues
  reset [treeId]     Reset tree to empty state
                     --prune to also delete orphaned content

AGENT EXAMPLES:
  # Initialize in a git repo
  cd my-project && fkt init

  # Ingest documentation
  fkt ingest README.md docs root-docs --title "Project Readme"

  # Query as JSON (for agent parsing)
  fkt ask "How do I build this?" docs --json

  # Update living documentation
  fkt content replace <node-id> architecture.md

HUMAN EXAMPLES:
  fkt setup
  fkt kb list
  fkt tree notes
  fkt folders notes
  fkt analyze ./document.pdf
  fkt ingest ./document.pdf notes root-notes "My Document"
  fkt ask "What is the main topic?" notes
`);
    return;
  }

  // Handle INIT before loading engine
  if (COMMAND === 'init') {
    const targetDir = resolve(process.cwd(), '.fraktag');

    if (existsSync(join(targetDir, 'config.json')) && !flags.force) {
      output(
        { error: '.fraktag already exists', hint: 'Use --force to overwrite' },
        '⚠️  .fraktag already exists. Use --force to overwrite.'
      );
      process.exit(1);
    }

    await mkdir(join(targetDir, 'content'), { recursive: true });
    await mkdir(join(targetDir, 'trees'), { recursive: true });
    await mkdir(join(targetDir, 'indexes'), { recursive: true });

    const defaultConfig = {
      instanceId: "local-repo",
      storagePath: ".",
      llm: {
        adapter: "openai",
        model: "gpt-4o-mini",
        basicModel: "gpt-4o-mini",
        expertModel: "gpt-4o",
        apiKey: process.env.OPENAI_API_KEY || "YOUR_KEY_HERE"
      },
      embedding: {
        adapter: "openai",
        model: "text-embedding-3-small",
        apiKey: process.env.OPENAI_API_KEY || "YOUR_KEY_HERE"
      },
      trees: [
        {
          id: "docs",
          name: "Project Documentation",
          organizingPrinciple: "Technical documentation organized by Architecture, API, Guides, and Notes.",
          autoPlace: false,
          seedFolders: [
            { title: "Architecture", gist: "System design, patterns, diagrams, and structure" },
            { title: "API", gist: "API documentation, endpoints, and interfaces" },
            { title: "Guides", gist: "How-to guides, tutorials, and walkthroughs" },
            { title: "Notes", gist: "General notes, observations, and decisions" }
          ]
        }
      ],
      ingestion: {
        splitThreshold: 2000,
        maxDepth: 5,
        chunkOverlap: 100
      }
    };

    await writeFile(join(targetDir, 'config.json'), JSON.stringify(defaultConfig, null, 2));

    output(
      { success: true, path: targetDir, treeId: 'docs' },
      `✅ Initialized FRAKTAG in ${targetDir}\n\n💡 Next steps:\n   1. Set OPENAI_API_KEY in your environment\n   2. Run: fkt setup\n   3. Run: fkt folders docs  (to see where to ingest)\n   4. Run: fkt ingest README.md docs root-docs`
    );
    return;
  }

  // Load Engine
  const configPath = await findConfig();
  log(`📁 Loading: ${configPath}`);

  const fraktag = await Fraktag.fromConfigFile(configPath);
  const processor = new FileProcessor();

  try {
    switch (COMMAND) {
      // ==========================================
      // KNOWLEDGE BASE MANAGEMENT
      // ==========================================
      case 'kb': {
        const subCommand = ARG1;

        switch (subCommand) {
          case 'list': {
            const kbs = fraktag.listKnowledgeBases();
            if (OUTPUT_JSON) {
              output(kbs);
            } else if (kbs.length === 0) {
              console.log('\n📚 No knowledge bases loaded.');
              console.log('   Add "knowledgeBases" to config.json or use "fkt kb create"');
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
            const name = options.name;
            const principle = options.principle;

            if (!kbPath || !name || !principle) {
              output(
                { error: 'Missing arguments', usage: 'fkt kb create <path> --name "Name" --principle "..."' },
                'Usage: fkt kb create <path> --name "Name" --principle "Organizing principle"'
              );
              process.exit(1);
            }

            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const kb = await fraktag.createKnowledgeBase(kbPath, { id, name, organizingPrinciple: principle });

            output(
              kb.toJSON(),
              `✅ Created KB: ${kb.name}\n   ID: ${kb.id}\n   Path: ${kb.path}`
            );
            break;
          }

          case 'add-tree': {
            const kbId = ARG2;
            const treeId = ARG3;
            const treeName = options.name;

            if (!kbId || !treeId) {
              output(
                { error: 'Missing arguments', usage: 'fkt kb add-tree <kbId> <treeId> [--name "..."]' },
                'Usage: fkt kb add-tree <kbId> <treeId> [--name "Tree Name"]'
              );
              process.exit(1);
            }

            await fraktag.addTreeToKnowledgeBase(kbId, treeId, treeName);
            output({ success: true, kbId, treeId }, `✅ Added tree "${treeId}" to KB "${kbId}"`);
            break;
          }

          case 'info': {
            const kbId = ARG2;
            if (!kbId) {
              output({ error: 'KB ID required' }, 'Usage: fkt kb info <kbId>');
              process.exit(1);
            }

            const kb = fraktag.getKnowledgeBase(kbId);
            if (!kb) {
              output({ error: `KB "${kbId}" not found` }, `❌ Knowledge base "${kbId}" not found`);
              process.exit(1);
            }

            const trees = await kb.listTrees();
            const info = { ...kb.toJSON(), trees: trees.map(t => t.id) };

            if (OUTPUT_JSON) {
              output(info);
            } else {
              console.log(`\n📦 ${kb.name} (${kb.id})`);
              console.log(`   Path: ${kb.path}`);
              console.log(`   Principle: ${kb.organizingPrinciple}`);
              console.log(`   Trees: ${trees.map(t => t.id).join(', ') || 'none'}`);
            }
            break;
          }

          default:
            output({ error: `Unknown subcommand: ${subCommand}` }, `Unknown: ${subCommand}. Try: list, create, add-tree, info`);
            process.exit(1);
        }
        break;
      }

      // ==========================================
      // TREE MANAGEMENT
      // ==========================================
      case 'setup': {
        const trees = await fraktag.listTrees();
        const result = [];
        for (const tree of trees) {
          const fullTree = await fraktag.getFullTree(tree.id);
          result.push({ id: tree.id, name: tree.name, nodeCount: Object.keys(fullTree.nodes).length });
        }
        output(result, `🌲 Trees initialized: ${result.map(t => `${t.name} (${t.nodeCount} nodes)`).join(', ')}`);
        break;
      }

      case 'tree': {
        const treeId = ARG1 || 'docs';
        const visual = await fraktag.printTree(treeId);
        output({ treeId, visual }, '\n' + visual);
        break;
      }

      case 'folders': {
        const treeId = ARG1 || 'docs';
        const leafFolders = await fraktag.getLeafFolders(treeId);

        if (OUTPUT_JSON) {
          output(leafFolders);
        } else {
          console.log(`\n📂 Leaf Folders in ${treeId} (${leafFolders.length}):\n`);
          for (const f of leafFolders) {
            console.log(`  [${f.id}] ${f.title}`);
            console.log(`     Gist: ${f.gist}`);
            console.log(`     Path: ${f.path}\n`);
          }
        }
        break;
      }

      case 'stats': {
        const treeId = ARG1 || 'docs';
        const fullTree = await fraktag.getFullTree(treeId);
        const nodes = Object.values(fullTree.nodes);

        let folderCount = 0, docCount = 0, fragCount = 0;
        for (const node of nodes) {
          if ((node as any).type === 'folder') folderCount++;
          else if ((node as any).type === 'document') docCount++;
          else if ((node as any).type === 'fragment') fragCount++;
        }

        const stats = { treeId, totalNodes: nodes.length, folders: folderCount, documents: docCount, fragments: fragCount };
        output(stats, `📊 ${treeId}: ${nodes.length} nodes (${folderCount} folders, ${docCount} docs, ${fragCount} fragments)`);
        break;
      }

      case 'create-folder': {
        if (!ARG1 || !ARG2 || !ARG3 || !ARG4) {
          output({ error: 'Missing arguments' }, 'Usage: fkt create-folder <treeId> <parentId> <title> <gist>');
          process.exit(1);
        }
        const folder = await fraktag.createFolder(ARG1, ARG2, ARG3, ARG4);
        output(folder, `✅ Created folder: ${folder.title} (${folder.id})`);
        break;
      }

      // ==========================================
      // NODE OPERATIONS (CRUD)
      // ==========================================
      case 'node': {
        const sub = ARG1;
        const nodeId = ARG2;

        if (!sub) {
          output({ error: 'Subcommand required' }, 'Usage: fkt node <get|update|delete|move> <id> [args]');
          process.exit(1);
        }

        switch (sub) {
          case 'get': {
            if (!nodeId) {
              output({ error: 'Node ID required' }, 'Usage: fkt node get <id>');
              process.exit(1);
            }
            const node = await fraktag.getNodeWithContent(nodeId);
            if (!node) {
              output({ error: 'Node not found' }, `❌ Node ${nodeId} not found`);
              process.exit(1);
            }
            if (OUTPUT_JSON) {
              output(node);
            } else {
              console.log(`\n📄 ${node.title} (${node.type})`);
              console.log(`   ID: ${node.nodeId}`);
              console.log(`   Path: ${node.path}`);
              console.log(`   Gist: ${node.gist}`);
              if (node.content) {
                console.log(`\n--- Content (${node.content.length} chars) ---\n`);
                console.log(node.content.slice(0, 1000) + (node.content.length > 1000 ? '\n...(truncated)' : ''));
              }
            }
            break;
          }

          case 'update': {
            if (!nodeId) {
              output({ error: 'Node ID required' }, 'Usage: fkt node update <id> --title "..." --gist "..."');
              process.exit(1);
            }
            const title = options.title;
            const gist = options.gist;
            if (!title && !gist) {
              output({ error: 'Provide --title or --gist' }, 'Usage: fkt node update <id> --title "..." --gist "..."');
              process.exit(1);
            }
            const updated = await fraktag.updateNode(nodeId, { title, gist });
            output(updated, `✅ Updated node ${nodeId}`);
            break;
          }

          case 'delete': {
            if (!nodeId) {
              output({ error: 'Node ID required' }, 'Usage: fkt node delete <id>');
              process.exit(1);
            }
            const result = await fraktag.deleteNode(nodeId);
            output(result, `✅ Deleted ${nodeId} (${result.deletedContent.length} content items)`);
            break;
          }

          case 'move': {
            const newParentId = ARG3;
            if (!nodeId || !newParentId) {
              output({ error: 'Node ID and parent ID required' }, 'Usage: fkt node move <id> <newParentId>');
              process.exit(1);
            }
            const moved = await fraktag.moveNode(nodeId, newParentId);
            output(moved, `✅ Moved ${nodeId} to ${newParentId}`);
            break;
          }

          default:
            output({ error: `Unknown subcommand: ${sub}` }, `Unknown: ${sub}. Try: get, update, delete, move`);
            process.exit(1);
        }
        break;
      }

      // ==========================================
      // CONTENT OPERATIONS
      // ==========================================
      case 'content': {
        const sub = ARG1;
        const id = ARG2;

        if (!sub) {
          output({ error: 'Subcommand required' }, 'Usage: fkt content <get|update|replace> <id> [file]');
          process.exit(1);
        }

        switch (sub) {
          case 'get': {
            if (!id) {
              output({ error: 'Content ID required' }, 'Usage: fkt content get <id>');
              process.exit(1);
            }
            const content = await fraktag.getContent(id);
            if (!content) {
              output({ error: 'Content not found' }, `❌ Content ${id} not found`);
              process.exit(1);
            }
            if (OUTPUT_JSON) {
              output(content);
            } else {
              console.log(`\n📝 Content: ${id}`);
              console.log(`   Edit Mode: ${content.editMode || 'readonly'}`);
              console.log(`   Created: ${content.createdAt}`);
              console.log(`\n--- Payload (${content.payload.length} chars) ---\n`);
              console.log(content.payload.slice(0, 2000) + (content.payload.length > 2000 ? '\n...(truncated)' : ''));
            }
            break;
          }

          case 'update': {
            // Update EDITABLE content
            const file = ARG3;
            if (!id || !file) {
              output({ error: 'Content ID and file required' }, 'Usage: fkt content update <contentId> <file>');
              process.exit(1);
            }
            const text = await readFile(resolve(file), 'utf-8');
            const updated = await fraktag.updateEditableContent(id, text);
            output(updated, `✅ Updated content ${id} (${text.length} chars)`);
            break;
          }

          case 'replace': {
            // Create new VERSION for readonly content
            const nodeId = id;
            const file = ARG3;
            if (!nodeId || !file) {
              output({ error: 'Node ID and file required' }, 'Usage: fkt content replace <nodeId> <file>');
              process.exit(1);
            }
            const text = await readFile(resolve(file), 'utf-8');
            const result = await fraktag.replaceContentVersion(nodeId, text, 'cli-agent');
            output(result, `✅ Created new version for ${nodeId}. New content ID: ${result.newContent.id}`);
            break;
          }

          default:
            output({ error: `Unknown subcommand: ${sub}` }, `Unknown: ${sub}. Try: get, update, replace`);
            process.exit(1);
        }
        break;
      }

      // ==========================================
      // INGESTION
      // ==========================================
      case 'analyze': {
        if (!ARG1) {
          output({ error: 'File required' }, 'Usage: fkt analyze <file>');
          process.exit(1);
        }

        const absPath = resolve(ARG1);
        log(`🔍 Analyzing: ${absPath}`);

        const buffer = await readFile(absPath);
        const text = await processor.process(absPath, buffer);

        if (!text) {
          output({ error: 'Could not read file' }, '❌ Could not read file');
          process.exit(1);
        }

        const analysis = fraktag.analyzeSplits(text, absPath);

        if (OUTPUT_JSON) {
          output(analysis);
        } else {
          console.log(`\n📄 Title: ${analysis.suggestedTitle}`);
          console.log(`📏 Length: ${analysis.fullText.length} chars`);
          console.log(`🔪 Method: ${analysis.splitMethod}`);
          console.log(`📑 Splits: ${analysis.detectedSplits.length}`);

          if (analysis.detectedSplits.length > 0) {
            console.log('\n--- Detected Sections ---\n');
            for (let i = 0; i < analysis.detectedSplits.length; i++) {
              const split = analysis.detectedSplits[i];
              console.log(`[${i + 1}] "${split.title}" (${split.text.length} chars)`);
              console.log(`    ${split.text.slice(0, 80).replace(/\n/g, ' ')}...`);
            }
          }
        }
        break;
      }

      case 'ingest': {
        if (!ARG1 || !ARG2 || !ARG3) {
          output(
            { error: 'Missing arguments', usage: 'fkt ingest <file> <treeId> <folderId> [--title "..."]' },
            'Usage: fkt ingest <file> <treeId> <folderId> [--title "..."]\n\nRun "fkt folders <treeId>" to see folder IDs.'
          );
          process.exit(1);
        }

        const filePath = ARG1;
        const treeId = ARG2;
        const folderId = ARG3;
        const customTitle = options.title || ARG4;

        const absPath = resolve(filePath);
        log(`📥 Ingesting: ${absPath}`);

        const buffer = await readFile(absPath);
        const text = await processor.process(absPath, buffer);

        if (!text || text.trim().length === 0) {
          output({ error: 'Could not read file or empty' }, '❌ Could not read file or file is empty');
          process.exit(1);
        }

        const title = customTitle || await fraktag.generateTitle(text, treeId);
        log(`   Title: ${title}`);

        const doc = await fraktag.ingestDocument(text, treeId, folderId, title);

        output(doc, `✅ Ingested: ${doc.title}\n   ID: ${doc.id}\n   Path: ${doc.path}`);
        break;
      }

      // ==========================================
      // RETRIEVAL
      // ==========================================
      case 'retrieve': {
        if (!ARG1) {
          output({ error: 'Query required' }, 'Usage: fkt retrieve <query> [treeId]');
          process.exit(1);
        }
        const query = ARG1;
        const treeId = ARG2 || 'docs';

        const results = await fraktag.retrieve({ treeId, query, maxDepth: 5, resolution: 'L2' });

        if (OUTPUT_JSON) {
          output(results);
        } else {
          console.log(`\n📌 Found ${results.nodes.length} nodes:\n`);
          for (const node of results.nodes) {
            console.log(`[${node.nodeId}] ${node.path}`);
            console.log(`   ${node.content.slice(0, 150).replace(/\n/g, ' ')}...`);
            console.log('');
          }
        }
        break;
      }

      case 'ask': {
        if (!ARG1) {
          output({ error: 'Query required' }, 'Usage: fkt ask <query> [treeId]');
          process.exit(1);
        }
        const query = ARG1;
        const treeId = ARG2 || 'docs';

        const response = await fraktag.ask(query, treeId);

        if (OUTPUT_JSON) {
          output(response);
        } else {
          console.log('\n🔮 Answer:\n');
          console.log(response.answer);
          console.log('\n📚 References:');
          response.references.forEach((ref, i) => console.log(`   [${i + 1}] ${ref}`));
        }
        break;
      }

      case 'browse': {
        const treeId = ARG1 || 'docs';
        const nodeId = ARG2;

        const result = await fraktag.browse({ treeId, nodeId, resolution: 'L0' });

        if (OUTPUT_JSON) {
          output(result);
        } else {
          console.log(`\n📍 ${result.node.title} (${result.node.type})`);
          console.log(`   Path: ${result.node.path}`);
          console.log(`   Gist: ${result.node.gist}`);

          if (result.parent) {
            console.log(`\n⬆️  Parent: ${result.parent.title} (${result.parent.id})`);
          }

          if (result.children.length > 0) {
            console.log(`\n📂 Children (${result.children.length}):`);
            for (const child of result.children) {
              const icon = child.type === 'folder' ? '📂' : child.type === 'document' ? '📄' : '🧩';
              console.log(`   ${icon} ${child.title} (${child.id})`);
            }
          }
        }
        break;
      }

      // ==========================================
      // MAINTENANCE
      // ==========================================
      case 'verify': {
        const treeId = ARG1 || 'docs';
        const result = await fraktag.verifyTree(treeId);

        if (OUTPUT_JSON) {
          output(result);
        } else if (result.valid) {
          console.log(`✅ Tree ${treeId} is valid!`);
        } else {
          console.log(`❌ Tree ${treeId} has issues:`);
          if (result.orphanNodes.length) console.log(`   Orphans: ${result.orphanNodes.join(', ')}`);
          if (result.missingContentRefs.length) console.log(`   Missing refs: ${result.missingContentRefs.join(', ')}`);
          if (result.constraintViolations.length) {
            console.log('   Violations:');
            result.constraintViolations.forEach(v => console.log(`      - ${v}`));
          }
        }
        break;
      }

      case 'audit': {
        const treeId = ARG1 || 'docs';
        const applyFixes = flags.apply;

        log('🌿 Running audit...');
        const report = await fraktag.audit(treeId);

        if (!report.issues || report.issues.length === 0) {
          output({ valid: true, issues: [] }, '✅ Tree looks healthy.');
          break;
        }

        if (OUTPUT_JSON && !applyFixes) {
          output(report);
          break;
        }

        console.log(`\n🌿 Found ${report.issues.length} issues:\n`);
        const operations: any[] = [];

        report.issues.forEach((issue: any, i: number) => {
          const icon = issue.severity === 'HIGH' ? '🔴' : '🟡';
          console.log(`${i + 1}. ${icon} [${issue.type}] ${issue.description}`);
          if (issue.operation) {
            console.log(`   🛠️  Fix: ${issue.operation.action}`);
            operations.push(issue.operation);
          }
        });

        if (operations.length > 0 && applyFixes) {
          console.log('\n🚀 Applying fixes...');
          const applied = [];
          for (const op of operations) {
            const res = await fraktag.applyFix(treeId, op);
            applied.push(res);
            console.log(`   ✅ ${res}`);
          }
          output({ report, applied });
        } else if (operations.length > 0) {
          console.log(`\nTo apply fixes: fkt audit ${treeId} --apply`);
        }
        break;
      }

      case 'reset': {
        const treeId = ARG1 || 'docs';
        const prune = flags.prune;

        log(`⚠️  Resetting tree: ${treeId}${prune ? ' (with prune)' : ''}`);
        await fraktag.reset(treeId, { pruneContent: prune });
        output({ success: true, treeId, pruned: prune }, `✅ Reset ${treeId}`);
        break;
      }

      default:
        output({ error: `Unknown command: ${COMMAND}` }, `Unknown: ${COMMAND}. Run "fkt help" for usage.`);
        process.exit(1);
    }
  } catch (e: any) {
    output({ error: e.message }, `❌ Error: ${e.message}`);
    process.exit(1);
  }
}

main();
