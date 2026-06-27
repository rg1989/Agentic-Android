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
      **boot restart device-verified** (loop end): after a real `adb reboot` the wake service was
      running with the app never launched — `BootReceiver` started it on `BOOT_COMPLETED`.
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

## Phase 4 — Multiple hubs  ← **DONE (multi-hub always-on; migration device-verified)**
- [x] **Data model**: `Agents` store — list of `AgentProfile {id, name, localName?, peerEdPub, relayUrl}`
      (each profile is a paired **hub**) + one identity keypair (encrypted). Each hub carries a `name`
      (from the hub, default its hostname) and an optional per-phone `localName` override; the displayed
      label is `display() = localName ?: name`. Legacy single pairing migrated to profile #1.
- [x] **Pair more**: pairing appends/updates a profile (keyed by peer fingerprint). The phone stays
      connected to **all** paired hubs at once — `HubConnection` owns one `BusEndpoint` + that hub's
      roster, and `PhoneAgentService` orchestrates a `Map<hubId, HubConnection>` (no switch-to-reconnect).
- [x] **Foreground hub**: header picker (tap the agent name) + Settings → Hubs. Re-pointing the
      foreground hub (`switchHub`) does **not** reconnect — every paired hub is already live; the rename
      is stored as the profile's `localName`.
- [x] **Manage**: Forget/unpair a hub (`forgetHub`); the drawer's hub list shows each hub's live
      online/offline state.
- [x] (Later) keep several connected at once and route per message. → **done in Phase 8.**

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
- [~] **Run as a managed service** (launchd): wrote [com.agenticandroid.hub.plist](launchd/com.agenticandroid.hub.plist)
      (RunAtLoad + KeepAlive=restart-on-crash) + [service-run.sh](backbone/service-run.sh) (starts relay,
      execs hub; bare-env PATH set) + [install README](launchd/README.md). `launchctl load`/`unload`
      lifecycle verified. **Not auto-installed (per overnight decision — left for user).** Test surfaced
      a macOS **TCC** caveat: launchd can't read this checkout under `~/Documents` ("Operation not
      permitted") — fix is to move the checkout out of a protected folder or grant Full Disk Access
      (documented in the README). Plist/script are otherwise correct.
      → **SUPERSEDED by Phase 10**: the hand-installed plist isn't a premium experience. Keep it as the
        low-level mechanism, but the user-facing answer is a menu-bar app (Start/Stop + Launch-at-login),
        which also sidesteps the TCC issue by running from `/Applications`.
- [x] Multiple agents connectable at once; route/select. → **done in Phase 8.**

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
      N rows"), not cell-by-cell. Device-verified live + on history replay. (A dedicated *chart* part is
      **DROPPED** — the agent can render a chart as an image, which the image part already shows.)
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
- [x] **Upload progress + image thumbnails** (the two "minor later adds"). Attach shows a pending chip
      with a live progress bar ("uploading… N%") streaming the sealed buffer in 64 KB chunks; image
      attachments render a real thumbnail instead of the generic file icon. Device-verified (386 KB photo:
      pending chip → thumbnail chip; hub persisted the .jpg, agent received it). commit 66f006f.
      Streamed *crypto* (vs sealing the whole file in memory) deferred until 100s-of-MB files appear.

## Phase 8 — Multiple agents at the hub  ← **DONE (SAFE, device-verified w/ 2 stub agents)**
Implemented the **1:1-selected** routing model (the simplest the plan flagged) in a **SAFE, additive**
way: `agentSock` stays the *active* agent (so single-agent behavior is byte-identical and there's no
regression), with a parallel roster tracking everyone connected. Concierge `ask_agent` (LOOP-STATE
Feature B) stays a clean future layer on top — the data model doesn't preclude it.
- [x] **Hub holds many**: added `agents: Map<id,{ws,name}>` + `activeAgentId` alongside `agentSock`.
      A 2nd agent connecting joins the roster but does NOT steal active (preserves single-agent flow);
      when the active agent leaves, the hub promotes another. (Per-agent history/media already on disk.)
- [x] **Phone sees the roster**: hub emits `agents_roster {agents:[{id,name,active}]}` on connect/
      change/whoami; each `HubConnection` tracks its own roster and the service unions them into
      `allAgents`. The header picker lists agents across **all online hubs**, grouped by hub.
- [x] **Switch routes at the hub**: `selectAgent {id}` → hub repoints `agentSock` + re-announces
      identity/roster (within the foreground hub). Cross-hub, `selectAgentOnHub` foregrounds the
      target's hub and routes to it. Instant, no re-pair, no reconnect.
