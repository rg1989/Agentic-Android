# Codebase Concerns

**Analysis Date:** 2026-06-26

## Security Model

**Hub WebSocket lacks authentication:**
- Issue: The agent WebSocket on `:8124` (`backbone/src/panel.ts:612-852`) accepts ANY connection without auth verification. The relay is unauthenticated. The agent CLI runs with `--dangerously-skip-permissions` (`backbone/src/agent-cli.ts:203`).
- Files: `backbone/src/panel.ts` (lines 612, 782-851), `backbone/src/relay.ts`, `backbone/src/agent-cli.ts` (line 203)
- Impact: On a shared/exposed network, a rogue actor could connect to the hub WS and impersonate an agent, receiving all user messages and injecting fake assistant replies. The phone would trust the injected messages.
- Fix approach: **Documented gate** (PLAN.md line 218): "fine on a private tailnet; REQUIRED before any shared/exposed hub." Implement auth before exposing (e.g., token-based verify, or paired identity handshake). For now, gate deployment to single-user private Tailscale networks only in docs/README.

**Agent CLI skips permission checks:**
- Issue: `--dangerously-skip-permissions` flag runs the Claude agent without prompting for tool use consent. Every phone capability is allowed by default.
- Files: `backbone/src/agent-cli.ts` (line 203)
- Impact: User is not asked to approve sensitive actions (SMS, camera, location) per turn. The agent can act without user consent.
- Fix approach: This is intentional for a private sandbox; add a gate in setup/README: "Only use with trusted agents on your own machine."

## Tech Debt

**Setup page JS embedded in TypeScript template literal:**
- Issue: `SETUP_PAGE` and `PAGE` (backbone/src/panel.ts:374–596, 228–371) are multi-thousand-character HTML/CSS/JS strings in template literals. String escaping is fragile; backslashes and regex patterns get escape-stripped silently.
- Files: `backbone/src/panel.ts` (lines 228–596)
- Impact: Easy to introduce bugs when updating JS (e.g., regex `\w` gets escape-stripped). Hard to debug; no syntax highlighting or linting in editor.
- Fix approach: Extract to separate `.html` files or use a lightweight template engine (e.g., `ejs`, `handlebars`). At minimum, add a note documenting escape-stripping gotcha (see memory: `panel-setup-page-gotcha.md`).

**MainActivity is very large (1487 lines):**
- Issue: `android/app/src/main/java/com/agenticandroid/MainActivity.kt` is 1487 lines, combining chat UI, settings tabs, voice recording, agent selection, session management, and more. Hard to navigate and test.
- Files: `android/app/src/main/java/com/agenticandroid/MainActivity.kt`
- Impact: Changing one feature (e.g., chat rendering) requires scanning a 1487-line file. Risk of unintended side effects.
- Fix approach: Extract into smaller composables/screens: `ChatScreen.kt`, `SettingsScreen.kt`, `VoiceRecorderScreen.kt`, etc. Move session logic to a ViewModel.

**panel.ts is very large (1219 lines):**
- Issue: `backbone/src/panel.ts` owns hub state, HTTP endpoints, WebSocket agent handling, scheduler, media persistence, session management, and the entire web UI (including embedded JS strings). Too many concerns in one file.
- Files: `backbone/src/panel.ts`
- Impact: Adding a new hub feature (e.g., metrics, advanced logging) or fixing a bug requires careful review of all 1219 lines. Risk of breaking routing logic or state consistency.
- Fix approach: Split into: `panel-http.ts` (HTTP server + routes), `panel-agent.ts` (WebSocket agent handling + roster), `panel-state.ts` (hub state + session management). Move web UI to separate files or a template engine.

**getblob.mts is a dev scratch helper:**
- Issue: `backbone/getblob.mts` (16 lines) is a command-line tool to decrypt a blob from the relay for manual inspection. Not integrated into the build or test suite; unclear if it's still used.
- Files: `backbone/getblob.mts`
- Impact: Bit-rot risk; may fail silently if relay endpoint changes. Not documented in PLAN.md or developer guides.
- Fix approach: Either formalize it as a debugger tool (add to `package.json` scripts, document in README), or remove it if no longer needed.

