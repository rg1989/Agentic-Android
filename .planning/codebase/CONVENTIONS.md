# Coding Conventions

**Analysis Date:** 2026-06-26

## Naming Patterns

**Files:**
- TypeScript source: lowercase with hyphens for compound names (`agent-cli.ts`, `phone-mcp.ts`)
- Tests: `{Name}.test.ts` (TypeScript) and `{Name}Test.kt` (Kotlin)
- Kotlin source: PascalCase for classes, camelCase for object/singleton names (`WakePhrase.kt`, `Markdown.kt`)

**Functions:**
- TypeScript: camelCase (`parseFrame`, `generateIdentity`, `sealString`)
- Kotlin: camelCase for regular functions, PascalCase for class names (`extract`, `toAnnotated`, `isQuiet`)
- Async functions in Kotlin marked with `suspend` modifier

**Variables:**
- TypeScript: camelCase for local/module scope (`nextId`, `pending`, `caps`)
- Kotlin: camelCase for properties and locals (`overrides`, `norm`, `scope`)
- Private members in Kotlin use underscore prefix for internal state (`_seq`, `_sodiumNS`)
- Volatile fields explicitly marked in concurrent code (`@Volatile private var established = false`)

**Types:**
- TypeScript: PascalCase for interfaces, types, and Zod schemas (`Envelope`, `InnerMessage`, `BrainCfg`)
- Kotlin: PascalCase for classes and enums (`Sensitivity`, `ConsentPolicy`, `CapResult`)
- Discriminated unions via Zod `.discriminatedUnion()` for protocol variants

## Code Style

**Formatting:**
- TypeScript: consistent spacing, `const`-first declarations, block-scoped variables
- Kotlin: JetBrains-style formatting (auto-formatters enforce consistency)
- Both: two-space indentation in TypeScript config (`tsconfig.json`), Kotlin follows standard 4-space

**Linting:**
- TypeScript: no ESLint config found; relies on TypeScript strict mode (`strict: true` in `tsconfig.json`)
- Kotlin: no lint config; relies on IDE inspection and JUnit assertions
- Emphasis on immutability where possible (`const` declarations, data classes in Kotlin)

## Import Organization

**Order (TypeScript):**
1. Node built-ins (`import fs from "node:fs"`, `import { WebSocket } from "ws"`)
2. Third-party packages (`@anthropic-ai/sdk`, `zod`)
3. Relative imports using `.ts` extension (`from "./crypto.ts"`)

**Order (Kotlin):**
1. Android framework imports (`android.*`)
2. Third-party libraries (`androidx.`, `kotlinx.`, `com.squareup.*`)
3. Local package imports (`com.agenticandroid`)

**Path Aliases:**
- TypeScript: uses direct relative paths with explicit `.ts` extension (no path aliases configured)
- Kotlin: uses package-qualified imports exclusively

**Notable TypeScript Import Convention:**
- Relative imports **must** include the `.ts` extension (`from "./crypto.ts"` not `from "./crypto"`)
- This is due to `allowImportingTsExtensions: true` in `tsconfig.json` for ESM interoperability

## Error Handling

**TypeScript Patterns:**
- Zod schemas as trust boundary: `.parse()` throws on invalid data from the wire (e.g., `Envelope.parse(obj)`)
- Try-catch for async operations (`makeBrain` wraps agentic loop, logs errors, returns fallback string)
- Promise-based error handling via callbacks: `pending.delete(id)` with timeout fallback for missing responses
- `throws` in JSDoc documents when parsing untrusted input

**Kotlin Patterns:**
- Exceptions for validation failures (e.g., `withTimeout()` throws on deadline)
- Nullable returns for optional results (`WakePhrase.extract()` returns `String?`, `null` if no match)
- Result types with discriminated fields: `CapResult(result: JsonElement?, error: TypedError?)`
- `@Synchronized` for shared mutable state guarding (`Ringer.start()`, `Ringer.stopInternal()`)

## Logging

