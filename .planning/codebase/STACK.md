# Technology Stack

**Analysis Date:** 2026-06-26

## Languages

**Primary:**
- TypeScript 5.6.0 - Backbone wire protocol, relay, bridge, agents, and MCP server (`backbone/src/*.ts`)
- Kotlin 2.0.20 - Android app implementation (`android/app/src/main/java/com/agenticandroid/*.kt`)
- Shell (Bash) - Service launcher and installation scripts (`backbone/service-run.sh`, `start.sh`, `stop.sh`, `install-phone.sh`)

**Secondary:**
- JSON - Protocol messages, configuration, gradle build manifests
- XML - Android manifest and launchd plist for service management

## Runtime

**Environment:**
- Node.js 22.0.0+ (inferred from `@types/node@^22.0.0`) - Backbone runtime
- JVM 17 - Android compilation and runtime (compileSdk 35, minSdk 29/Android 10)
- JBR 21 (JetBrains Runtime) - Android development environment

**Package Manager:**
- pnpm 9.x (inferred; uses pnpm-lock.yaml equivalent) - TypeScript dependencies
- Gradle 8.5.2 - Android build system

**Lockfiles:**
- pnpm lockfile present (backbone dependencies locked)
- Gradle `gradle-wrapper.jar` handles Gradle version pinning

## Frameworks

**Core:**
- Model Context Protocol (MCP) 1.0.0 (@modelcontextprotocol/sdk) - Agent integration layer; backbone runs as MCP server
- WebSocket (ws 8.18.0) - Real-time bidirectional communication (relay ↔ phone, hub ↔ agent)
- Anthropic SDK 0.105.0 (@anthropic-ai/sdk) - Claude LLM integration for agents
- Android Framework (androidx.*, Material3, Jetpack Compose) - Android 10+ app

**UI/Compose:**
- Jetpack Compose (androidx.compose.* 2024.09.02) - Android UI (state-based, no XML layouts)
- Material Design 3 (androidx.compose.material3) - Material Design theming
- Material Icons Extended (androidx.compose.material:material-icons-extended) - Icon set
- Lifecycle Integration (androidx.lifecycle:lifecycle-service) - Android service lifecycle

**Transport & Crypto:**
- libsodium-wrappers 0.7.15 (@types/libsodium-wrappers 0.7.14) - Ed25519 signing, X25519 encryption (crypto.ts)
- Lazysodium (Android) 5.1.0 - Native libsodium bindings for Kotlin
- OkHttp 4.12.0 - HTTP transport for Android blob uploads/downloads
- kotlinx-serialization-json 1.7.1 - JSON serialization (Kotlin)
- kotlinx-coroutines-android 1.8.1 - Async tasks on Android

**Camera & Vision:**
- AndroidX Camera API (camera-core, camera-camera2, camera-lifecycle, camera-view) 1.4.2 - Real-time camera preview
- ML Kit Barcode Scanning 17.3.0 - QR code pairing scan

**Device Capabilities:**
- Google Play Services Location 21.3.0 - GPS location queries
- Vosk Speech Recognition 0.3.47 - Offline on-device wake-word detection (model ~40MB, fetched from alphacephei.com/vosk/models/)
- AndroidX Biometric 1.2.0-alpha05 - Biometric prompt for consent gates
- AndroidX Security Crypto 1.1.0-alpha06 - Encrypted SharedPreferences key storage

**Notifications & Wake:**
- Firebase Cloud Messaging (FCM) - 33.3.0 BOM, firebase-messaging-ktx - Push wake for backgrounded app

**Testing:**
- JUnit 4.13.2 - Android unit tests
- tsx 4.19.0 - TypeScript test runner (Node.js side)

