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
- [x] **Button mic wins over the speaker**: a service-owned `recording` flag (set by the hold-to-talk
      button only) stops any in-progress reply the moment you press to talk, and blocks `speak()` from
      starting one while you're holding. **Button-only by design** — the wake word does *not* barge in
      on a playing reply; it instead pauses during TTS (see the coexistence item in Phase 3).
      Device-verified: long-pressed the mic mid-reply (during the TTS speech window) → red "Listening…"
      bar active, TTS halted via `setRecording`→`stopSpeaking`, wake-word mic held by [rec] until done.
- [x] Settings: **speech rate + voice pitch** sliders (0.5–2.0×, 0.1 steps), persisted and applied
      fresh on each utterance so changes take effect immediately. Device-verified: slider→prefs
      round-trip (1.9→1.0). Engine follows the system locale; a full *named-voice* enumeration picker
      is deliberately skipped (YAGNI — audible-only, low value vs. rate/pitch).
- [x] **Smart speech for machine-junk** (extends `SpeechText.forSpeech()`): UUIDs → "a UUID",
      16+ hex blobs (md5/sha/git) → "a hash", 20+ opaque tokens w/ letter+digit (api keys/base64) →
      "an ID", file paths (unix/win) → "a file path", 7+ digit runs → "ending in NNNN". Chat keeps the
      full text; only the *ear* is filtered. 12/12 unit tests incl. regression (Android 16, 2024, 3.5,
      and/or, short model ids like CPH2653 all kept). Device: speak path unaffected (no regression).

## Phase 3 — Always-on wake word  ← **DONE (Vosk; listen path device-verified)**
Engine: **Vosk** (offline, on-device, no key) — user-chosen. Vosk does both hotword spotting and
command capture in one continuous stream (no mic handoff).
- [x] Foreground `WakeWordService` (microphone FGS, own notification). Loads
      `vosk-model-small-en-us-0.15` (fetched by a gradle task, gitignored; +`uuid` marker).
- [x] On the wake phrase → capture the rest of the utterance (or the next one) → `sendUserMessage`.
      Half-duplex: ignores the agent's own TTS (`speaking` flag), paused while hold-to-talk owns the mic.
