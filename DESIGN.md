# Agentic Android — Design

A universal, two-way bus that connects **any agent** (Claude Code or otherwise) to an **Android
phone**: the agent can invoke phone actions (camera, location, …), and the phone can initiate events
to the agent (wake word, notifications). Self-hosted, open-source, end-to-end encrypted. An
alternative channel to Telegram that you own.

This document records the decisions locked during the design grilling. Each is numbered to the
question that settled it.

## North star

A hands-free, voice-capable assistant that is **as capable as Claude on your computer** — within
Android's sandbox. Two co-equal directions:
- **(A) Agent → phone control** — the agent drives the phone.
- **(B) Phone → agent channel** — you talk to the agent through the phone.

Both are first-class. (B) is *not* a separate app — it's two message types on the same bus
(`user_message` event in, `speak`/`display` action out). *(Q1)*

## Architecture (two hops)

```
 ┌─────────────┐  MCP (stdio)   ┌──────────────┐   WebSocket (+FCM wake, E2E)   ┌───────┐  WS/FCM  ┌───────┐
 │ Claude Code │ ◀─────────────▶│    Bridge    │ ◀─────────────────────────────▶│ Relay │ ◀───────▶│ Phone │
 │  (any LLM)  │  tools         │  (daemon)    │      opaque ciphertext routed by fingerprint        │       │
 └─────────────┘                └──────────────┘                                 └───────┘          └───────┘
   non-LLM agents speak the raw WS bus directly (no MCP).
```

- **MCP** is how an LLM's reasoning loop learns what tools exist; **WebSocket** is the network pipe.
  Different layers, both present. A bare socket can't advertise typed tools to a model — that's MCP's
  job. Non-LLM agents skip MCP and speak the bus directly. *(Q3)*
- **Topology:** a thin self-hostable **relay** both sides connect to, with **FCM** as the doorbell to
  wake a backgrounded phone, and **E2E encryption** so the relay forwards opaque bytes it can't read.
  Chosen over LAN-only (breaks off-WiFi) and pure-P2P (a backgrounded Android app can't hold/await a
  socket). *(Q2)*

## Seam map — 3 stable cores, 3 swap points *(Q4)*

| | Module | Stack |
|---|---|---|
| 🔒 Core | Wire protocol | JSON envelopes + JSON-Schema/zod, semver'd — *this is the product* |
| 🔒 Core | Session crypto | Noise-IK (target) / libsodium `crypto_box` (v1) |
| 🔒 Core | Relay | TypeScript + `ws`, single self-host container |
| 🔌 Swap | Agent adapter | MCP (LLM hosts) **+** raw WS (scripted agents) |
| 🔌 Swap | Phone capabilities | Kotlin capability registry |
| 🔌 Swap | Phone UI | Jetpack Compose |

Discipline: capabilities and UI talk to the bus **only** through the protocol. Add an ability =
register a provider + a schema entry. Swap the UI = another consumer of the same event stream.

## Identity, pairing, trust *(Q5)*

- **The keypair IS the identity** — ed25519 per device. No accounts, no passwords, no email
  (Syncthing/Tailscale model). Fingerprint = `generichash(edPub)`.
- **Pairing = QR + trust-on-first-use**, phone is the approver. The bridge shows a QR
  `{bridge_pubkey, relay_url, token}`; the phone approves; they exchange public keys. Both then know
  each other's static key → E2E works in both directions forever.
- **Relay is accountless + key-addressed:** a client proves identity by signing a challenge; the relay
  routes by destination fingerprint and can never read contents.
- **Single-user, self-hosted, N×N by construction.** No multi-tenant/account system. "1 phone ↔ 3
  agents" or "1 agent ↔ 2 phones" = multiple pairwise pairings.

## Protocol — interaction model *(Q6, Q10)*

Four message kinds, all inside the encrypted `enc` payload: `request`, `response`, `event`, `ack`.
The cleartext envelope (`v,id,from,to,ts,enc`) is all the relay sees.

- **Quick actions** → `request`→`response` within seconds (tool blocks until result/timeout).
- **Deferred/long actions** ("photo in 5 min") → the **bridge** holds the timer (phone stays a dumb
  executor); on fire it sends the request, then the result comes back as a `task.result` **event that
  wakes the agent**. Deferred results and phone-initiated events reuse one inbound path.
  *Upgrade path:* phone-side `AlarmManager` for fire-even-if-relay-offline robustness.
