# LOOP-STATE — Agentic Android

## Run 5 — UI/UX overhaul "finish everything" (in progress)
Build+install+device-verify+commit per item. Done so far (committed): Material-icon passes (1-3),
status-strip emoji decouple, chat/voice fixes (file readout natural name+type, in-chat mute w/ wake
override), 4-theme system (light+dark each).
Worklist remaining:
- [x] U1 Settings tabs (General/Theme/Voice/Actions); Actions on own tab; connect toggle pinned. Device-verified.
- [x] U2 Slash palette = floating inset card (border, ~4 rows + scroll, gaps). Device-verified.
- [x] U3 File preview popup (text/code inline, Close/Download/Share); tap file = preview. Device-verified (notes.txt content shown).
- [x] U4 Per-message menu: file chip ⋮ -> Preview/Download/Share; image fullscreen -> Download/Share; FileProvider for share. Text copy = long-press (kept). Device-verified.
- [ ] U5 Multi-session backend (hub): sessions per agent, auto-title from 1st user msg, storage + wire (list/new/switch/delete).
- [ ] U6 Header redesign: agent name centered (2 rows: name + status dot/text); remove dropdown; hamburger left.
- [ ] U7 Hamburger LEFT drawer: agents -> their sessions; new chat; open chat; delete chat; change agent.
- [ ] U8 Chat actions wired: new chat / delete (clear) session; copy.
Decisions: session title = first user message trimmed (~40 chars); reply emoji = keep (conversational, stripped from speech). Test agent = Claude (running) for round-trips; use /demo-file,/demo-image,/say for deterministic checks.


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
- [x] 5. Wake word (Phase 3) — **Vosk** (offline), user-chosen. Always-on WakeWordService + model.

## Session 3 — key-free agents (A), UI glow-up, wake word selection
- [x] UI: mic button restyled (purple circle + ic_mic, matches Send); ListeningGlow edge animation
      while recording/wake-listening; wake-phrase presets in Settings; partial wakelock for
      screen-off wake. Device-verified (mic screenshot, settings screenshot). commit 71677e8.
- [x] **A — key-free agent path.** `phone-mcp.ts` (stdio MCP server: phone caps → hub /call) +
      `agent-cli.ts` (`pnpm agent:claude`: runs YOUR `claude -p` with phone-mcp as tools; auth lives
      in your CLI, never here). The built-in brain demoted to an optional keyword fallback; no more
      "set ANTHROPIC_API_KEY" nag. Verified: phone-mcp listed 23 tools + device_info returned real
      OnePlus data; agent-cli loop verified with a mock CLI. commit 87279e5.
      - NOTE: real `claude -p` 401s in this sandbox (no creds) — the model leg is **user-verified**
        on a machine where `claude` is logged in. See [[agent-auth-sandbox]].
