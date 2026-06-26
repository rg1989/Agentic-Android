# Testing Patterns

**Analysis Date:** 2026-06-26

## Test Framework

**Runner (TypeScript):**
- `node:test` built-in (not Jest)
- Config: none required; runs via `pnpm test` which invokes `tsx --test test/*.test.ts`
- Entry point: `package.json` script: `"test": "tsx --test test/*.test.ts"`

**Assertion Library (TypeScript):**
- `node:assert/strict` — strict equality, deep comparisons
- No external assertion library; Node's built-in is sufficient

**Runner (Kotlin):**
- JUnit 4 via Android Gradle
- Config: `build.gradle.kts` specifies `testImplementation("junit:junit:4.13.2")`
- Run command: `./gradlew :app:testDebugUnitTest`
- Pure-logic unit tests only (UI verified on-device)

**Assertion Library (Kotlin):**
- `org.junit.Assert` static methods: `assertEquals()`, `assertTrue()`, `assertFalse()`, `assertNull()`, `assertThrows()`
- No external assertion library

**Run Commands:**
```bash
pnpm test              # TypeScript: run all .test.ts files via node:test
pnpm typecheck         # TypeScript: tsc --noEmit (static analysis)
./gradlew :app:testDebugUnitTest   # Kotlin: unit tests only
```

## Test File Organization

**Location (TypeScript):**
- Co-located in `backbone/test/` directory (not `src/` subdirectories)
- Pattern: `{module}.test.ts` mirrors `src/{module}.ts`
- Files: `protocol.test.ts`, `crypto.test.ts`, `scheduler.test.ts`, `pairing.test.ts`, `relay.test.ts`, `agent-cli.test.ts`, `e2e.test.ts`, `raw-agent.test.ts`

**Location (Kotlin):**
- Standard Android project layout: `android/app/src/test/java/com/agenticandroid/{Name}Test.kt`
- Test classes mirror pure-logic modules from `src/main/java`
- Files: `MarkdownTest.kt`, `CodeHighlightTest.kt`, `SpeechTextTest.kt`, `WakePhraseTest.kt`, `WakeWindowTest.kt`, `ConsentTest.kt`

**Naming (Kotlin):**
- Test class name: `{LogicClass}Test`
- Test method: `@Test fun descriptiveTestName()`
- No setup/teardown unless needed (tests are pure functions of input → output)

## Test Structure

**TypeScript Suite Organization:**
```typescript
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { /* modules */ } from "../src/...";

// Module initialization hook (crypto needs libsodium)
before(async () => {
  await ready();
});

// Individual test
test("descriptive assertion about behavior", () => {
  const input = ...;
  const result = myFunction(input);
  assert.equal(result.field, expected);
});

// Multiple assertions in one test allowed
test("round-trip data and detect tampering", () => {
  const packed = seal(...);
  assert.equal(open(packed), original);
  assert.throws(() => open(tampered));
});
```

**Kotlin Suite Organization:**
```kotlin
package com.agenticandroid

import org.junit.Assert.*
import org.junit.Test

class WakePhraseTest {
    @Test fun descriptiveTestName() {
        val input = ...
        val result = WakePhrase.extract(input, phrase)
        assertEquals(expected, result)
    }

    // Comments document edge cases or sensitivity levels
    // --- W7: sensitivity = fuzzy tolerance for Vosk mishears ---
    @Test fun strictRejectsMishear() { ... }
    @Test fun lenientAcceptsOneCharMishear() { ... }
}
```

**Patterns (TypeScript):**
- `before()` hook for one-time async setup (libsodium initialization)
- No `beforeEach`/`afterEach`; tests are isolated pure functions
- Assertions grouped logically in single `test()` call
- Test names use lowercase, describe the condition being tested

**Patterns (Kotlin):**
- One assertion per test method (narrow focus)
- Helper methods for complex assertions (e.g., `assertCovers()`, `tokenAt()` in `CodeHighlightTest.kt`)
- Comments prefixed with `// ---` separate logical groups within a test class
- Asserts guard invariants and edge cases, not just happy path

## Mocking

**Framework (TypeScript):**
- No external mocking library; tests use hand-rolled dependency injection
- See `scheduler.test.ts`: custom `harness()` creates fake `SchedulerDeps` with controllable clock, timers, persistence

**Patterns (TypeScript):**
```typescript
function harness(initial: Task[] = []) {
  let clock = 1000;
  let seq = 0;
  const timers: { id: number; due: number; fn: () => void }[] = [];
  const deps: SchedulerDeps = {
    now: () => clock,
    setTimer: (ms, fn) => { /* ... */ },
    clearTimer: (h) => { /* ... */ },
    persist: (tasks) => { /* ... */ },
    load: () => persisted.map((t) => ({ ...t })),
    fire: (t) => { fired.push(t); },
    genId: () => `task${++seq}`,
  };
  const advance = (ms: number) => {
    // manual time advancement
  };
  return { deps, advance, fired, persisted, timers };
}
```

**Framework (Kotlin):**
- No mocking framework; tests use pure functions only
- IO-free logic (e.g., `WakePhrase.extract()`, `Markdown.toAnnotated()`, `Code.tokenize()`)

