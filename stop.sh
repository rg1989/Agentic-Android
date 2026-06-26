#!/usr/bin/env bash
# Stop the Agentic Android stack (relay + hub + agent) on this Mac.
pkill -f "src/relay.ts"     2>/dev/null || true
pkill -f "src/panel.ts"     2>/dev/null || true
pkill -f "src/agent.ts"     2>/dev/null || true
pkill -f "src/agent-cli.ts" 2>/dev/null || true
echo "✓ Stopped the stack."