## Data Persistence & Migration

**Blob TTL is 5 minutes (tight for end-to-end flows):**
- Issue: `backbone/src/relay.ts:49` sets `blobTtl = 5 * 60_000` (5 minutes). Blobs (photos, files) expire from the relay after 5 minutes.
- Files: `backbone/src/relay.ts` (line 49), `backbone/src/peer.ts` (blob fetch)
- Impact: If the phone is slow to fetch an image (e.g., on poor Wi-Fi) after the agent sends it, or if replay happens after 5 min, the blob is gone and the phone shows "unavailable". PLAN.md notes this (Phase 6, line 161): "Replay after the relay's 5-min blob TTL shows unavailable."
- Fix approach: Increase TTL to 15–30 min if relay storage is not a constraint. Or: ensure hub caches blobs to disk (`~/.agentic-android/media/`) so they survive relay expiry (already done for photos; verify for all blob types).

**Session migration from legacy single conversation.jsonl:**
- Issue: `backbone/src/panel.ts:122–137` migrates the old single `conversation.jsonl` into a new per-session structure on first load. The migration is one-way (old file is not deleted by default).
- Files: `backbone/src/panel.ts` (lines 122–137)
- Impact: If migration fails (e.g., disk full during `fs.copyFileSync`), the user is silently left with the old file + a new empty session. No error message or rollback.
- Fix approach: Log migration success/failure explicitly. Delete the legacy file after successful migration (with a backup option or a "restore from backup" tool).

## Known Limitations & TODOs

**Wake-word engine is a stub (no real Porcupine/openWakeWord):**
- Issue: `android/app/src/main/java/com/agenticandroid/voice/WakeWordDetector.kt` (lines 25–26, 85, 98–99) has TODO comments; the `PorcupineEngine` is stubbed. Currently uses Vosk (offline, no key).
- Files: `android/app/src/main/java/com/agenticandroid/voice/WakeWordDetector.kt`
- Impact: Vosk is less accurate than Porcupine. Phase 3 (PLAN.md line 76) explicitly chose Vosk as "offline, on-device, no key" but left the Porcupine integration for later. Decision already made; not a bug.

**Concierge ask_agent orchestration (Feature B) is deferred:**
- Issue: `backbone/LOOP-STATE.md:59–67` stages "appoint a connected agent as main (concierge)" — routing other agents' queries to the main agent. Marked as "STAGED, not started" because it needs 2+ live brains to verify.
- Files: `backbone/src/panel.ts` (Phase 8, lines 619–623), staged but not implemented
- Impact: Users with 2+ agents cannot ask one agent to call another. The roster exists; ask_agent does not.
- Fix approach: This is a planned feature, not a bug. Implement only when 2 real brains are available for testing. See PLAN.md line 215–218 for routing model.

**Just-in-time OS permission prompts not wired:**
- Issue: `android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:48` has TODO: "just-in-time OS permission prompts for Tier-1 capabilities (camera, location, sms)."
- Files: `android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt` (line 48)
- Impact: Permissions are checked at capability run time; no pre-flight prompt. If a capability is disabled in settings, the agent is told it's unavailable (correct behavior). If enabled, the agent can use it without a per-use OS dialog.
- Fix approach: Wire Android PermissionCompat / ActivityCompat.requestPermissions for Tier-1. Gate sensitive actions with a dialog before execution.

**SMS delivery tracking not wired:**
- Issue: `android/app/src/main/java/com/agenticandroid/capabilities/SmsCapability.kt:63` passes `null` for `sentIntents` (delivery tracking).
- Files: `android/app/src/main/java/com/agenticandroid/capabilities/SmsCapability.kt` (line 63)
- Impact: SMS is sent, but no delivery confirmation is returned to the agent. The agent assumes success without proof.
- Fix approach: Wire a PendingIntent callback to track delivery status and return it to the agent.