- [ ] **B — appoint a connected agent as "main" (concierge).** STAGED, not started. Plan:
      1. Hub (`panel.ts`): `agentSock`→`agents: Map<id,{ws,name}>` + `mainId`. Keep single-agent
         behavior identical (first/only agent = main). Route phone user_message → main agent.
      2. Two hub-handled tools for the main agent: `list_agents()` (roster) and
         `ask_agent(name, prompt)` (forward to another agent's ws, correlate its assistant_message,
         return it). Expose them to WS agents via `{t:tool}` and to the CLI agent via phone-mcp.
      3. Phone: a "main" marker/toggle in the Agents picker (Agents.mainId).
      Why staged: needs ≥2 real brains to verify orchestration (sandbox can't run one), and it
      refactors the core glue — not worth doing untested while the app must stay working.

## To run on YOUR Claude (no key): `claude login` once, then `pnpm agent:claude` (instead of `pnpm agent`).

## Run 4 — overnight finishing run (autonomous; started 2026-06-26)
Goal: every unimplemented PLAN.md item (`[ ]`/`[~]`) implemented + verified. Run until done or all-blocked.
Decisions (user): **Phase 8 = SAFE — never commit a change that breaks the working single-agent app**
(implement behind no-regression; if multi-brain routing can't be verified solo, leave single-agent path
untouched + flag). **Git = one commit per item on `feature/phone-agent-computer-use`, NO push.**
Defaults: launchd (Phase H) = write+test plist, do NOT install a system service unattended — leave for user.
Audible/2-brain checks = verify code path via logcat, flag for user. Test with the **basic** agent.
Keep device awake (`svc power stayon true`); re-add `adb reverse tcp:8799 tcp:8799` after every reinstall.

Stop: all items `[x]` → done · 3 failed tries on one item → mark blocked, move on · all remaining blocked → stalled.
ONE bounded item per iteration; never weaken a test to pass; tick PLAN.md box + commit per item.

Worklist (highest value / lowest risk first — status: [ ] todo · [~] code-done-needs-verify · [x] done · [B] blocked):
- [x] W1  Wake-word coexist bug FIXED + device-verified (logcat: mic released on TTS, restarts after). commit 760c1f5.
  >> END-OF-RUN CLEANUP (restore user's original state): wake word OFF, chime style → classic, DND OFF, TTS rate/pitch 1.0, restore Claude agent (`pkill -f agent.ts; pnpm -C backbone agent:claude`), `svc power stayon false`, and do the deferred `adb reboot` test of BootReceiver.
- [x] W2  "button mic wins" device-verified: long-press mid-TTS → red "Listening…" bar, TTS halted. (verify-only, doc commit)
- [x] W3  Smart-speech junk filter (UUID/hash/ID/path/long-digits) + 12/12 unit tests, no speak regression. commit pending below.
- [x] W4  Chat polish: timestamps under bubbles (hub replay carries ts) + state-change haptics; typing dots already existed. Screenshot-verified. commit pending.
- [x] W5  Distinct wake-flow chimes (wakeHeard=double-beep, wakeDone=prompt) wired in WakeWordService. Compile-verified; audible=user. commit pending.
- [x] W6  TTS speech rate + voice pitch sliders (persist+apply). Device-verified prefs round-trip 1.9->1.0. Named-voice catalog skipped (YAGNI). commit pending.
- [x] W7  Wake sensitivity (fuzzy match, unit-tested) + listen-timeout slider (persist 14->8) + BootReceiver (registered; reboot-test deferred to loop end). commit pending.
- [x] W8  Chime style (Classic/Soft palette) + wake-word DND windows (WakeWindow unit-tested overnight wrap). Device-verified persist + sliders. commit pending.
- [x] W9  Wire shape: typed parts (text/markdown/image/file/table), hub persist+replay, phone parse+render (placeholders), speech routing. Demo-verified "2 parts". commit pending.
- [x] W10 Markdown rendering (hand-rolled AnnotatedString, no dep) for assistant bubbles + md parts; 6 unit tests; device-verified styled. commit pending.
- [x] W11 Inline agent images (image-ref part, E2E blob fetch+decode, tap fullscreen, cache). Hub /demo-image. Device-verified inline + fullscreen. commit pending.
- [x] W12 Receive files: file-ref chip + SAF save (E2E blob -> write). Device-verified notes.txt 50B to /Download. Hub /demo-file. commit pending.
- [x] W13 Table part renders as a grid (header+divider+rows); spoken one-line summary. Device-verified live + replay. Charts deferred (YAGNI). commit pending.
- [x] W14 Send files phone->agent: attach->SAF->blob->user_message file part; hub persists to media/files; agent gets path+mime. Device-verified log_list.json round-trip. commit pending.
- [x] W15 Hub scheduler (scheduler.ts + 5 tests): persist/rearm/fire/recurrence; WS tools + HTTP + phone-mcp. Device-verified schedule->fire->chat + rearm across restart. commit pending.
- [x] W16 Multi-agent hub (SAFE, additive): roster Map + select_agent routing; agentSock=active preserved (no regression). VERIFIED with 2 stub agents Ada/Bob (select Bob -> reply switches to Bob). commit pending.
- [x] W17 launchd plist + service-run.sh + README written; load/unload lifecycle verified; NOT installed (per decision). TCC blocks ~/Documents for launchd — documented (move checkout or grant FDA). Plist correct. commit 1209763.
- [x] W7-followup BootReceiver REBOOT-TEST PASSED at loop end: after real `adb reboot` the wake service was running with the app never launched.

## RUN 4 COMPLETE — all 17 items done (16 fully [x], W17 [x] w/ documented macOS TCC caveat). Terminal state: DONE.
Cleanup done: settings restored (wake word OFF, chime classic, TTS 1.0), `svc power stayon false`, Claude agent restored + E2E-verified ("100% and charging" via real Claude + live phone tools).
LEARNED (save to memory): the phone reaches the hub over **Tailscale** (`phoneRelayUrl=http://100.106.88.65:8799`), NOT the adb tunnel — `adb reverse tcp:8799` is redundant. After a phone **reboot** the Tailscale VPN is DOWN and must be reconnected (open the Tailscale app → it auto-starts), else the app shows "Can't reach your hub" even with the stack up + tunnel working. Relay MUST be started with `PORT=8799`.

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
