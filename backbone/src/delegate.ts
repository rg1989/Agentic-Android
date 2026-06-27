/**
 * delegate.ts — addressed, serialized, askId-correlated delegation core. No sockets, no globals.
 *
 * The hub uses this to forward a user turn to a NAMED worker agent and await that worker's reply,
 * keeping at most ONE turn in flight per worker (CLI agents keep a single --resume/--continue session,
 * so concurrent turns to one worker would corrupt it). Replies correlate to jobs by `askId`, NOT by
 * queue position: a worker that "timed out" keeps running (agent-runner never cancels a turn) and WILL
 * emit late — only an askId match makes that safe. Different workers run in parallel.
 */
export interface DelegateDeps {
  /** Deliver a delegated turn. MUST throw if the agent's socket is missing/closed. */
  send: (agentId: string, text: string, askId: string) => void;
  /** Mint a unique correlation id (panel: randomUUID; tests: a counter). */
  newId: () => string;
  /** Per-job reply timeout. Default 60s. */
  timeoutMs?: number;
}

interface Job { askId: string; text: string; resolve: (r: string) => void; timer: ReturnType<typeof setTimeout> | null; sent: boolean }

export interface Delegator {
  ask(id: string, text: string): Promise<string>;
  /** true ⇒ the reply matched an outstanding ask (caller suppresses the phone broadcast). */
  onReply(id: string, askId: string | undefined, reply: string): boolean;
  onGone(id: string): void;
  pending(id: string): number;
}

export function makeDelegator(deps: DelegateDeps): Delegator {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const queues = new Map<string, Job[]>(); // agentId -> FIFO; at most one `sent` job in flight

  const finish = (id: string, askId: string, reply: string) => {
    const q = queues.get(id);
    if (!q) return;
    const i = q.findIndex((j) => j.askId === askId);
    if (i < 0) return; // unknown / already-resolved (late or duplicate) -> ignore
    const [job] = q.splice(i, 1);
    if (job.timer) clearTimeout(job.timer);
    job.resolve(reply);
    if (q.length) pump(id); else queues.delete(id);
  };

  const pump = (id: string) => {
    const q = queues.get(id);
    if (!q?.length) return;
    const job = q[0];
    if (job.sent) return; // one in flight already
    job.sent = true;
    try {
      deps.send(id, job.text, job.askId); // send BEFORE arming the timer
    } catch {
      finish(id, job.askId, "(agent disconnected)");
      return;
    }
    job.timer = setTimeout(() => finish(id, job.askId, "(no reply within timeout)"), timeoutMs);
  };

  return {
    ask(id, text) {
      const askId = deps.newId();
      return new Promise<string>((resolve) => {
        const q = queues.get(id) ?? [];
        queues.set(id, q);
        q.push({ askId, text, resolve, timer: null, sent: false });
        pump(id); // no-op if another job is in flight
      });
    },
    onReply(id, askId, reply) {
      if (!askId) return false;
      const q = queues.get(id);
      if (!q?.some((j) => j.askId === askId)) return false;
      finish(id, askId, reply);
      return true;
    },
    onGone(id) {
      const q = queues.get(id);
      if (!q) return;
      queues.delete(id);
      for (const j of q) { if (j.timer) clearTimeout(j.timer); j.resolve("(agent disconnected)"); }
    },
    pending(id) { return queues.get(id)?.length ?? 0; },
  };
}
