#!/usr/bin/env bash
#
# Long-lived launchd entrypoint for the GLUE (relay + hub) — NOT the agent (that stays swappable/
# user-run) and NOT the phone tunnel (that's per-session adb). launchd's KeepAlive restarts THIS
# script if the hub exits; we pkill + restart the relay on each run so a stale one never lingers.
# (For finer-grained control you can split this into two plists, one process each.)
#
# launchd starts processes with a bare environment, so set an explicit PATH to node/pnpm. Adjust the
# node path if your version changes (`which node`).
set -uo pipefail
export PATH="/opt/homebrew/bin:/Users/rgv250cc/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.logs"
cd "$ROOT/backbone"

pkill -f "src/relay.ts" 2>/dev/null || true
sleep 1
PORT=8799 nohup pnpm -s relay >> "$ROOT/.logs/relay.log" 2>&1 &
sleep 2
exec pnpm -s hub   # the hub is the foreground process launchd tracks