**Location freshness threshold is not tuned:**
- Issue: `android/app/src/main/java/com/agenticandroid/capabilities/LocationCapability.kt:73` has TODO: "tune freshness threshold (currently anything non-null from getLastLocation is accepted)."
- Files: `android/app/src/main/java/com/agenticandroid/capabilities/LocationCapability.kt` (line 73)
- Impact: The agent may receive stale location data (e.g., 2+ hours old). No TTL on the cached location.
- Fix approach: Set a max-age threshold (e.g., return location only if < 5 min old); request a fresh fix if stale.

## Platform & Deployment

**macOS launchd plist blocked by TCC (~/Documents):**
- Issue: `launchd/com.agenticandroid.hub.plist` + `backbone/service-run.sh` (Phase H, PLAN.md:125–134) are correct, but launchd cannot read files in `~/Documents` due to macOS Transparency, Consent & Control (TCC).
- Files: `launchd/com.agenticandroid.hub.plist`, `launchd/README.md`, `launchd/service-run.sh`
- Impact: If the checkout is in `~/Documents/Projects/Agentic-Android`, launchd fails with "Operation not permitted" when trying to access files.
- Fix approach: **Documented** (launchd/README.md). User must either (1) move checkout out of TCC-protected folders, or (2) grant Full Disk Access in System Settings → Privacy & Security. Phase 10 sidesteps this by running from `/Applications` (not TCC-protected).

**Menu-bar app (Phase 10) not started:**
- Issue: Phase 10 (PLAN.md:265–278) is planned but not implemented. It's the user-facing, premium alternative to the hand-installed plist — no terminal, no TCC dance.
- Files: Not yet written
- Impact: Users must manually install launchd plist or run `pnpm panel` from terminal. Not a production-ready install UX.
- Fix approach: Phase 10 is deferred (per PLAN.md "not started"). Build a Swift/Tauri/Electron menu-bar app that bundles node + backbone, runs from `/Applications`, and auto-starts on login.

## Testing Coverage Gaps

**No integration tests for multi-agent routing:**
- Issue: Phase 8 (multi-agent hub) added roster + select_agent, verified with 2 stub agents but no automated test suite.
- Files: `backbone/src/panel.ts` (lines 619–850, agent roster & routing), no `.test.ts` file
- Impact: A regression in agent selection or message routing could be missed by unit tests. E2E is verify-only (2 agents Ada/Bob with mock replies).
- Fix approach: Add integration tests: start 2 agents via WS, verify roster payloads, send message to agent A, confirm agent B does NOT receive it, select B, verify routing switches.

**Scheduler persistence not unit-tested for crash recovery:**
- Issue: `backbone/src/scheduler.ts` has 5 unit tests but none that simulate hub crash + restart. The reload logic (`loadAndArm()`) is tested in device-verify only (PLAN.md:234).
- Files: `backbone/src/scheduler.ts` (no crash-recovery test), `backbone/src/panel.ts` (line 756, `loadAndArm`)
- Impact: A bug in the reload path could be missed. E.g., task ID corruption, `fireAt` parsing error.
- Fix approach: Add a crash-simulation test: write tasks to disk, simulate hub restart, verify all tasks are re-armed with correct IDs and fire times.

**Blob encryption/decryption not fuzz-tested:**
- Issue: E2E blob crypto (`backbone/src/crypto.ts`, `backbone/src/peer.ts`) is critical for media security but has no fuzz tests for malformed inputs.
- Files: `backbone/src/crypto.ts`, `backbone/src/peer.ts`, `android/app/src/main/java/com/agenticandroid/E2eBlob.kt`
- Impact: A bug in decryption could silently fail (return garbage) or crash. Fuzz testing could find off-by-one errors, invalid length handling, etc.
- Fix approach: Add a fuzz test: generate random encrypted blobs, random keys, verify decryption either succeeds safely or throws (never UB or silent corruption).

## Performance & Scalability

**Hub event log is memory-capped but not disk-bounded:**
- Issue: `backbone/src/panel.ts:56–69` keeps max 5000 events in memory + appends to `panel-events.jsonl` on disk. The disk file is never truncated or rotated.
- Files: `backbone/src/panel.ts` (lines 54–69)
- Impact: Over months, `panel-events.jsonl` could grow unbounded (GB+), slowing startup (reads all lines on load). Disk usage is unbounded.
- Fix approach: Implement log rotation: truncate the disk file every N events or N days. Or: implement a rolling window (keep only the last 30 days of events).

