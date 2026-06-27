#!/usr/bin/env bash
#
# Start the Agentic Android stack on this Mac: relay + hub + an agent, plus the phone tunnel.
#
#   ./start.sh            # built-in basic agent (no model, no login — always works)
#   ./start.sh claude     # YOUR Claude (subscription); run `claude login` once first — no API key
#   ./start.sh none       # relay + hub only; pick/start the agent from the setup page
#
# Then open the setup page:  http://127.0.0.1:8123
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backbone"

AGENT="${1:-basic}"
RELAY_PORT=8799                       # must match relayUrl in ~/.agentic-android/agent.json
LOG_DIR="$ROOT/.logs"; mkdir -p "$LOG_DIR"
ADB="$(command -v adb || echo "$HOME/Library/Android/sdk/platform-tools/adb")"

echo "› Stopping any existing stack…"
pkill -f "src/relay.ts"     2>/dev/null || true
pkill -f "src/panel.ts"     2>/dev/null || true
pkill -f "src/agent.ts"     2>/dev/null || true
pkill -f "src/agent-cli.ts" 2>/dev/null || true
sleep 1

echo "› relay  on :$RELAY_PORT"
PORT=$RELAY_PORT nohup pnpm -s relay > "$LOG_DIR/relay.log" 2>&1 &
sleep 2

echo "› hub    on http://127.0.0.1:8123  (agent socket :8124)"
# Bind all interfaces so the phone (over Tailscale) and remote/cloud agents can reach :8123/:8124.
# Localhost agents still work. Override with PANEL_HOST=127.0.0.1 to keep it local-only.
PANEL_HOST="${PANEL_HOST:-0.0.0.0}" nohup pnpm -s hub > "$LOG_DIR/hub.log" 2>&1 &
sleep 3
if ! grep -q "panel: http" "$LOG_DIR/hub.log" 2>/dev/null; then
  echo "  ⚠ hub didn't start — see $LOG_DIR/hub.log (most likely: not paired yet; pair a phone once)."
fi

case "$AGENT" in
  claude) echo "› agent  your Claude (pnpm agent:claude)"; nohup pnpm -s agent:claude > "$LOG_DIR/agent.log" 2>&1 & ;;
  none)   echo "› agent  (skipped — start one from the setup page)";;
  *)      echo "› agent  built-in basic (pnpm agent)";        nohup pnpm -s agent     > "$LOG_DIR/agent.log" 2>&1 & ;;
esac
sleep 2

echo "› phone tunnel (adb reverse tcp:$RELAY_PORT)"
if "$ADB" get-state >/dev/null 2>&1; then
  "$ADB" reverse tcp:$RELAY_PORT tcp:$RELAY_PORT >/dev/null 2>&1 && echo "  ✓ tunnel set"
else
  echo "  (no phone over adb yet — plug it in, then: adb reverse tcp:$RELAY_PORT tcp:$RELAY_PORT)"
fi

echo
echo "✓ Up.  Open:  http://127.0.0.1:8123"
echo "  logs: $LOG_DIR/{relay,hub,agent}.log   ·   stop: ./stop.sh"