**What to Mock:**
- TypeScript: time (via controllable `now()` callback), persistence (via in-memory arrays), I/O
- Kotlin: N/A — unit tests avoid anything that requires mocking

**What NOT to Mock:**
- Core business logic (cryptography, parsing, state machines)
- Protocol serialization/deserialization (test the actual Zod/JSON round-trip)

## Fixtures and Factories

**Test Data (TypeScript):**
- Inline construction in tests (e.g., `generateIdentity()` creates test keys)
- Small constants at module level: `const enc = new TextEncoder()`
- No separate fixture files; data is minimal and test-specific

**Test Data (Kotlin):**
- Raw strings and numbers inline (e.g., `"hey agent turn on the flashlight"`)
- Helper methods for repeated assertions (e.g., `tokenAt()` searches spans, `assertCovers()` validates tiling)
- Example from `CodeHighlightTest.kt`:
```kotlin
private fun assertCovers(text: String, kind: PreviewKind) {
    val spans = Code.tokenize(text, kind)
    var pos = 0
    for (s in spans) {
        assertEquals("gap/overlap before $s in $kind", pos, s.start)
        assertTrue("empty/negative span $s", s.end > s.start)
        pos = s.end
    }
    assertEquals("spans must reach end ($kind)", text.length, pos)
}
```

**Location:**
- No separate fixture directory; helpers defined in test class
- Data embedded in test methods for clarity

## Coverage

**Requirements:**
- Not explicitly enforced (no coverage target in CI/build)
- Implied coverage: all public functions have corresponding test methods

**View Coverage:**
- TypeScript: run tests and visual inspection of test file count (`ls -la backbone/test/*.test.ts`)
- Kotlin: `./gradlew jacocoTestDebugUnitTestReport` (if Jacoco added; not currently configured)

## Test Types

**Unit Tests (TypeScript):**
- Scope: single module logic (crypto, protocol, scheduler)
- Approach: pure functions, isolated harnesses, no async I/O
- Examples: `crypto.test.ts` (sign/verify/encrypt), `protocol.test.ts` (parsing), `scheduler.test.ts` (task lifecycle)

**Unit Tests (Kotlin):**
- Scope: pure logic only (string processing, state computation)
- Approach: quick to run, no device/emulator required
- Examples: `WakePhraseTest` (phrase extraction), `MarkdownTest` (rendering), `SpeechTextTest` (text sanitization)

**Integration Tests:**
- TypeScript: `e2e.test.ts` and `relay.test.ts` test protocol handshake and multi-peer routing
- Kotlin: UI verified on-device (no integration test framework)

**E2E Tests:**
- TypeScript: `e2e.test.ts` exercises full hub↔phone pairing and message flow
- Kotlin: Manual testing on device; Compose UI not framework-tested

## Common Patterns

**Async Testing (TypeScript):**
```typescript
before(async () => {
  await ready();  // libsodium initialization
});

test("one-shot task fires once then is gone + persisted", async () => {
  const h = harness();
  const s = new Scheduler(h.deps);
  h.advance(5000);
  await Promise.resolve();  // let async handlers settle
  assert.equal(h.fired.length, 1);
});
```

**Async Testing (Kotlin):**
- Pure logic tests don't require async; UI state is tested via manual on-device verification

**Error Testing (TypeScript):**
```typescript
test("E2E rejects a tampered ciphertext", () => {
  const packed = sealString(agent.edPub, phone.edSec, "secret");
  let tampered = packed.slice(0, mid) + "X" + packed.slice(mid + 1);
  assert.throws(() => openString(phone.edPub, agent.edSec, tampered));
});

test("response without reply_to is rejected", () => {
  assert.throws(() => InnerMessage.parse({ type: "response", status: "ok" }));
});
```

**Error Testing (Kotlin):**
```kotlin
@Test fun strictRejectsMishear() {
    assertNull(WakePhrase.extract("hey agents battery", "hey agent", 0f))
}

@Test fun responderRejectsMissingAck() {
    assertThrows(ParseException::class.java) {
        parseAck(invalidJson)
    }
}
```

**Edge Case Testing (Kotlin):**
```kotlin
@Test fun overnightWindowWraps() {
    // Quiet 23:00 → 07:00 (the common "while I sleep" case)
    assertTrue(WakeWindow.isQuiet(23, 23, 7))   // at start
    assertTrue(WakeWindow.isQuiet(2, 23, 7))    // middle of the night
    assertTrue(WakeWindow.isQuiet(6, 23, 7))    // just before end
    assertFalse(WakeWindow.isQuiet(7, 23, 7))   // at end (exclusive)
    assertFalse(WakeWindow.isQuiet(12, 23, 7))  // midday
}
```

**Comments Document Phases/Iterations (Kotlin):**
Some test classes use section comments to group related tests by phase:
```kotlin
// --- W3: collapse machine-junk tokens that make no sense read aloud ---
@Test fun collapsesUuid() { ... }
@Test fun collapsesLongHexHash() { ... }
@Test fun collapsesLongOpaqueId() { ... }
```

---

*Testing analysis: 2026-06-26*
