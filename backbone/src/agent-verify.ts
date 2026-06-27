/**
 * agent-verify — turns "a socket opened" into "a working brain actually answered".
 *
 * The #1 remote-agent failure: the handshake succeeds (so the hub shows it "connected"), but the agent
 * never processes {t:"user"} frames — its turn ended and nothing is reading the socket — so the phone
 * spins on "Sending…" forever. This module gives the hub a verdict per agent so that silent failure
 * becomes a visible, explained one with a remedy.
 *
 * Policy only — NO I/O. The hub injects the clock, timers, and side-effects (warn the chat, refresh the
 * roster), mirroring Scheduler in panel.ts. Unit-tested in test/agent-verify.test.ts.
 *
 * Per-agent lifecycle:
 *   onConnect  → "verifying" and arm a self-test deadline
 *   onAlive    → "verified" (selftest_ok OR a real assistant_message); clears the deadline, self-heals
 *   deadline   → "failed" + ONE diagnostic, if nothing proved the loop in time (non-blocking: chat still works)
 *   onHeartbeat→ liveness ping; sweep() flips a heartbeat-aware agent to "stale" if the beats stop
 *   remove     → socket closed
 */

export type VerifyStatus = "verifying" | "verified" | "failed" | "stale";

export interface Diagnostic {
  agentId: string;
  name: string;
  problem: string;
  remedy: string;
}

export interface VerifierDeps {
  now: () => number;
  setTimer: (ms: number, fn: () => void) => unknown;
  clearTimer: (h: unknown) => void;
  /** Surface a problem to the user + the agent (hub logs it, sends a {t:"diag"} frame, warns the chat). */
  onDiagnose: (d: Diagnostic) => void;
  /** A status changed — re-announce the roster so the phone badge updates. */
  onChange: () => void;
  selftestTimeoutMs?: number; // default 8000
  heartbeatGraceMs?: number; // default 45000
  /** The "run this client" line the hub injects (it knows its own URL). */
  remedy?: string;
}

interface Entry {
  name: string;
  status: VerifyStatus;
  reason?: string;
  lastBeat: number;
  everBeat: boolean;
  timer: unknown | null;
}

const DEFAULT_REMEDY =
  "Run the hub's ready-made client on that machine (see the setup page) — it stays running and answers every message automatically.";

export class Verifier {
  private now: () => number;
  private setTimer: (ms: number, fn: () => void) => unknown;
  private clearTimer: (h: unknown) => void;
  private onDiagnose: (d: Diagnostic) => void;
  private onChange: () => void;
  private selftestTimeoutMs: number;
  private heartbeatGraceMs: number;
  private remedy: string;
  private agents = new Map<string, Entry>();

  constructor(deps: VerifierDeps) {
    this.now = deps.now;
    this.setTimer = deps.setTimer;
    this.clearTimer = deps.clearTimer;
    this.onDiagnose = deps.onDiagnose;
    this.onChange = deps.onChange;
    this.selftestTimeoutMs = deps.selftestTimeoutMs ?? 8000;
    this.heartbeatGraceMs = deps.heartbeatGraceMs ?? 45000;
    this.remedy = deps.remedy ?? DEFAULT_REMEDY;
  }

  status(id: string): VerifyStatus | null {
    return this.agents.get(id)?.status ?? null;
  }
  reason(id: string): string | undefined {
    return this.agents.get(id)?.reason;
  }

  onConnect(id: string, name: string): void {
    const prev = this.agents.get(id);
    if (prev?.timer) this.clearTimer(prev.timer);
    const e: Entry = { name, status: "verifying", lastBeat: this.now(), everBeat: false, timer: null };
    e.timer = this.setTimer(this.selftestTimeoutMs, () => {
      const cur = this.agents.get(id);
      if (!cur || cur.status !== "verifying") return; // already proved itself, or gone
      cur.status = "failed";
      cur.reason =
        "Connected but never answered the self-test — its turn likely ended and nothing is reading the socket, so your messages arrive unread.";
      cur.timer = null;
      this.onDiagnose({ agentId: id, name: cur.name, problem: cur.reason, remedy: this.remedy });
      this.onChange();
    });
    this.agents.set(id, e);
    this.onChange();
  }

  /** Proof the message loop works: selftest_ok, or an actual assistant_message. Self-heals failed/stale. */
  onAlive(id: string): void {
    const e = this.agents.get(id);
    if (!e) return;
    e.lastBeat = this.now();
    if (e.status === "verified") return;
    if (e.timer) { this.clearTimer(e.timer); e.timer = null; }
    e.status = "verified";
    e.reason = undefined;
    this.onChange();
  }

  onHeartbeat(id: string): void {
    const e = this.agents.get(id);
    if (!e) return;
    e.lastBeat = this.now();
    e.everBeat = true;
    if (e.status === "stale") {
      e.status = "verified";
      e.reason = undefined;
      this.onChange();
    }
  }

  /** Periodic: a heartbeat-aware agent gone quiet is a dead process behind a still-open socket. */
  sweep(): void {
    const t = this.now();
    for (const [id, e] of this.agents) {
      if (!e.everBeat) continue; // can't judge agents that never beat (e.g. old clients)
      if (e.status !== "verified") continue;
      if (t - e.lastBeat > this.heartbeatGraceMs) {
        e.status = "stale";
        e.reason =
          "Stopped sending heartbeats — the process likely died or its turn ended while the socket stayed open.";
        this.onDiagnose({ agentId: id, name: e.name, problem: e.reason, remedy: this.remedy });
        this.onChange();
      }
    }
  }

  remove(id: string): void {
    const e = this.agents.get(id);
    if (e?.timer) this.clearTimer(e.timer);
    this.agents.delete(id);
  }
}
