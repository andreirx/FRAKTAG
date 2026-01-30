#!/bin/bash
# setup-memory.sh — Bootstrap a Repository Memory tree for Claude Code.
#
# This script adds a "repo-memory" knowledge tree to your FRAKTAG config
# with the standard Organizing Principle taxonomy:
#   /Architecture  — System design decisions, component boundaries, technology choices
#   /Patterns      — Reusable code patterns, style guides, idioms
#   /Learnings     — Post-mortems, bug fixes, lessons learned
#   /Operational   — Scripts, deployment procedures, configuration guides
#
# Usage:
#   ./scripts/setup-memory.sh [config-json-path]
#
# If no config path is given, defaults to packages/engine/data/config.json

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Resolve config path
CONFIG_PATH="${1:-$PROJECT_ROOT/packages/engine/data/config.json}"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "Config not found at $CONFIG_PATH"
  echo "Usage: ./scripts/setup-memory.sh [path/to/config.json]"
  exit 1
fi
CONFIG_PATH="$(cd "$(dirname "$CONFIG_PATH")" && pwd)/$(basename "$CONFIG_PATH")"

echo "Config: $CONFIG_PATH"

# 2. Check if repo-memory tree already exists
if grep -q '"repo-memory"' "$CONFIG_PATH" 2>/dev/null; then
  echo ""
  echo "Tree 'repo-memory' already exists in config. Skipping tree creation."
  echo "Run 'cd packages/engine && npx tsx src/cli.ts setup' to re-initialize seed folders."
  exit 0
fi

# 3. Build the tree definition JSON
TREE_JSON=$(cat <<'TREEOF'
    {
      "id": "repo-memory",
      "name": "Repository Memory",
      "type": "knowledge",
      "organizingPrinciple": "Repository Memory for AI-assisted development. Organized by knowledge type: Architecture (design decisions), Patterns (code conventions), Learnings (post-mortems and lessons), Operational (scripts and procedures).",
      "autoPlace": false,
      "seedFolders": [
        {
          "title": "Architecture",
          "gist": "High-level system design decisions, component boundaries, data flow, and technology choices.",
          "children": [
            { "title": "Decisions", "gist": "Architectural Decision Records (ADRs) — why we chose X over Y." },
            { "title": "Components", "gist": "Component boundaries, responsibilities, and interfaces." },
            { "title": "Data Flow", "gist": "How data moves through the system, pipelines, and transformations." }
          ]
        },
        {
          "title": "Patterns",
          "gist": "Reusable code patterns, style guides, naming conventions, and idioms used in this codebase.",
          "children": [
            { "title": "Code Style", "gist": "Formatting rules, naming conventions, and language idioms." },
            { "title": "Design Patterns", "gist": "Recurring implementation patterns used across the codebase." },
            { "title": "Testing", "gist": "Test patterns, fixtures, mocking strategies, and coverage rules." }
          ]
        },
        {
          "title": "Learnings",
          "gist": "Post-mortems, bug root causes, lessons learned, and things that surprised us.",
          "children": [
            { "title": "Debugging", "gist": "Root cause analyses of bugs and the reasoning that found them." },
            { "title": "Performance", "gist": "Performance issues encountered and how they were resolved." },
            { "title": "Gotchas", "gist": "Surprising behaviors, edge cases, and non-obvious constraints." }
          ]
        },
        {
          "title": "Operational",
          "gist": "Scripts, deployment procedures, environment setup, and configuration guides.",
          "children": [
            { "title": "Setup", "gist": "Environment setup, installation, and initial configuration." },
            { "title": "Deployment", "gist": "Build, release, and deployment procedures." },
            { "title": "Scripts", "gist": "Utility scripts, automation, and maintenance tasks." }
          ]
        }
      ],
      "dogma": {
        "strictness": "strict",
        "forbiddenConcepts": [
          "generic summaries without specifics",
          "advice without context (what was the problem?)",
          "outdated information presented as current"
        ],
        "requiredContext": [
          "What specific problem or question this addresses",
          "Relevant file paths or code references",
          "Date or version context when applicable"
        ]
      }
    }
TREEOF
)

# 4. Insert the tree into the config's trees array
# Use node for reliable JSON manipulation
node -e "
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf8'));
  const tree = $TREE_JSON;
  if (!config.trees) config.trees = [];
  config.trees.push(tree);
  fs.writeFileSync('$CONFIG_PATH', JSON.stringify(config, null, 2) + '\n');
  console.log('Added repo-memory tree to config.');
"

# 5. Initialize the tree
echo ""
echo "Initializing tree structure..."
cd "$PROJECT_ROOT/packages/engine"
npx tsx src/cli.ts setup
cd "$PROJECT_ROOT"

echo ""
echo "Repository Memory is ready."
echo ""
echo "Tree structure:"
echo "  /Architecture"
echo "    /Decisions    — ADRs and technology choices"
echo "    /Components   — Component boundaries and interfaces"
echo "    /Data Flow    — System data flow and pipelines"
echo "  /Patterns"
echo "    /Code Style   — Formatting and naming conventions"
echo "    /Design Patterns — Recurring implementation patterns"
echo "    /Testing      — Test patterns and strategies"
echo "  /Learnings"
echo "    /Debugging    — Bug root causes and fixes"
echo "    /Performance  — Performance issues and resolutions"
echo "    /Gotchas      — Surprising behaviors and edge cases"
echo "  /Operational"
echo "    /Setup        — Environment and installation"
echo "    /Deployment   — Build and release procedures"
echo "    /Scripts      — Utility scripts and automation"
echo ""
echo "Next: Run ./scripts/setup-mcp.sh to connect this to Claude Code."