- **Rich feedback:** every `response` is `{status, result, error?:{code,message,retriable}}` — never a
  bare ack. The catalog includes **observe** actions (`camera.state`) and **typed errors**
  (`CAMERA_IN_USE`, `PERMISSION_NOT_GRANTED`, `CONSENT_DENIED`) so the agent can **chain and recover**
  ("capture → CAMERA_IN_USE → release → capture") within a single agent run.
- **Capability granularity:** high-level **atomic** capabilities by default (one round-trip; internal
  open/capture/close), with a few low-level primitives only where orchestration genuinely pays.

## Media *(Q7)*

Snapshot/clip for v1 (photos, short audio). Media moves **out-of-band**: encrypted client-side,
`PUT` to the relay's blob endpoint under a random id with a **TTL**; the control message carries
`{blob_id, size, content_type, nonce}`; receiver `GET`s + decrypts. Keeps big bytes out of the
message queue; relay stores opaque ciphertext. **Live streaming deferred** but the media-transport
seam stays open for a later direct P2P channel.

## Consent — the security spine *(Q8)*

- **Enforcement lives on the phone.** The agent can request anything; the phone decides. Never trust
  the agent side for authorization.
- **Two permission layers:** Android OS runtime permission (just-in-time) **and** app policy
  (allow/ask/deny).
- **Per-(agent × capability) policy**, defaulted by a pairing-time profile (Trusted / Limited). A
  second, sketchier agent doesn't inherit full control.
- **`ask`** routes a confirmation to the phone (notification + biometric) — capability (B) paying for
  itself.

## Agent continuity *(Q9)*

- **v1 = Mode 1 (universal):** the bridge spawns `claude -p "<event>" --resume <session>` per inbound
  event; continuity from Claude Code's own session/compaction. Works with any MCP host unchanged. A
  couple seconds latency — fine for events/commands, deliberate for voice.
- **Swap-in = Mode 2 (warm Agent-SDK loop):** low-latency, ideal for real-time voice. Lives behind the
  agent-adapter seam; no protocol change.
- **Memory is the agent's job** (CLAUDE.md, session memory) — not built into the bridge.

## Capability tiers — "as capable as Claude on my computer" *(Q11)*

Android sandboxes apps far more than a desktop; literal parity is impossible, but you get close —
*because* we sideload (Play's automation ban doesn't apply):

| Tier | What | Mechanism |
|---|---|---|
| **1 — Structured** | camera, location, SMS, notifications, sensors | first-party Android APIs |
| **2 — Computer-use** | drive any app's UI: read screen, tap, type, swipe | **AccessibilityService** + **MediaProjection** |
| **3 — Privileged (opt)** | input injection, app mgmt, settings, files | **Shizuku** (ADB-level, no root) or root |

Everything is gated by the Q8 consent model (Tier-2 defaults to `ask`). **Sequencing:** Tier 1 in v1,
Tier 2 the immediate next milestone (additive — same bus, zero foundation rework), Tier 3 optional.
Distribution = **sideloaded open-source APK**, never Play.

## Voice *(Q12)*

Voice never touches the core protocol — it's a phone-edge layer: speech→text becomes a `user_message`
event; the agent's reply is a `speak` action. **On-device by default** (privacy; "better than
Google"), pluggable to cloud STT/TTS. **On-device wake word** (Porcupine/openWakeWord) inside the
foreground service, with a **visible mic indicator + hard mute**. **Half-duplex** for v1; full-duplex/
barge-in later. Snappy real-time voice arrives with the Mode-2 warm-loop adapter.

## Roadmap

- **v1:** backbone (protocol, crypto, relay, bridge, scheduling, media, consent) + Tier-1 capabilities
  + pairing + on-device voice.
- **v2:** Tier-2 computer-use (Accessibility + MediaProjection); Mode-2 warm voice loop.
- **later:** Tier-3 (Shizuku/root); live streaming; phone-side AlarmManager scheduling; Noise-IK.

## Build status

- **`backbone/` (TypeScript): built and fully tested** — 36 passing tests covering protocol, crypto,
  relay routing/queue/wake/blobs, consent, media, scheduling, a full MCP-client→bridge→relay→phone
  end-to-end, the **QR/token pairing handshake** (`pairing.ts`), and a **raw-WS non-MCP agent adapter**
  (`examples/raw-agent.ts`). Runnable relay + bridge entrypoints.
- **`android/` (Kotlin): scaffold, UNVERIFIED** — faithfully mirrors the backbone (transport, crypto,
  consent, Tier-1 capability providers, QR pairing + biometric confirmer + encrypted storage, and the
  voice scaffold) but built without a Kotlin toolchain here; needs Android SDK + JDK 17/21 + a device.
  See `android/README.md`. Feature deps in `android/gradle/agentic-feature-deps.gradle.kts`.
