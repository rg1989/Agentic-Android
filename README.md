# Agentic Android

Connect **any agent** (Claude Code or otherwise) to an **Android phone**, both ways: the agent invokes
phone actions (camera, location, ring, …); the phone initiates events to the agent (wake word,
notifications). Self-hosted, open-source, end-to-end encrypted. Your own channel — not Telegram's.

See **[DESIGN.md](DESIGN.md)** for the full architecture and every design decision.

## Layout

- **`backbone/`** — TypeScript spine: wire protocol, E2E crypto, relay, and the agent-side bridge
  (MCP server). **Built and fully tested.**
- **`android/`** — native Kotlin/Compose app, mirroring the backbone. **Scaffold; unverified here**
  (no Kotlin toolchain on the build machine). See [android/README.md](android/README.md).

## Quick start (backbone)

```bash
cd backbone
pnpm install
pnpm test          # 36 tests: protocol, crypto, relay, consent, media, scheduling, pairing, raw-WS adapter, full E2E
pnpm typecheck     # tsc --noEmit, clean
```

Run the relay (self-host this on a small VPS):

```bash
PORT=8787 pnpm relay
# relay listening: ws://0.0.0.0:8787  |  blobs: http://0.0.0.0:8787/blob/:id
```

Run the bridge as an MCP server for Claude Code:

```bash
pnpm bridge        # first run prints a pairing payload + writes ~/.agentic-android/agent.json
```

Then register it with Claude Code (`.mcp.json` / `claude mcp add`) pointing at
`tsx backbone/src/bridge.ts`, finish pairing with the phone, and the phone's capabilities appear as
MCP tools.

## What works today

The whole communication design is proven end-to-end in `backbone/test/e2e.test.ts`: an MCP client
(standing in for Claude Code) drives the bridge → relay → simulated phone and back —
catalog→tools, an action round-trip, typed-error **observe/recover chaining**, an E2E media blob,
**consent gates** (allow/ask/deny, per-agent override), an **inbound wake event**, and **deferred
scheduling** that fires later and wakes the agent.

## Status

| Piece | State |
|---|---|
| Protocol, crypto, relay, bridge, scheduler, blobs, consent | ✅ built + tested (36 passing) |
| QR/token pairing handshake (TS) | ✅ built + tested ([pairing.ts](backbone/src/pairing.ts)) |
| Raw-WS non-MCP agent adapter (TS) | ✅ built + tested ([raw-agent.ts](backbone/examples/raw-agent.ts)) |
| Runnable relay + bridge entrypoints | ✅ smoke-tested |
| Android app: transport, crypto, consent, Tier-1 providers, pairing/biometric, voice scaffold | 🟡 scaffold, unverified (needs Android SDK + JDK 17/21 + device) |
| Tier-2 computer-use (Accessibility), warm voice loop, Noise-IK | ⬜ designed, not yet built |
