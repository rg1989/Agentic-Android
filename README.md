# Agentic Android

Connect **any agent** (Claude Code, your Claude subscription, or your own script) to your **Android
phone**, both ways:

- **Agent → phone** — the agent drives the phone: take a photo, get location, send an SMS, read
  notifications, ring, flash the torch, and even **read and tap the screen of any app** (Tier‑2
  computer‑use).
- **Phone → agent** — you talk to the agent from the phone: type or speak (wake word + voice), and
  the agent replies in chat or out loud.

Self‑hosted, open‑source, end‑to‑end encrypted. No accounts, no API key required, your own channel —
not Telegram's.

> **Full architecture and every design decision:** see **[DESIGN.md](DESIGN.md)**.

---

## Features

**Phone capabilities the agent can call** (all consent‑gated on the phone):

| Tier | Capabilities |
|---|---|
| **1 — Structured APIs** | `camera.capture`, `location.get`, `sms.send`, `notification.listen` / `notify.post`, `device.info`, `battery`, `flashlight`, `phone.ring` / `phone.stop_ring`, `vibrate`, `clipboard.set`, `app.launch` / `apps.list`, photos |
| **2 — Computer‑use** | drive any app's UI: `ui.read` (screen contents), `ui.tap`, `ui.text`, `ui.swipe`, `ui.screenshot`, `ui.global` (back/home/recents) — via AccessibilityService |

**The phone app** (native Kotlin/Compose, sideloaded):

- Chat UI with rich messages — markdown, syntax‑highlighted code, inline images, file chips (preview /
  download / share), and tables.
- **Voice** — always‑on offline wake word (Vosk), hold‑to‑talk, spoken replies (TTS) with a
  speech sanitizer, configurable wake phrase / sensitivity / DND windows.
- **Multiple agents** — pair several, switch between them, per‑agent color themes.
- **Multiple chat sessions** — named, persisted, with auto‑titles and history replay.
- **Consent engine** — per‑agent × per‑capability `deny` / `ask` / `allow`, biometric confirm for
  sensitive actions.
- Auto‑reconnect with backoff; auto‑start on boot; FCM push as a wake doorbell.

**The agent side** — three ways to attach a brain, no app changes:

- **Built‑in basic** — a keyword stub, no model, no login. Always works for testing.
- **Your Claude** — runs *your* `claude` CLI (subscription auth, **no API key in this project**).
- **Anthropic API** — set `ANTHROPIC_API_KEY` and use the built‑in Claude loop.
- **Any MCP host** — `phone-mcp.ts` exposes the phone as Model Context Protocol tools, so Claude Code
  or any MCP client can drive the phone.

---

## How it works

Three processes plus the phone. The relay only ever sees opaque ciphertext addressed by fingerprint.

```
 ┌──────────────┐   WS :8124 / MCP   ┌──────────────┐   WebSocket (E2E, +FCM wake)   ┌───────┐   WS/FCM   ┌───────┐
 │    Agent     │ ◀─────────────────▶│     Hub      │ ◀─────────────────────────────▶│ Relay │ ◀─────────▶│ Phone │
 │ (any brain)  │   tools / replies  │ (the glue)   │      opaque ciphertext, routed by fingerprint        │       │
 └──────────────┘                    └──────────────┘                                └───────┘            └───────┘
                                    web setup UI :8123          untrusted post office :8799
```

- **Relay** (`backbone/src/relay.ts`) — an untrusted "post office." Routes encrypted envelopes by
  destination fingerprint, queues for offline peers, serves media blobs over HTTP with a TTL. It can
  never read message contents.