**Conversation history in memory (500-turn limit):**
- Issue: `backbone/src/panel.ts:80` caps conversation memory at 500 turns. When full, oldest turns are dropped. Full conversation is on disk per session.
- Files: `backbone/src/panel.ts` (lines 80, 142, 150), `backbone/src/panel.ts:855–856` (in-memory slice for history replay)
- Impact: The hub replays only the 100 newest turns to the phone on connect (`histMsgs().slice(-100)`, line 855). Older turns exist on disk but are not replayed, so the phone's chat history is incomplete on re-pair or hub restart if the session has >100 turns.
- Fix approach: Replay full session history to the phone (or paginate: send latest 100, load older on scroll). The 500-turn memory cap is fine for runtime; just ensure replay is complete.

**Relay blob storage is in-memory (no disk persistence):**
- Issue: `backbone/src/relay.ts:54` stores blobs in a Map<id, {data, expires}> in RAM. Blobs are NOT written to disk. On relay restart, all in-flight blobs are lost.
- Files: `backbone/src/relay.ts` (lines 54, 139–142, 194)
- Impact: If the relay crashes while a blob is in transit (e.g., a 10 MB photo mid-upload), the upload is lost and must be retried. With a 5-min TTL, a slow network could lose data.
- Fix approach: Persist blobs to disk (e.g., `/tmp/relay-blobs/` or `~/.agentic-android/relay-cache/`) so they survive relay restart. Or: increase TTL to 15 min + document retry logic for slow networks.

## Missing or Fragile Areas

**Wake-word boot restart not fully verified:**
- Issue: `BootReceiver` (Android) is supposed to restart the wake service on device reboot (PLAN.md:86–89). Verified once in device-test (LOOP-STATE.md:102), but no automated/regression test.
- Files: `android/app/src/main/java/com/agenticandroid/BootReceiver.kt`
- Impact: If a future change breaks BootReceiver registration (e.g., in AndroidManifest.xml), wake word won't auto-restart after reboot. Silent failure until user notices.
- Fix approach: Add a persistent test: after reboot, verify wake service is running (no app in foreground). Automate this in CI or a device-test farm if possible.

**Pairing requires hand-wired AndroidManifest.xml entries:**
- Issue: Several capabilities (NotificationListenerCapability, Confirmer) have TODOs (lines 43, 173, 239) saying they must be manually registered in AndroidManifest.xml.
- Files: `android/app/src/main/java/com/agenticandroid/pairing/Confirmer.kt` (lines 43, 173, 239), `android/app/src/main/java/com/agenticandroid/capabilities/NotificationListenerCapability.kt` (lines 45, 103, 137)
- Impact: If manifests are out of sync, capabilities silently fail (e.g., notification access is not granted). Hard to debug.
- Fix approach: Verify all TODOs are resolved in AndroidManifest.xml. Consider a compile-time check or an APK validator that ensures all declared services are in the manifest.

**Relay is not rate-limited or DDoS-protected:**
- Issue: `backbone/src/relay.ts` (WebSocket + HTTP endpoints) has no rate limiting, auth, or DDoS mitigation.
- Files: `backbone/src/relay.ts`
- Impact: On a public URL, a bad actor could overwhelm the relay with blob uploads or WebSocket connections, denying service.
- Fix approach: This is a private/tailnet-only tool by design. Add docs: "Do NOT expose the relay to untrusted networks." If exposure is needed, add: IP allowlisting, rate limiting (e.g., via middleware), and auth.

## Summary of Severity

| Severity | Count | Examples |
|----------|-------|----------|
| **High** | 2 | Hub WS no auth (security gate for exposure); getblob bit-rot (unused helper) |
| **Medium** | 4 | Setup page escaping fragility; MainActivity/panel.ts oversized; log/blob storage unbounded; blob TTL tight |
| **Low** | 7+ | TODOs (wake-engine, SMS tracking, location freshness); missing Feature B; BootReceiver not auto-tested; no multi-agent routing tests |

---

*Concerns audit: 2026-06-26*