- [x] **Routing model decided**: 1:1-selected (active agent gets the phone's messages). Concierge
      left as a future layer.
- [x] **State stays hub-owned**: switching just repoints the active socket; nothing is lost.
      **Verified with 2 stub agents (Ada + Bob)** — `AGENT_NAME` env makes them distinguishable +
      a "who are you" stub reply proves routing: roster showed Ada*+Bob, selecting Bob made replies
      switch from "I'm Ada" → "I'm Bob", header updated to Bob. (Real-brain concierge still needs ≥2
      real brains; the routing core is proven.)
- Open Qs: concierge `ask_agent` orchestration = **Feature B** (deferred by user; needs 2 live brains
      to verify). Per-agent unread badges = **DROPPED** (only meaningful once Feature B exists). Auth
      when several agents share one hub = **deferred security gate** — fine on a single-user private
      Tailscale tailnet; REQUIRED before any shared/exposed hub. Resolved: 1:1-selected routing.

## Phase 9 — Hub-owned scheduler (deferred & timed actions)  ← **DONE (device-verified)**
**Found via a live test:** "wait 30s, then take a photo, then another" silently did nothing. Root
cause is architectural, not a one-off: a delayed action was held as a `setTimeout` inside an
**ephemeral** process; when that process was torn down during the wait, the timer died and nothing
fired. The product has the *same* flaw baked in — the only `schedule` tool is the orphaned in-memory
one in `bridge.ts` (old single-process design); the live hub (`panel.ts`) and the key-free agent
path (`agent-cli.ts`/`phone-mcp.ts`) have **no scheduler at all**.
**Principle:** a delayed/recurring action must be owned by the **always-on component (the hub)**,
never by the ephemeral agent turn or a per-process timer.
- [x] **Scheduling lives in the hub** ([scheduler.ts](backbone/src/scheduler.ts), instantiated in
      `panel.ts`) — the agent *requests*, the hub *holds*. (`bridge.ts`'s old in-memory scheduler is
      superseded; the live path no longer uses it.) Core logic is injectable + 5 unit tests.
- [x] **Persists to disk** (`~/.agentic-android/schedule.jsonl`): `{id, fireAt, method, args, everyMs?,
      agentId, createdAt}`. On startup `loadAndArm()` re-arms pending tasks. Device-verified: a task
      survived a hub restart (same id/fireAt reloaded) — fixing the original ephemeral-timer bug.
- [x] **On fire, the hub acts + surfaces it**: runs the phone action via the bus, posts a "⏰ Ran
      scheduled <method> — <result>" turn to the phone chat (spoken too), and pushes a `task_result` to
      the connected WS agent. Device-verified: scheduled `device.info` fired + showed in chat.
      (Key-free `claude -p --resume` wake on fire is a later refinement; WS-agent delivery + chat
      surfacing work today.)
- [x] **Tool surface**: `schedule({method, args, delayMs|atMs, everyMs?})`, `list_scheduled()`,
      `cancel_scheduled({id})` — exposed to WS agents (appended to the catalog, hub-intercepted),
      over HTTP (`/schedule`, `/scheduled`, `/cancel`), and via **phone-mcp** (key-free path).
- [x] **Recurrence**: `everyMs` repeating tasks (re-arms after each fire; unit-tested). Full cron-
      expression parsing ("every morning at 8") is a later add on the same store.
- Open Qs (still open): timezone/DST for absolute times; max in-flight tasks; per-agent ownership when
      an agent is forgotten (Phase 8). Resolved: a fired task DOES surface in the phone chat log.
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
| Hubs: list / pair / rename / forget | 4 | [x] |

## Phase 10 — Premium install: macOS menu-bar app  ← **planned (not started)**
Goal: a real, premium install experience — no terminals, no scripts, no plist-editing, no TCC dance.
The user installs the Mac side like any app and controls it from the menu bar; the phone side stays the
APK (→ signed APK → Play Store later). Supersedes the hand-installed launchd item in Phase H.
- [ ] Menu-bar app (Swift / `SMAppService`) that bundles node + the backbone (relay + hub + agent) in
      its `.app` and lives in `/Applications` (running from there sidesteps the `~/Documents` TCC block).
- [ ] Menu: **Start / Stop** (full manual control), **Launch at login** toggle (`SMAppService`, no plist),
      a **status line** (running/stopped, agents connected), and Open-logs / Quit.
- [ ] Supervises the child process: auto-restart on crash (the KeepAlive the plist gave us, but app-owned).
- [ ] Data stays in `~/.agentic-android` (already outside TCC); first-run sets up config/pairing.
- [ ] Distribution: signed + notarized `.dmg` (drag to Applications). Android: signed APK → Play Store.
Open Qs: Swift native vs a tiny Tauri/Electron tray wrapper (lean Swift — smallest, most "Mac"); how to
bundle/locate node (embed a pinned node vs require a system one); code-signing/notarization account.

## Protocol additions (brain ↔ phone, over the existing bus)
- `agent_status` (brain→phone): `{ label: string }` — transient "what I'm doing now". Cleared by
  the next `assistant_message`. (Phase 1)
- Reuses existing `user_message`, `assistant_message`, `whoami`, `agent_identity`.

## Open decisions
1. **Wake-word engine**: Vosk (recommended, offline/free) vs Porcupine (better, needs key). Decide
   at the start of Phase 3; no dependency added until then.
2. **TTS**: Android built-in `TextToSpeech` (no dep) — good enough; revisit only if quality is poor.
3. **Multiple hubs simultaneously vs one-active**: shipped one-active first, then **moved to
   always-on multi-hub** — the phone stays connected to every paired hub at once (Phase 4).

## Where to resume
Pointer lives here + in `backbone/LOOP-STATE.md`. Phases 1–9 are done (always-on multi-hub — the phone
stays connected to every paired hub, with a cross-hub agent picker, named hubs, and QR-or-code pairing;
wake word offline via Vosk; TTS with speech-cleaning; hub-owned history; auto-reconnect; rich
parts — markdown/image/file/table; send files both ways with upload progress + thumbnails; scheduler).
**What's left:**
- **Phase 10 — premium macOS menu-bar install** (planned, not started) — the user-facing answer to
  "run it as a service"; replaces the hand-installed launchd plist.
- **Feature B — concierge `ask_agent`** (deferred by user; needs 2 live brains to verify).
- **Deferred security gate** — agent auth when a hub is shared/exposed (fine on a private tailnet now).
Dropped: native chart part, per-agent unread badges. Use `pnpm agent:claude` (your logged-in CLI) for
the real brain — no API key needed.
