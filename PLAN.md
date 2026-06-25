# Agentic Android — Assistant Experience Plan

The north star: the phone app feels like talking to a real assistant. You speak (wake word or
hold-to-talk), it chimes to tell you it's listening, transcribes, shows what it's doing
(thinking / running an action / replying), answers — by voice and text. You can run **several
agents** (one per computer) and switch between them from the UI. Everything tunable lives in
**Settings**.

Architecture (unchanged): **you → agent(s) → phone**. The agent (a self-hosted/cloud brain) owns
the bus and drives the phone; the phone app is your input/output surface; the control panel is
monitoring. This plan only adds to the phone app + the brain's event vocabulary.

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

## Phase 2 — Spoken replies (TTS) + barge-in
- [ ] Speak `assistant_message` via Android `TextToSpeech` (Settings: Voice replies on/off).
- [ ] "Speaking…" status + tap-to-stop; stop TTS when a new turn starts.
- [ ] Settings: pick TTS voice/locale, speech rate.

## Phase 3 — Always-on wake word (persistent, background)
The headline feature. A foreground service listens for a wake phrase, then runs the
listen→transcribe→send→reply→speak loop hands-free, with a chime at each state transition.
- **Engine decision (open, see below):** default **Vosk** (offline, open-source, no key/cloud —
  fits the self-hosted ethos) for hotword spotting; keep SpeechRecognizer for command capture so
  we don't run heavy STT continuously. Alt: Picovoice Porcupine (smaller/better, needs free key).
- [ ] Foreground `WakeWordService` (own notification, mic ownership, hard-mute respected — the
      `micMuted` flag already exists in `PhoneAgentService`).
- [ ] State machine: idle → wake-detected (chime) → listening (chime) → transcribing → sending →
      thinking → responding (speak). Each transition chimes + updates the chat status.
- [ ] Battery/Doze handling; restart on boot (`RECEIVE_BOOT_COMPLETED` already declared).
- [ ] Settings → Voice & sounds: Wake word on/off, wake phrase, sensitivity, per-state chime
      on/off, "listen timeout".

## Phase 4 — Multiple agents
- [ ] **Data model**: replace single pairing with a list of `AgentProfile {id, name, relayUrl,
      peerEdPub}` + an `activeAgentId`. The phone keeps **one** identity keypair; each agent knows
      the phone's pubkey. (Migrate the existing single pairing into profile #1.)
- [ ] **Pair more**: pairing flow appends a profile instead of overwriting (drop the TOFU
      "first wins" lock; key it per relay).
- [ ] **Switch**: a picker in the header (tap the agent name) + a list in Settings → Agents.
      Switching rebuilds the `BusEndpoint` for the selected profile and reconnects.
- [ ] **Manage**: rename / remove an agent; show connection state per profile.
- [ ] (Later) keep several connected at once and route per message.

## Phase 5 — Polish
- [ ] Animated typing dots, haptics on state changes, message timestamps.
- [ ] Per-state custom chime sounds; "do not disturb" windows for the wake word.
- [ ] Retry/offline affordances in the chat.

---

## Settings inventory (the single source of truth for "configurable")
| Setting | Phase | Status |
|---|---|---|
| Theme (system/light/dark) | 0 | [x] |
| Actions the agent can use (per-capability on/off) | 0 | [x] |
| Chimes on/off | 1 | [x] |
| Voice replies (TTS) on/off | 2 | [ ] |
| TTS voice / rate | 2 | [ ] |
| Wake word on/off | 3 | [ ] |
| Wake phrase | 3 | [ ] |
| Wake sensitivity | 3 | [ ] |
| Per-state chime on/off | 3 | [ ] |
| Listen timeout | 3 | [ ] |
| Agents: list / add / switch / rename / remove | 4 | [ ] |

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
Pointer lives here + in `backbone/LOOP-STATE.md`. Each phase's checklist is the resumable unit:
pick the first `[ ]` in the lowest unfinished phase. **Next: Phase 2 — Spoken replies (TTS).**
(Phase 1 done & device-verified.)
