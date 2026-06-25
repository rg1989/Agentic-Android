# Agentic Android — Assistant Experience Plan

The north star: the phone app feels like talking to a real assistant. You speak (wake word or
hold-to-talk), it chimes to tell you it's listening, transcribes, shows what it's doing
(thinking / running an action / replying), answers — by voice and text. You can run **several
agents** (one per computer) and switch between them from the UI. Everything tunable lives in
**Settings**.

## Architecture — the hub is the glue (read this first)

The system is **glue** between two **replaceable** things: the **agent** (any LLM brain — Claude
today, another tomorrow) and the **phone/app** (the user's device + input surface). The glue is the
**hub**: a persistent service on the machine that

- the **phone connects to** (the app),
- the **agent connects to** (a replaceable client),
- **holds all state** — config, event history, conversation, and media (photos) — in one place
  under `~/.agentic-android/`, and
- **mediates everything** between the user (on the phone) and the agent.

Neither the agent nor the phone owns state — the **hub** does. Swapping the agent or the app must
not lose anything, because the hub holds it. Flow: **phone ⇄ hub ⇄ agent**.

**Current reality:** the hub (`panel.ts`) and the agent (`agent.ts`) are **separate processes** — the
agent dials the hub's local WebSocket (`:8124`) and is swapped without touching the hub or re-pairing.
The hub owns config, event log, media, and now the conversation. The `relay` is the dumb transport
both sides reach. Remaining for Phase H: run the hub as a managed OS service (launchd/systemd).

---

## Status legend
`[x]` done & device-verified · `[~]` partial/scaffolded · `[ ]` not started

## Done before this plan
- [x] Paired phone, 24 capabilities incl. computer-use, E2E bus.
- [x] Chat UI (agent-identity header, bubbles, IME handling), humanized replies.
- [x] Settings: theme (system/light/dark) + per-action on/off (enforced in the registry).
- [x] Hold-to-talk voice (on-device SpeechRecognizer → transcript → send).

---

## Phase 1 — Conversational status + chimes  ← **DONE (device-verified)**
Make a single exchange feel alive. No new dependencies.
- [x] **Agent run-state protocol**: brain emits `agent_status {label}` bus events: `Thinking…`,
      `📷 Taking a photo…`, etc. Phone clears it when the `assistant_message` arrives.
      ([brain.ts](backbone/src/brain.ts) `friendlyStatus`).
- [x] **Status indicator in chat**: live italic row at the bottom of the transcript
      (phone-local `Transcribing…`/`Sending…` + brain-side states). Verified: caught
      "📷 Taking a photo…" rendering live mid-action.
- [x] **Chimes**: [Chimes.kt](android/app/src/main/java/com/agenticandroid/Chimes.kt) `ToneGenerator`
      tones — *listening* / *sent* / *error*. Gated by the setting.
- [x] **Settings → Voice & sounds**: Chimes on/off. Verified persists to disk both ways
      (`agent_settings.xml`). (Audible test = user; like real STT/TTS.)

## Phase 2 — Spoken replies (TTS) + barge-in  ← **DONE (device-verified)**
- [x] Speak `assistant_message` via Android `TextToSpeech` (Settings: Speak replies on/off, default on).
- [x] **Speech cleaning**: a separate `SpeechText.forSpeech()` pass strips JSON/braces/URLs/emoji and
      shortens long numbers for the *ear only* (chat keeps full text). Unit-tested.
- [x] "🔊 Speaking…" status + tap-to-stop; barge-in stops TTS when a new turn starts.
- [ ] Settings: pick TTS voice/locale, speech rate. (later)

## Phase 3 — Always-on wake word  ← **DONE (Vosk; listen path device-verified)**
Engine: **Vosk** (offline, on-device, no key) — user-chosen. Vosk does both hotword spotting and
command capture in one continuous stream (no mic handoff).
- [x] Foreground `WakeWordService` (microphone FGS, own notification). Loads
      `vosk-model-small-en-us-0.15` (fetched by a gradle task, gitignored; +`uuid` marker).
- [x] On the wake phrase → capture the rest of the utterance (or the next one) → `sendUserMessage`.
      Half-duplex: ignores the agent's own TTS (`speaking` flag), paused while hold-to-talk owns the mic.
- [x] Settings → Voice & sounds: Wake word on/off (opt-in, off by default) + editable wake phrase.
- [ ] Per-state chimes / sensitivity / listen-timeout knobs; boot restart. (later)
- Note: "speak the phrase → triggers" is voice/hardware-dependent (user-verified). Parsing unit-tested;
  model-load + listen path verified via logcat.

## Phase 4 — Multiple agents  ← **DONE (one-active; migration device-verified)**
- [x] **Data model**: `Agents` store — list of `AgentProfile {id, name, peerEdPub, relayUrl}` +
      `activeId` (encrypted). One identity keypair. Legacy single pairing migrated to profile #1.
- [x] **Pair more**: pairing appends/updates a profile (keyed by peer fingerprint) and reconnects.
- [x] **Switch**: header picker (tap the agent name) + Settings → Agents. Switching rebuilds the
      `BusEndpoint` (fresh registry) and reconnects; the agent's announced name is saved on the profile.
- [x] **Manage**: Forget an agent; the active profile shows the live connection state.
- [ ] (Later) keep several connected at once and route per message. Two-distinct-agent switching
      reuses the verified connect path but needs a second paired hub to exercise live.

## Phase H — Make the hub a real, separate service (architectural)
The glue, decoupled from any one agent. Foundational — informs Phases 3–4.
- [x] **Split the agent out of the hub** (device-verified): the hub (`panel.ts`) exposes an agent
      WebSocket on `:8124`; the brain runs as its OWN process ([agent.ts](backbone/src/agent.ts),
      `pnpm agent`) that connects in. Hub forwards user messages → agent; agent asks the hub to run
      capabilities; hub executes against the phone, persists media, relays replies. Verified: kill
      the agent → hub survives + `/say` returns 503; restart → reconnects, full loop works (battery,
      photo, identity, status). Brain talks only to an `AgentBus` interface — no bus/blob/media access.
- [x] Phone connects to the hub; the hub mediates and (for media) persists every exchange.
- [x] **Hub owns state**: config, event log, **media**, and now **conversation history**
      (`conversation.jsonl`, per agent) under `~/.agentic-android/`. The hub replays history to the
      phone on connect (`whoami` → `history` event); the phone renders it. Device-verified.
- [ ] **Run as a managed service** on the machine (launchd/systemd): auto-start, restart on crash,
      relay folded in or beneath the hub. (The *phone* now auto-reconnects with backoff.)
- [ ] Multiple agents connectable at once; route/select per the multi-agent work (Phase 4).

## Phase 5 — Polish
- [x] Tap-to-stop spoken replies; long-press a message to copy.
- [x] Durable connection: auto-reconnect with exponential backoff on a dropped link.
- [ ] Animated typing dots, haptics on state changes, message timestamps.
- [ ] Per-state custom chime sounds; "do not disturb" windows for the wake word.

---

## Settings inventory (the single source of truth for "configurable")
| Setting | Phase | Status |
|---|---|---|
| Theme (system/light/dark) | 0 | [x] |
| Actions the agent can use (per-capability on/off) | 0 | [x] |
| Chimes on/off | 1 | [x] |
| Speak replies (TTS) on/off | 2 | [x] |
| TTS voice / rate | 2 | [ ] |
| Wake word on/off | 3 | [x] |
| Wake phrase | 3 | [x] |
| Wake sensitivity / listen timeout / per-state chime | 3 | [ ] |
| Agents: list / add / switch / forget | 4 | [x] |

## Protocol additions (brain ↔ phone, over the existing bus)
- `agent_status` (brain→phone): `{ label: string }` — transient "what I'm doing now". Cleared by
  the next `assistant_message`. (Phase 1)
- Reuses existing `user_message`, `assistant_message`, `whoami`, `agent_identity`.

## Open decisions
1. **Wake-word engine**: Vosk (recommended, offline/free) vs Porcupine (better, needs key). Decide
   at the start of Phase 3; no dependency added until then.
2. **TTS**: Android built-in `TextToSpeech` (no dep) — good enough; revisit only if quality is poor.
3. **Multiple agents simultaneously vs one-active**: ship one-active first (simplest, intuitive),
   add concurrent later.

## Where to resume
Pointer lives here + in `backbone/LOOP-STATE.md`. Phases 1–5 are done (one-active multi-agent;
wake word offline via Vosk; TTS with speech-cleaning; hub-owned history; auto-reconnect). **What's
left:** run the hub as a managed service (Phase H — launchd/systemd); multiple agents connected at
once + per-message routing (Phase 4 later); the smaller knobs (TTS voice/rate, wake sensitivity/
timeout, typing dots/haptics/timestamps). Set `ANTHROPIC_API_KEY` (agent.json `brain`) to swap the
keyword stub for real Claude.