- **Hub** (`backbone/src/panel.ts`) — the glue and the only stateful piece. Owns the phone connection
  (speaks as the phone's paired identity), the agent roster, chat sessions, media, the event log, and
  a persistent scheduler. Serves the **web setup page on `:8123`** and an **agent WebSocket on
  `:8124`**.
- **Agent** (`backbone/src/agent.ts` / `agent-cli.ts`) — a replaceable process that connects to the
  hub, receives your messages plus the phone's capability catalog, runs its reasoning loop, and calls
  tools back to the phone.
- **Phone** (`android/`) — a foreground service holding the relay connection, the Compose chat UI, the
  capability registry, the consent engine, and the voice pipeline.

**Identity & trust:** an ed25519 keypair *is* the identity — no passwords, no email. Pairing is
QR + trust‑on‑first‑use; the phone is the approver. After pairing, phone and hub know each other's
static key and E2E encryption works both ways forever (libsodium `crypto_box`: X25519 + XSalsa20‑Poly1305).

**Message model:** four kinds inside the encrypted payload — `request` → `response` (tool calls,
within seconds), `event` (phone‑initiated: wake word, notifications, deferred‑task results), and
`ack`. Every response carries a typed `{status, result, error?}` so the agent can **chain and recover**
(e.g. `capture → CAMERA_IN_USE → release → capture`) inside one run.

---

## Setup

### Prerequisites

- **Mac/Linux** with **Node.js 22+** and **pnpm 9+** (the relay + hub + agent run here).
- **Android 10+ phone** with USB debugging, plus **Android Studio's bundled JDK** and `adb` for
  building/installing the app.
- _(Recommended)_ **[Tailscale](https://tailscale.com)** on both the Mac and the phone, so the phone
  reaches the hub off‑WiFi without exposing anything to the internet.

### 1. Start the stack on your Mac

```bash
cd backbone
pnpm install
pnpm test          # optional: 36 tests — protocol, crypto, relay, consent, media, scheduling, pairing, full E2E
cd ..
```

From the repo root, run one of:

```bash
make up        # relay + hub only — then pick/start the agent from the setup page
make start     # relay + hub + built-in basic agent (no model, no login)
make claude    # relay + hub + YOUR Claude (run `claude login` once first — no API key)
```

This puts the relay on `:8799`, the hub web UI on `http://127.0.0.1:8123`, and the agent socket on
`:8124`. Open the setup page:

```bash
make open      # → http://127.0.0.1:8123
```

Other commands: `make stop`, `make restart`, `make logs`, `make install`.

### 2. Build and install the phone app

Plug in the phone (USB debugging on, accept the prompt), then:

```bash
make install   # builds the APK, installs it over adb, launches it
```

> Sideloaded by design — the Tier‑2 Accessibility automation isn't allowed on the Play Store. The
> build uses Android Studio's bundled JDK 17/21 (set `JAVA_HOME` if it's elsewhere). For FCM wake,
> drop a `google-services.json` into `android/app/`, or skip it to build without push wake.

### 3. Pair the phone with the hub

On the setup page (`:8123`), choose **add / pair a phone** — it shows a QR / token. In the phone app,
scan it (or enter the token) and approve. They exchange public keys and E2E is live.

**Connectivity:** with Tailscale, set the phone's hub address to your Mac's tailnet IP
(`http://<tailscale-ip>:8799`). Over USB instead, run `adb reverse tcp:8799 tcp:8799`.
After a phone reboot, reopen Tailscale to bring the VPN back up, or the app shows "Can't reach your hub."

### 4. (Optional) Drive the phone from Claude Code / any MCP host

Register `backbone/src/phone-mcp.ts` as an MCP server (via `.mcp.json` or `claude mcp add`). It fetches
the phone's catalog from the hub and exposes every capability as an MCP tool. The host must be able to
reach the hub's HTTP endpoint (`http://127.0.0.1:8123`).

### Run the hub as a background service (optional)

`launchd/` has a plist to keep the relay + hub running across logins. **Not installed automatically** —
see **[launchd/README.md](launchd/README.md)** (note the macOS TCC caveat if your checkout lives under
`~/Documents`).

---

## Security model — read before exposing anything

This is a **single‑user, self‑hosted, private‑network tool.** It is designed to run on your own
machine and a **private tailnet**, not on a public address.

- The **hub's agent WebSocket (`:8124`) and the relay are not authenticated.** On a shared or exposed
  network, a rogue client could impersonate an agent. **Keep them on localhost / Tailscale only.**
- `make claude` / `pnpm agent:claude` runs the agent with `--dangerously-skip-permissions` — it's a
  trusted brain on your own machine. Consent is still enforced **on the phone** per agent and
  capability.
- The relay has no rate limiting or DDoS protection — **do not expose it to untrusted networks.**

---

## Status

| Piece | State |
|---|---|
| Protocol, crypto, relay, hub, scheduler, blobs, consent, pairing | ✅ built + tested (36 TS tests, typecheck clean) |
| Key‑free agent (`agent:claude`) + phone MCP server (`phone-mcp.ts`) | ✅ built; model leg verified on a logged‑in machine |
| Android app: chat UI, voice, multi‑agent, sessions, Tier‑1 + Tier‑2 capabilities | ✅ built + device‑verified (OnePlus, Android) |
| Concierge `ask_agent` (one agent routing to another) | 🟡 staged — needs ≥2 live brains to verify |
| Hub auth, log/blob rotation, Porcupine wake engine, Noise‑IK, menu‑bar installer | ⬜ designed / deferred (see [.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md)) |

## Layout

- **`backbone/`** — TypeScript: wire protocol, E2E crypto, relay, hub, agents, MCP server. _(`make`
  targets and `pnpm` scripts here.)_
- **`android/`** — native Kotlin/Compose phone app. See [android/README.md](android/README.md).
- **`launchd/`** — macOS service plist for the hub.
- **`.planning/codebase/`** — generated architecture map (ARCHITECTURE, STRUCTURE, STACK, INTEGRATIONS,
  CONVENTIONS, TESTING, CONCERNS).
- **[DESIGN.md](DESIGN.md)** — the design rationale; **[PLAN.md](PLAN.md)** — the build plan/log.
