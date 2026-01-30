#!/bin/bash
# nightly-compound.sh — Drive Claude Code to journal today's learnings into Repository Memory.
#
# This script is meant to be run at the end of a work session or as a nightly cron job.
# It prompts Claude Code (via the claude CLI) to reflect on recent git activity
# and save important learnings to the FRAKTAG Repository Memory.
#
# Prerequisites:
#   - Claude Code CLI installed (claude command available)
#   - FRAKTAG MCP server configured (run setup-mcp.sh first)
#   - Git repository with recent commits
#
# Usage:
#   ./scripts/nightly-compound.sh [--days N]
#
# Options:
#   --days N    Look back N days of git history (default: 1)

set -e

DAYS=1

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --days)
      DAYS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/nightly-compound.sh [--days N]"
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "=== FRAKTAG Nightly Compound ==="
echo "Looking back $DAYS day(s) of git history..."
echo ""

# Gather recent git activity
SINCE_DATE=$(date -v-${DAYS}d +%Y-%m-%d 2>/dev/null || date -d "$DAYS days ago" +%Y-%m-%d 2>/dev/null)
GIT_LOG=$(git log --since="$SINCE_DATE" --oneline --no-merges 2>/dev/null || echo "(no recent commits)")
GIT_DIFF_STAT=$(git log --since="$SINCE_DATE" --stat --no-merges 2>/dev/null || echo "(no changes)")

if [ "$GIT_LOG" = "(no recent commits)" ]; then
  echo "No commits found in the last $DAYS day(s). Nothing to compound."
  exit 0
fi

echo "Recent commits:"
echo "$GIT_LOG"
echo ""

# Build the prompt for Claude Code
PROMPT=$(cat <<PROMPTEOF
You have access to FRAKTAG Repository Memory via MCP tools. Your task is to review today's work and save important learnings.

## Recent Git Activity (last $DAYS day(s))

### Commits:
$GIT_LOG

### Changes:
$GIT_DIFF_STAT

## Your Task

1. First, use fraktag_list_trees to find the "repo-memory" tree.
2. Use fraktag_search to check what's already in the Repository Memory — don't duplicate.
3. Review the git changes above and identify:
   - Any architectural decisions made → save to /Architecture
   - Any new patterns established → save to /Patterns
   - Any bugs fixed or lessons learned → save to /Learnings
   - Any operational changes (scripts, config, deployment) → save to /Operational
4. For each learning worth saving, use fraktag_ingest with:
   - A clear, searchable title
   - Detailed content in markdown (include file paths, code snippets, reasoning)
   - A one-sentence gist for the AI index
   - The appropriate targetFolder path

Guidelines:
- Be selective. Only save things that would be useful to remember in future sessions.
- Include enough context that the learning is useful without reading the original code.
- If a commit fixes a bug, document the root cause and the fix, not just "fixed bug X".
- If a commit adds a feature, document any design decisions or patterns worth remembering.
- Skip trivial changes (typo fixes, version bumps, formatting).
PROMPTEOF
)

# Run Claude Code with the compounding prompt
echo "Launching Claude Code for compounding..."
echo ""

if command -v claude &> /dev/null; then
  echo "$PROMPT" | claude --print
else
  echo "Claude Code CLI not found. Install it first:"
  echo "  npm install -g @anthropic-ai/claude-code"
  echo ""
  echo "Or run manually with this prompt:"
  echo "---"
  echo "$PROMPT"
  echo "---"
  exit 1
fi

echo ""
echo "=== Compounding complete ==="