**Framework:**
- TypeScript: `console.error()` for stderr output (structured log info passed via `.log()` callback)
- Kotlin: no dedicated logging framework; uses `System.err` or silent error tracking

**Patterns (TypeScript):**
- Central `log()` callback in dependency injection: `log: (type: string, summary: string, detail?: unknown) => void`
- Called with category + summary + optional detail object: `deps.log("user_message", userText, { text: userText })`
- Agent status updates via event bus: `bus.event("agent_status", { label: "..." })` for live phone display

**Patterns (Kotlin):**
- Errors surfaced via callback handlers (`onRequest`, `onEvent`, `onDisconnect` in `BusEndpoint`)
- No centralized logging; errors bubble to caller or are absorbed silently
- Comments document error sources where silent failures occur (e.g., regex parsing in `parseEnvelope()`)

## Comments

**When to Comment:**
- Document the "why" for non-obvious design choices (e.g., "ponytail:" prefix marks deliberate simplifications)
- Use block comments (`/** ... */`) for module-level docstrings describing overall purpose and flow
- Inline comments explain tricky algorithms or state management (e.g., `levenshtein()` in `WakePhrase.kt`)

**"ponytail:" Intent Comments:**
- Marks a known simplification or deliberate shortcut taken for MVP
- Example: `// ponytail: in-memory queue + blob store (single process). Mark: swap for Redis/disk to persist...`
- Communicates "this is intentional, not a bug; upgrade path is documented"
- Found in: `relay.ts`, `pairing.ts`, `crypto.ts`, `BusEndpoint.kt`, `Capabilities.kt`, `CodeHighlight.kt`

**JSDoc/KDoc Style:**
- TypeScript: JSDoc blocks for exported functions and types
  ```typescript
  /** Parse a raw WS text frame into either a control frame or an envelope. Throws on garbage. */
  export function parseFrame(raw: string): {...}
  ```
- Kotlin: KDoc blocks for public classes and significant functions
  ```kotlin
  /**
   * Pure wake-phrase matching for the Vosk wake-word service. Given a recognized transcript...
   */
  object WakePhrase { ... }
  ```

**Comment Frequency:**
- Sparse but dense: comments focus on contract/intent, not obvious code
- Module comments explain overall architecture and flow (see headers in protocol.ts, crypto.ts, brain.ts)
- Test comments document edge cases and invariants (e.g., in `CodeHighlightTest.kt`: "token spans must tile the whole string exactly")

## Function Design

**Size:**
- Small, focused functions (crypto functions ~10 lines, parsers ~20 lines max)
- Larger orchestration functions (`runBrain`, `toAnnotated`) ~60-100 lines with clear sections

**Parameters:**
- Prefer dependency injection objects (e.g., `BrainDeps`, `SchedulerDeps`) over many individual params
- REST/bus patterns accept record/object types: `params: Record<string, unknown>` for flexibility
- Async functions use Promise-based returns, Kotlin uses `suspend` functions with coroutine integration

**Return Values:**
- TypeScript: union types for variants (`{ kind: "ctl"; frame: ControlFrame } | { kind: "env"; env: Envelope }`)
- Kotlin: data classes or nullable types (`String?`, `CapResult`)
- Discriminated unions in protocol messages via Zod `.discriminatedUnion()`

## Module Design

**Exports (TypeScript):**
- Explicit `export` of functions, types, constants
- Type-only imports for TypeScript definitions: `import type { Identity } from "./crypto.ts"`
- No barrel files (index.ts); each module is imported directly

**Exports (Kotlin):**
- Public classes/objects by default; private functions use `private` keyword
- Companion objects for static-like methods (`object WakePhrase { fun extract(...) }`)

**Module Coupling:**
- Tight semantic coupling (protocol/crypto) via shared Zod schemas and interfaces
- Loose temporal coupling via bus pattern: agents/phone interact through hub, never direct calls
- State hoisting in Compose: UI state managed by Activity/ViewModel, passed down to composables

---

*Convention analysis: 2026-06-26*
