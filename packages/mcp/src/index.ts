#!/usr/bin/env node

/**
 * @fraktag/mcp — MCP Server for Claude Code Integration
 *
 * Exposes FRAKTAG knowledge trees as MCP tools so Claude Code
 * can search, browse, and ingest knowledge dynamically.
 *
 * Tools:
 *   fraktag_search       — Retrieve relevant sources for a query
 *   fraktag_ask          — RAG synthesis with sources
 *   fraktag_ingest       — Create a document in a target folder
 *   fraktag_list_trees   — List available knowledge trees
 *   fraktag_browse       — Browse tree structure (folders, children)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Fraktag } from "@fraktag/engine";
import path from "path";
import fs from "fs";

// ============ ENGINE INITIALIZATION ============

const log = (...args: unknown[]) => console.error("[fraktag-mcp]", ...args);

function resolveConfig(): string {
  // 1. Explicit env var
  if (process.env.FRAKTAG_CONFIG && fs.existsSync(process.env.FRAKTAG_CONFIG)) {
    return process.env.FRAKTAG_CONFIG;
  }

  // 2. .fraktag/config.json in cwd
  const local = path.join(process.cwd(), ".fraktag", "config.json");
  if (fs.existsSync(local)) return local;

  // 3. Standard dev path
  const dev = path.join(process.cwd(), "packages", "engine", "data", "config.json");
  if (fs.existsSync(dev)) return dev;

  log("No config found. Set FRAKTAG_CONFIG or place config.json in .fraktag/ or packages/engine/data/");
  process.exit(1);
}

const configPath = resolveConfig();
log(`Loading config from ${configPath}`);

let fraktag: Fraktag;
try {
  fraktag = await Fraktag.fromConfigFile(configPath);
  log("Engine initialized");
} catch (e: any) {
  log(`Failed to initialize engine: ${e.message}`);
  process.exit(1);
}

// ============ MCP SERVER ============

const server = new Server(
  { name: "fraktag-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ LIST TOOLS ============

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "fraktag_search",
        description:
          `Search the Repository Memory for relevant context. This uses the full AI-powered retrieval pipeline (vector + map scan + drill). Use this BEFORE writing code to check for:
1. Existing architectural decisions in /Architecture (don't contradict them).
2. Known bugs or gotchas in /Learnings (don't repeat past mistakes).
3. Coding standards in /Patterns (match existing style).
4. Operational procedures in /Operational (follow established workflows).

Returns fully resolved source content. For lower-level control, use fraktag_vector_search + fraktag_tree_map + fraktag_get_node instead.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "The search query (e.g., 'authentication patterns', 'error handling rules')",
            },
            treeId: {
              type: "string",
              description:
                "Optional: specific tree ID to search. Omit to search the default tree. Use fraktag_list_trees to see available trees.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "fraktag_ask",
        description:
          `Ask a question and get a synthesized answer with source references. Uses RAG (retrieval + LLM synthesis) to generate a coherent response grounded in the Repository Memory.

Good for quick factual lookups: "What authentication method does this project use?", "What was the root cause of the checkout bug?".
For deeper exploration or multi-step reasoning, prefer the raw tools (fraktag_vector_search + fraktag_tree_map + fraktag_get_node) where YOU control the retrieval strategy.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "The question to answer",
            },
            treeId: {
              type: "string",
              description: "Optional: specific tree ID. Defaults to first knowledge tree.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "fraktag_ingest",
        description:
          `Save a new document to the Repository Memory. The content will be vector-indexed for future retrieval. Use this to persist learnings, decisions, patterns, and operational knowledge.

ORGANIZING PRINCIPLE — Choose the right targetFolder:
- "/Architecture"  → High-level system design decisions, component boundaries, data flow, technology choices.
- "/Patterns"      → Reusable code patterns, style guides, idioms, naming conventions.
- "/Learnings"     → Post-mortems, bug root causes, "lessons learned", things that surprised you.
- "/Operational"   → Scripts, deployment procedures, configuration guides, environment setup.

You can use deeper paths like "/Patterns/React/Hooks" or "/Learnings/Debugging". Missing intermediate folders will be created automatically.

WHEN TO INGEST:
- After fixing a tricky bug → save the root cause and fix to /Learnings
- After making an architectural decision → save the rationale to /Architecture
- After discovering a useful pattern → save it to /Patterns
- After writing operational scripts → document them in /Operational

Write content in markdown. Include enough context that future retrieval will be useful: what was the problem, what was tried, what worked, why.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            title: {
              type: "string",
              description: "Document title — clear and searchable (e.g., 'React Query Cache Invalidation Pattern', 'Why we chose PostgreSQL over MongoDB')",
            },
            content: {
              type: "string",
              description: "Full content in markdown. Include context, reasoning, code examples where relevant.",
            },
            gist: {
              type: "string",
              description: "One-sentence summary for the AI index (e.g., 'Cache invalidation strategy using query keys with entity IDs')",
            },
            treeId: {
              type: "string",
              description: "Target tree ID (use fraktag_list_trees to find)",
            },
            targetFolder: {
              type: "string",
              description:
                "Target folder path (e.g., '/Learnings/Debugging', '/Architecture/Auth') or a folder UUID. Missing intermediate folders are created automatically.",
            },
          },
          required: ["title", "content", "gist", "treeId", "targetFolder"],
        },
      },
      {
        name: "fraktag_list_trees",
        description:
          "List all available knowledge trees with their IDs, names, and organizing principles. Call this first if you don't know the treeId — all other tools require it.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "fraktag_browse",
        description:
          `Browse the tree structure. Without a nodeId, lists all leaf folders (valid ingestion targets with their paths). With a nodeId, shows that node's children, parent, and gist.

Use this to:
1. Discover existing folder paths before ingesting (avoid duplicates).
2. Navigate the tree to find where specific knowledge lives.
3. Verify the taxonomy structure (Architecture/Patterns/Learnings/Operational).`,
        inputSchema: {
          type: "object" as const,
          properties: {
            treeId: {
              type: "string",
              description: "The tree ID to browse",
            },
            nodeId: {
              type: "string",
              description:
                "Optional: specific node ID to browse children of. Omit to list all leaf folders.",
            },
          },
          required: ["treeId"],
        },
      },

      // ============ RAW TOOLS (No LLM — Claude IS the brain) ============

      {
        name: "fraktag_vector_search",
        description: `Raw vector similarity search — returns candidate node IDs with cosine similarity scores. NO LLM is used. YOU are the Scout.

The tree is organized into: /Architecture, /Patterns, /Learnings, /Operational (and their sub-folders). Results will include paths so you can see which category each hit belongs to.

After receiving results, assess each candidate:
- Look at each node's title, gist, and path context.
- Be strict: only select nodes that are clearly relevant to your quest.
- /Architecture hits → design decisions, don't contradict them.
- /Patterns hits → existing conventions, follow them.
- /Learnings hits → past mistakes, don't repeat them.
- /Operational hits → established procedures, respect them.
- Discard low-score results (below ~0.25) unless the title/gist is clearly relevant.

Use fraktag_get_node to fetch full content for promising candidates. Use fraktag_tree_map to get the structural overview if vector results are insufficient.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "The search query to embed and match against the vector index",
            },
            treeId: {
              type: "string",
              description: "The tree ID to search",
            },
            topK: {
              type: "number",
              description: "Number of results to return (default: 10)",
            },
          },
          required: ["query", "treeId"],
        },
      },
      {
        name: "fraktag_tree_map",
        description: `Get the full "Table of Contents" for a knowledge tree — the structural map of all nodes with their IDs, types, titles, and gists. NO LLM is used. YOU are the Strategist.

The top-level structure follows the Organizing Principle:
  /Architecture — system design, component boundaries, technology choices
  /Patterns     — code conventions, style guides, reusable idioms
  /Learnings    — post-mortems, bug fixes, lessons learned
  /Operational  — scripts, deployment, configuration

After receiving the map, scan it to identify retrieval targets:
1. Scan the map for topics relevant to your quest.
2. Select specific Node IDs that are likely to contain the answer.
3. Prefer deeper nodes (leaves / sub-categories) over generic root nodes.
4. Select up to 5 most promising targets.
5. Use fraktag_get_node to fetch full content for each selected target.

This is equivalent to reading the entire knowledge base's table of contents and deciding which chapters to open.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            treeId: {
              type: "string",
              description: "The tree ID to get the map for",
            },
          },
          required: ["treeId"],
        },
      },
      {
        name: "fraktag_get_node",
        description: `Fetch a specific node's full content, title, gist, type, and path by its ID. NO LLM is used. This is the "drill" operation.

After fetching a node, assess its neighborhood:
- If it's a folder, use fraktag_browse to see its children and decide which to drill into.
- If it's a document with relevant content, you have your answer.
- If the content is partially relevant, check sibling nodes (browse the parent) for complementary information.

Typical retrieval workflow:
1. fraktag_vector_search → get candidate IDs + scores
2. fraktag_tree_map → get structural overview, find additional targets
3. fraktag_get_node → fetch content for each promising ID
4. Repeat step 3 for siblings/children as needed`,
        inputSchema: {
          type: "object" as const,
          properties: {
            nodeId: {
              type: "string",
              description: "The node ID to fetch",
            },
          },
          required: ["nodeId"],
        },
      },
    ],
  };
});

// ============ HANDLE TOOL CALLS ============

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ---- SEARCH ----
      case "fraktag_search": {
        const query = String(args?.query);
        let treeId = args?.treeId ? String(args.treeId) : undefined;

        // Default to first knowledge tree
        if (!treeId) {
          const trees = await fraktag.listTrees("knowledge");
          if (trees.length === 0) {
            return text("No knowledge trees available.");
          }
          treeId = trees[0].id;
        }

        log(`search: "${query}" in ${treeId}`);
        const result = await fraktag.retrieve({
          query,
          treeId,
          resolution: "L2",
        });

        if (result.nodes.length === 0) {
          return text("No relevant information found for this query.");
        }

        const blocks = result.nodes.map(
          (n, i) =>
            `--- [SOURCE ${i + 1}] ${n.path} ---\n${n.content}`
        );
        return text(blocks.join("\n\n"));
      }

      // ---- ASK ----
      case "fraktag_ask": {
        const query = String(args?.query);
        let treeId = args?.treeId ? String(args.treeId) : undefined;

        if (!treeId) {
          const trees = await fraktag.listTrees("knowledge");
          if (trees.length === 0) {
            return text("No knowledge trees available.");
          }
          treeId = trees[0].id;
        }

        log(`ask: "${query}" in ${treeId}`);
        const result = await fraktag.ask(query, treeId);

        let response = result.answer;
        if (result.references.length > 0) {
          response += "\n\nSources:\n" + result.references.map((r, i) => `  [${i + 1}] ${r}`).join("\n");
        }
        return text(response);
      }

      // ---- INGEST ----
      case "fraktag_ingest": {
        const title = String(args?.title);
        const content = String(args?.content);
        const gist = String(args?.gist);
        const treeId = String(args?.treeId);
        const targetFolder = String(args?.targetFolder);

        log(`ingest: "${title}" → ${treeId}/${targetFolder}`);
        const doc = await fraktag.directIngest(
          content,
          treeId,
          targetFolder,
          title,
          gist
        );

        return text(`Saved "${title}" (id: ${doc.id}) to ${treeId}. Indexed for retrieval.`);
      }

      // ---- LIST TREES ----
      case "fraktag_list_trees": {
        const trees = await fraktag.listTrees();
        if (trees.length === 0) {
          return text("No trees configured.");
        }

        const lines = trees.map(
          (t) => `- ${t.id} | "${t.name}" (${t.type}) — ${t.organizingPrinciple.slice(0, 100)}`
        );
        return text("Knowledge Trees:\n" + lines.join("\n"));
      }

      // ---- BROWSE ----
      case "fraktag_browse": {
        const treeId = String(args?.treeId);
        const nodeId = args?.nodeId ? String(args.nodeId) : undefined;

        if (!nodeId) {
          // List all leaf folders
          const folders = await fraktag.getLeafFolders(treeId);
          if (folders.length === 0) {
            return text("No leaf folders found in this tree.");
          }

          const lines = folders.map(
            (f) => `${f.id} | ${f.path} — ${f.gist.slice(0, 80)}`
          );
          return text(`Leaf folders in "${treeId}" (valid ingestion targets):\n` + lines.join("\n"));
        }

        // Browse specific node
        const result = await fraktag.browse({
          treeId,
          nodeId,
          resolution: "L0",
        });

        let output = `${result.node.type}: "${result.node.title}" (${result.node.id})\n`;
        output += `Path: ${result.node.path}\n`;
        output += `Gist: ${result.node.gist}\n`;

        if (result.parent) {
          output += `Parent: "${result.parent.title}" (${result.parent.id})\n`;
        }

        if (result.children.length > 0) {
          output += `\nChildren (${result.children.length}):\n`;
          output += result.children
            .map((c) => `  ${c.type} | ${c.id} | "${c.title}" — ${c.gist.slice(0, 60)}`)
            .join("\n");
        } else {
          output += "\nNo children.";
        }

        return text(output);
      }

      // ============ RAW TOOLS (No LLM) ============

      // ---- VECTOR SEARCH (raw) ----
      case "fraktag_vector_search": {
        const query = String(args?.query);
        const treeId = String(args?.treeId);
        const topK = args?.topK ? Number(args.topK) : 10;

        log(`vector_search: "${query}" in ${treeId} (top ${topK})`);
        const results = await fraktag.rawVectorSearch(treeId, query, topK);

        if (results.length === 0) {
          return text("No vector matches found.");
        }

        // Enrich with node metadata (title, gist, type, path) — no content, just index data
        const lines: string[] = [];
        for (const r of results) {
          const node = await fraktag.getNode(r.id);
          if (node) {
            lines.push(
              `[${r.score.toFixed(3)}] ${node.id} | ${node.type} | "${node.title}" | path: ${node.path}\n         gist: ${node.gist.slice(0, 120)}`
            );
          } else {
            lines.push(`[${r.score.toFixed(3)}] ${r.id} | (node not found)`);
          }
        }

        return text(`Vector search results for "${query}" (${results.length} hits):\n\n` + lines.join("\n\n"));
      }

      // ---- TREE MAP ----
      case "fraktag_tree_map": {
        const treeId = String(args?.treeId);

        log(`tree_map: ${treeId}`);
        const map = await fraktag.getTreeMap(treeId);

        return text(map);
      }

      // ---- GET NODE ----
      case "fraktag_get_node": {
        const nodeId = String(args?.nodeId);

        log(`get_node: ${nodeId}`);
        const data = await fraktag.getNodeWithContent(nodeId);

        if (!data) {
          return error(`Node not found: ${nodeId}`);
        }

        let output = `Type: ${data.type}\n`;
        output += `Title: ${data.title}\n`;
        output += `Path: ${data.path}\n`;
        output += `Gist: ${data.gist}\n`;
        output += `\n--- Content ---\n${data.content || "(no content — this is a folder)"}`;

        return text(output);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    log(`Error in ${name}: ${e.message}`);
    return error(e.message);
  }
});

// ============ HELPERS ============

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ============ START ============

const transport = new StdioServerTransport();
await server.connect(transport);
log("MCP server running on stdio");
