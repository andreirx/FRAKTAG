#!/bin/bash
# setup-mcp.sh — Build @fraktag/mcp and configure Claude Code to use it.
#
# Usage:
#   ./scripts/setup-mcp.sh [config-json-path]
#
# If no config path is given, defaults to packages/engine/data/config.json

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Resolve config path
CONFIG_PATH="${1:-$PROJECT_ROOT/packages/engine/data/config.json}"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "Config not found at $CONFIG_PATH"
  echo "Usage: ./scripts/setup-mcp.sh [path/to/config.json]"
  exit 1
fi
CONFIG_PATH="$(cd "$(dirname "$CONFIG_PATH")" && pwd)/$(basename "$CONFIG_PATH")"

# 2. Build
echo "Building @fraktag/engine..."
cd "$PROJECT_ROOT"
npm run build --workspace=@fraktag/engine

echo "Installing @fraktag/mcp dependencies..."
npm install --workspace=@fraktag/mcp

echo "Building @fraktag/mcp..."
npm run build --workspace=@fraktag/mcp

MCP_PATH="$PROJECT_ROOT/packages/mcp/dist/index.js"

if [ ! -f "$MCP_PATH" ]; then
  echo "Build failed: $MCP_PATH not found"
  exit 1
fi

echo ""
echo "Build complete."
echo ""

# 3. Find Claude Code settings and write MCP config
# Claude Code uses .mcp.json in the project root for project-scoped MCP servers
MCP_CONFIG="$PROJECT_ROOT/.mcp.json"

# Build the JSON entry
MCP_ENTRY=$(cat <<EOF
{
  "mcpServers": {
    "fraktag": {
      "command": "node",
      "args": ["$MCP_PATH"],
      "env": {
        "FRAKTAG_CONFIG": "$CONFIG_PATH"
      }
    }
  }
}
EOF
)

if [ -f "$MCP_CONFIG" ]; then
  # Check if fraktag is already configured
  if grep -q '"fraktag"' "$MCP_CONFIG" 2>/dev/null; then
    echo "fraktag MCP server already configured in $MCP_CONFIG"
    echo "To reconfigure, remove the 'fraktag' entry and re-run this script."
  else
    echo "Existing .mcp.json found. Add this entry manually:"
    echo ""
    echo "  \"fraktag\": {"
    echo "    \"command\": \"node\","
    echo "    \"args\": [\"$MCP_PATH\"],"
    echo "    \"env\": {"
    echo "      \"FRAKTAG_CONFIG\": \"$CONFIG_PATH\""
    echo "    }"
    echo "  }"
    echo ""
  fi
else
  # Write fresh .mcp.json
  echo "$MCP_ENTRY" > "$MCP_CONFIG"
  echo "Wrote $MCP_CONFIG"
fi

echo ""
echo "Configuration:"
echo "  MCP Server: $MCP_PATH"
echo "  Engine Config: $CONFIG_PATH"
echo ""
echo "Restart Claude Code to pick up the new MCP server."
echo "Claude will now have access to fraktag_search, fraktag_ask, fraktag_ingest, fraktag_list_trees, and fraktag_browse."