- [x] Settings → Voice & sounds: Wake word on/off (opt-in, off by default) + editable wake phrase.
- [x] **Sensitivity** (fuzzy wake match — Vosk has no native dial; per-word Levenshtein tolerance:
      Exact/Tolerant/Loose, unit-tested), **listen-timeout** knob (3–15s, replaces the hardcoded 8s
      window), and **boot restart** (`BootReceiver` on `BOOT_COMPLETED` restarts the wake service if
      enabled + mic granted). Sliders persist (verified 14→8s). Boot receiver registered; live
      reboot-test deferred to loop end (BOOT_COMPLETED is a protected broadcast, can't be faked).
      (Per-state custom chimes → Phase 5 / W8.)
- [x] **Distinct wake-flow chimes**: added `wakeHeard()` (TONE_PROP_BEEP2 double-beep — fires the
      instant the wake phrase is recognized) and `wakeDone()` (TONE_PROP_PROMPT — at end of capture /
      command sent), both distinct from the generic `listening`/`sent`/`error` tones and gated by the
      chimes setting. Wired in `WakeWordService` (wakeHeard on bare wake phrase, wakeDone in dispatch).
      Compile + wiring verified; audible distinctness is the user's ear-check (needs a spoken wake phrase).
- [x] **Wake word must coexist with hold-to-talk + TTS (bug).** Fixed: `pause(reason)` now **fully
      releases the mic** (stop+shutdown the Vosk `SpeechService`), `resume(reason)` recreates it, and a
      reason-set ("rec"=button, "tts"=playback) means the mic only restarts once *every* holder is done.
      Both hold-to-talk (MainActivity) and TTS playback (`PhoneAgentService.speak`/`stopSpeaking`) now
      release+restore the mic, so the two input paths and TTS take turns on the one mic instead of
      fighting over it. Device-verified via logcat: TTS → "mic released (held by [tts])" → on done →
      "listening for wake phrase". (commit pending)

## Phase 4 — Multiple agents  ← **DONE (one-active; migration device-verified)**
- [x] **Data model**: `Agents` store — list of `AgentProfile {id, name, peerEdPub, relayUrl}` +
      `activeId` (encrypted). One identity keypair. Legacy single pairing migrated to profile #1.
- [x] **Pair more**: pairing appends/updates a profile (keyed by peer fingerprint) and reconnects.
- [x] **Switch**: header picker (tap the agent name) + Settings → Agents. Switching rebuilds the
      `BusEndpoint` (fresh registry) and reconnects; the agent's announced name is saved on the profile.
- [x] **Manage**: Forget an agent; the active profile shows the live connection state.
- [ ] (Later) keep several connected at once and route per message. → **moved to Phase 8.**

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
- [ ] Multiple agents connectable at once; route/select. → **moved to Phase 8.**

## Phase 5 — Polish
- [x] Tap-to-stop spoken replies; long-press a message to copy.
- [x] Durable connection: auto-reconnect with exponential backoff on a dropped link.
- [x] Animated typing dots (StatusStrip `TypingDots`, already present), **haptics on state changes**
      (tick when the agent starts working, confirm when a reply lands; phone-local states + the spoken
      reply skipped), **message timestamps** under each bubble (aligned end/start). Hub replay now carries
      `ts` so history shows real times. Device-verified: distinct replayed times (3:51/3:57/3:59) + live.
- [x] **Chime sound style** (Classic / Soft tone palettes, applied across all states; persists) and
      **"do not disturb" windows** for the wake word (enable + quiet-from/until hour sliders; the wake
      service ignores results during the window). Overnight-wrap logic in `WakeWindow` unit-tested.
      Device-verified: chime_style→soft persisted, DND on/off + 23:00–07:00 sliders. (Full per-state
      individual ringtone picker deliberately skipped — gold-plating; the palette covers it.)

## Phase 6 — Rich responses (eye vs ear)  ← **not started**
The two channels carry different loads: the **ear** gets a clean spoken summary (Phase 2 smart
speech), the **eye** gets the full rich render in chat. Agent replies are more than plain text.
- [x] **Markdown rendering** in chat bubbles: headings, bold/italic, bullets, links, inline `code`,
      fenced code blocks — a minimal subset rendered by hand to `AnnotatedString` ([Markdown.kt](android/app/src/main/java/com/agenticandroid/Markdown.kt)),
      no new dependency. Assistant text bubbles + markdown parts render it; user text stays literal; TTS
      still strips it. 6 unit tests on the plain output. Device-verified (heading/bold/italic/code/bullets).
- [x] **Images**: an `image` part `{blobId, mime, alt}` → the phone fetches + E2E-decrypts the blob
      (`fetchBlob` → `BusEndpoint.getBlob`, off-main via `produceState`), decodes, renders inline, and
      taps to a fullscreen `Dialog`. Decoded bitmaps cached per blobId. Spoken: "(an image)". Hub
      `bus.putBlob` seals for the phone; `POST /demo-image` test affordance. Device-verified: a sealed
      photo rendered inline + fullscreen. (Replay after the relay's 5-min blob TTL shows "unavailable".)
- [x] **Tables**: a `table {columns, rows}` part renders as a real grid (bold header + divider + data
      rows, columns evenly weighted, ragged rows padded). Spoken as a one-line summary ("a table with
      N rows"), not cell-by-cell. Device-verified live + on history replay. (A dedicated *chart* spec is
      deferred — YAGNI until an agent emits one; the table already carries structured data visually.)
- [x] **Receive files from the agent**: a `file-ref {blobId, name, mime, size}` part renders as a chat
      attachment chip (type icon + name + human size). Tap → SAF `CreateDocument` picker → the phone
      fetches + E2E-decrypts the blob and writes it (reuses the same blob transport as photos). Spoken:
      "(a file: <name>)". Hub `POST /demo-file` test affordance. Device-verified end-to-end: saved
      notes.txt (50 B) to /Download with exact contents. (Share-sheet is a later minor add; save shipped.)
- [x] **Wire shape** decided + plumbed: `assistant_message` keeps plain `text` (spoken/fallback) and
      MAY add `parts: MsgPart[]` — a tagged union `text | markdown | image | file | table` ([parts.ts](backbone/src/parts.ts),
      mirrored in [MsgPart.kt](android/app/src/main/java/com/agenticandroid/MsgPart.kt)). Hub forwards +
      persists + replays parts; phone parses them into `ChatMsg.parts`; speech speaks only text/markdown
      parts. Back-compat: no parts → renders `text`. Device-verified via a `demo rich` stub trigger
      ("2 parts" parsed; markdown + table placeholder rendered). image/file/table renderers follow below.

## Phase 7 — Send files from the phone (phone → agent)  ← **DONE (device-verified)**
The mirror of Phase 6's "receive files": the user attaches a file and drops it into the conversation
for the agent. Reuses the same hub blob/media path + the `file-ref` part (phone→hub direction).
- [x] Phone: 📎 attach button → SAF `OpenDocument` picker → reads bytes (name via `OpenableColumns`,
      mime via resolver) → uploads an E2E blob (`putBlob`) → shows the attachment chip in the chat.
- [x] Wire: the file rides as a `file-ref {blobId, name, mime, size}` part on `user_message`
      (phone→hub), reusing the photo blob transport.
- [x] Hub: persists the blob to `~/.agentic-android/media/files/` and records the part on the turn.
- [x] Agent side: the hub passes `{path, name, mime, size}` to the agent, which surfaces it to the
      brain as an `[Attached file: … saved at <path>]` note it can open/act on.
      Device-verified end-to-end: picked log_list.json → saved on the hub (41646 B) → agent replied
      "📎 Got your file — log_list.json (application/json) saved at …".
- Notes: large-file streaming/progress + an image thumbnail (vs the type-icon chip) are minor later adds.

## Phase 8 — Multiple agents at the hub (the core-glue redesign)  ← **not started**
**This is the consolidated home for "many agents at once."** Today the whole stack is single-agent:
the hub holds one agent connection (`agentSock`), and config/history/routing are all keyed to that
one. It must be **redesigned to hold N agents** so one hub (one machine) can run several brains and
the phone picks among them live. Supersedes the scattered notes: Phase 4 "(later) keep several
connected", Phase H "multiple agents connectable", and LOOP-STATE "Feature B — concierge".
- [ ] **Hub holds many**: `agentSock` → `agents: Map<id, {ws, name, …}>`. Per-agent conversation
      history + media (already per-agent on disk; make the in-memory routing per-agent too). One agent
      = identical behavior to today (no regression).
- [ ] **Phone sees the roster**: hub announces the connected-agents list (and changes) to the phone;
      the picker shows who's actually online *now*, not just paired profiles. Reuses the Phase 4
      Agents UI (list / switch); add a live online/offline marker per agent.
- [ ] **Switch routes at the hub**: phone selects an agent → hub routes that phone's `user_message`
      to the chosen agent and streams only that agent's replies/status back. Switching is instant,
      no re-pair, no reconnect.
- [ ] **Redesign smartly, not per-feature**: pick the routing model once — phone↔agent is a
      selected 1:1 at a time (simplest) vs. concierge "main" agent that can `ask_agent(name,…)` the
      others (LOOP-STATE Feature B). Decide before coding; the data model should not preclude
      concierge later.
- [ ] **State stays hub-owned**: swapping/forgetting an agent loses nothing; each agent's history
      replays correctly on (re)connect. Verify with ≥2 real brains (sandbox can run only one).
- Open Qs: 1:1-selected vs concierge-routed (or both, staged); how the phone shows multi-agent
      activity (badge unread per agent?); auth/identity when several agents share one hub.

## Phase 9 — Hub-owned scheduler (deferred & timed actions)  ← **not started**
**Found via a live test:** "wait 30s, then take a photo, then another" silently did nothing. Root
cause is architectural, not a one-off: a delayed action was held as a `setTimeout` inside an
**ephemeral** process; when that process was torn down during the wait, the timer died and nothing
fired. The product has the *same* flaw baked in — the only `schedule` tool is the orphaned in-memory
one in `bridge.ts` (old single-process design); the live hub (`panel.ts`) and the key-free agent
path (`agent-cli.ts`/`phone-mcp.ts`) have **no scheduler at all**.
**Principle:** a delayed/recurring action must be owned by the **always-on component (the hub)**,
never by the ephemeral agent turn or a per-process timer.
- [ ] **Move scheduling into the hub** (`panel.ts`), the always-on glue. Retire/replace the
      `bridge.ts` in-memory scheduler. The agent *requests* a schedule; the hub *holds* it.
- [ ] **Persist to disk** (`~/.agentic-android/schedule.jsonl`): each task `{id, fire_at, kind,
      method, args, agentId, recurrence?}`. On hub startup, load + re-arm everything still pending —
      otherwise a hub restart loses timers (the same bug one level up).
- [ ] **On fire, the hub acts + wakes the agent**: run the phone action itself, then deliver a
      `task.result` to the owning agent (spawn `claude -p --resume` in the key-free path, or push to
      the connected WS agent). Works even if the agent that scheduled it has since disconnected.
- [ ] **Tool surface**: `schedule(when, method, args)` accepting a delay *or* an absolute time, plus
      `list_scheduled()` and `cancel(id)`. Expose to WS agents and via phone-mcp.
- [ ] **Recurrence (cron)**: optional repeating tasks ("every morning…"). Ties into the
      assistant/concierge feel; one-shot first, recurring behind the same store.
- Open Qs: timezone/DST for absolute times; max in-flight tasks; per-agent vs hub-global ownership
      when an agent is forgotten (Phase 8); does a fired task also surface in the phone chat log.
- Note: mirrors the harness lesson — for *my own* multi-step waits use a scheduled wake-up, not a
      background `sleep`, for the same reason.

---

## Settings inventory (the single source of truth for "configurable")
| Setting | Phase | Status |
|---|---|---|
| Theme (system/light/dark) | 0 | [x] |
| Actions the agent can use (per-capability on/off) | 0 | [x] |
| Chimes on/off | 1 | [x] |
| Speak replies (TTS) on/off | 2 | [x] |
| TTS speech rate + voice pitch | 2 | [x] |
| Wake word on/off | 3 | [x] |
| Wake phrase | 3 | [x] |
| Wake sensitivity / listen timeout / boot restart | 3 | [x] |
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