**Build/Dev:**
- tsx 4.19.0 - Execute TypeScript directly (dev & test)
- typescript 5.6.0 - Type checking
- Google Services Plugin 4.5.0 - Firebase/FCM integration
- Kotlin Compose Plugin 2.0.20 - Compose compiler
- Kotlin Serialization Plugin 2.0.20 - Kotlinx.serialization support

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk@^1.0.0` (backbone) - Allows Claude/any MCP host to invoke phone capabilities as tools; the agent attachment layer
- `@anthropic-ai/sdk@^0.105.0` (backbone) - Claude LLM for agent loop (used by agent.ts and brain.ts)
- `libsodium-wrappers@^0.7.15` (backbone) + `lazysodium-android@5.1.0` (Android) - E2E encryption using authenticated crypto_box (X25519 + XSalsa20-Poly1305); relay and all peers cannot read message contents
- `ws@^8.18.0` (backbone) + AndroidX WebSocket equivalent - Relay (relay.ts) and hub (panel.ts) connect peers via WebSocket; phone uses OkHttp for WS

**Infrastructure:**
- `zod@^3.23.8` - Runtime type validation for protocol messages and API responses
- `qrcode@^1.5.4` - Generate QR code for pairing payload (used by pairing.ts)
- Firebase/Google services - FCM wake-up mechanism for backgrounded phone (google-services.json integration)

## Configuration

**Environment:**
- Config directory: `~/.agentic-android/` (or `$AGENTIC_HOME`)
  - `agent.json` - Identity keypair (edPub/edSec), relay URL, agent brain config (provider, model, API key env var name), optional OAuth token for headless CLI auth
  - `panel-events.jsonl` - Event log (request, response, phone_event, agent_run, connection, config, user/assistant messages, LLM calls)
  - `conversation.jsonl` - Legacy chat history (migrated to sessions on load)
  - `sessions/` - Multiple chat sessions (one .jsonl per session), indexed in sessions.jsonl
  - `media/photos/` - Photos captured by phone
  - `media/files/` - Files uploaded from phone

**Environment Variables (Backbone):**
- `AGENTIC_HOME` - Override config directory (default: ~/.agentic-android)
- `ANTHROPIC_API_KEY` - Claude API key for agent.ts (or specified in agent.json brain.apiKeyEnv)
- `AGENT_NAME` - Override agent display name (agent.ts, agent-cli.ts)
- `AGENT_PORT` - Hub agent WebSocket port (default 8124)
- `HUB_URL` - Hub WebSocket URL for agent to dial (default ws://127.0.0.1:8124)
- `HUB_HTTP` - Hub HTTP base for phone-mcp.ts (default http://127.0.0.1:8123)
- `AGENT_CLI` - Custom CLI command for agent-cli.ts (default "claude")
- `CLAUDE_CODE_OAUTH_TOKEN` - OAuth token if not stored in agent.json
- `PORT` - Relay listen port (default: no default; must be set)

**Build:**
- `android/app/build.gradle.kts` - App-level Gradle with Android SDK config, dependencies, Firebase/FCM setup
- `android/build.gradle.kts` - Root Gradle with plugin versions (Android 8.5.2, Kotlin 2.0.20)
- `backbone/tsconfig.json` - TypeScript strict mode, ES2022 target, NodeNext module resolution
- `launchd/com.agenticandroid.hub.plist` - macOS launchd service (auto-start hub at login, watch for crashes; standard output/error to `.logs/` directory)

## Platform Requirements

**Development:**
- macOS/Linux/Windows with Node.js 22+
- JDK 17 (Android compilation)
- Android SDK 35 (compileSdk)
- Android device/emulator API 29+ (Android 10, minSdk)
- pnpm 9.x (or npm/yarn, though pnpm is specified)
- Tailscale VPN (recommended for secure NAT/firewall traversal; relay can be on a public VPS)

**Production:**
- Relay: Linux/macOS server (Node.js runtime); scales from single-process in-memory queue to Redis/disk persistence (marked as TODO)
- Hub: macOS with launchd (or systemd on Linux); can daemonize with `-u` flag or Docker container
- Phone: Android 10+ device with internet access (Tailscale, Wi-Fi, or USB relay)
- Agent: macOS/Linux with node runtime and claude CLI (for agent-cli.ts) or any MCP host

---

*Stack analysis: 2026-06-26*
