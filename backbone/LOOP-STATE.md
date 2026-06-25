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
- [ ] 0. App icon — replace Bluetooth notification icon; add a real launcher icon.
- [ ] 1. TTS spoken replies + speech sanitizer (strip JSON/braces/URLs/emoji/long numbers) + setting.
- [ ] 2. Multiple agents — profile list, pair-more, switch in UI + settings.
- [ ] 3. Polish to feel finished — timestamps, copy, tap-to-stop speech, empty/error states.
- [ ] 4. Hub owns conversation history (Phase H) — persist + replay on connect.
- [ ] 5. Wake word (Phase 3) — pragmatic; decide engine or flag the dependency.

## Log
- init: Bluetooth icon = PhoneAgentService.kt:146 `stat_sys_data_bluetooth`. No launcher icon / no
  mipmap assets. voice/ pkg: TextToSpeech wrapper good+reusable, VoiceController over-coupled+unused.
  JUnit available. Tree clean at dc8081d.
