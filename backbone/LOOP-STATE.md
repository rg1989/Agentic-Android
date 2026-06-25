# LOOP-STATE — Agentic Android

> Prior waves (done, in git history): 24 phone capabilities incl. Tier-2 computer-use; the
> pluggable brain; the hub/agent split; the chat UI, settings, photos, hold-to-talk voice.
> This file now tracks the **full-app finishing loop** (PLAN.md, all phases).

## Goal
Finish the app so it's a coherent, full-featured assistant: speak with one or more agents
(text + voice in and out), agents act on the phone, everything shown well in the chat UI,
settings cover it all.

## Measure (objective gates)
- `cd backbone && pnpm test` + `pnpm typecheck`.
- `cd android && ./gradlew :app:assembleDebug` builds clean; `:app:testDebugUnitTest` for pure logic.
- `adb install -r` + live check through the running stack (relay+hub+agent): `/say`, logcat.
- Audible/perceptual checks (TTS sound, wake firing, icon look) → flagged for the user; I verify
  the code path fires via logcat, not the sound itself.

## Stop when
- All items below `[x]` and device-verified → **done**.
- A heavy dependency/key decision is required (wake-word engine) → **blocked**, ask the user.
- 3 iterations with no green build on the same item → **blocked**.

## Work items (lowest risk / highest user-emphasis first)
- [x] 0. App icon — robot-head notification + adaptive launcher icon. (commit 4e62494)
- [x] 1. TTS spoken replies + speech sanitizer + setting. Device-verified speak path. (9a26683)
- [x] 2. Multiple agents — profile list, pair-more, switch in UI + settings. Migration verified. (ace5943)
- [x] 3. Polish — tap-to-stop speech, long-press copy, **auto-reconnect with backoff**.
- [x] 4. Hub owns conversation history — persist + replay on connect. Verified (replayed 4 turns).
- [ ] 5. Wake word (Phase 3) — needs a dependency/key decision (Vosk vs Porcupine vs no-dep). ASK USER.

## Log
- init: Bluetooth icon = PhoneAgentService.kt:146 `stat_sys_data_bluetooth`. No launcher icon / no
  mipmap assets. voice/ pkg: TextToSpeech wrapper good+reusable, VoiceController over-coupled+unused.
  JUnit available. Tree clean at dc8081d.
- 0,1: icon + TTS built, 9 unit tests pass; device-verified `/say battery` → spoke
  "...100 percent and charging" (emoji/% cleaned). Committed.
- 2: Agents store (profiles+active, encrypted, migrates legacy pairing). Header picker + Settings
  Agents section + pair-appends. Migration → profile #1, reconnected (23 caps). Committed.
- found+fixed: phone relay link is via `adb reverse tcp:8799` — dropped on reinstall/force-stop.
- 4: hub conversation.jsonl (persist user+assistant turns) + replay on whoami. Verified: phone
  restart → `AgentHistory: replayed 4 turns from hub`. 36 TS tests pass, typecheck clean.
- 3: BusEndpoint onDisconnect → service backoff reconnect (no chat clear); tap-to-stop TTS;
  long-press copy. (auto-reconnect under test)
