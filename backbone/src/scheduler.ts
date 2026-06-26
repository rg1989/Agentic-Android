/**
 * Hub-owned scheduler (Phase 9). A delayed/recurring action must live in the always-on hub, never in
 * an ephemeral agent turn or a per-process timer — otherwise it dies when that process is torn down
 * mid-wait (the original "wait 30s then take a photo" bug). Tasks persist to disk and re-arm on boot.
 *
 * All time/timer/IO is injected so the core is deterministic and unit-tested.
 */
export interface Task {
  id: string;
  fireAt: number; // epoch ms
  method: string;
  args: Record<string, unknown>;
  everyMs?: number; // if set, re-arm at fireAt + everyMs after firing (simple recurrence)
  agentId?: string; // who scheduled it (for result delivery)
  createdAt: number;
}

export interface SchedulerDeps {
  now: () => number;
  setTimer: (ms: number, fn: () => void) => unknown;
  clearTimer: (handle: unknown) => void;
  persist: (tasks: Task[]) => void;
  load: () => Task[];
  fire: (task: Task) => void | Promise<void>;
  genId: () => string;
}

export interface ScheduleInput {
  method: string;
  args?: Record<string, unknown>;
  delayMs?: number; // fire this many ms from now
  atMs?: number;    // …or at this absolute epoch ms
  everyMs?: number; // …and/or repeat every this many ms
  agentId?: string;
}

export class Scheduler {
  private tasks = new Map<string, Task>();
  private timers = new Map<string, unknown>();
  constructor(private d: SchedulerDeps) {}

  /** Load persisted tasks and arm timers for them (call once on hub startup). */
  loadAndArm(): void {
    for (const t of this.d.load()) { this.tasks.set(t.id, t); this.arm(t); }
  }

  add(input: ScheduleInput): Task {
    const now = this.d.now();
    const fireAt = input.atMs ?? now + (input.delayMs ?? input.everyMs ?? 0);
    const task: Task = {
      id: this.d.genId(),
      fireAt,
      method: input.method,
      args: input.args ?? {},
      everyMs: input.everyMs,
      agentId: input.agentId,
      createdAt: now,
    };
    this.tasks.set(task.id, task);
    this.arm(task);
    this.save();
    return task;
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => a.fireAt - b.fireAt);
  }

  cancel(id: string): boolean {
    const had = this.tasks.delete(id);
    const h = this.timers.get(id);
    if (h !== undefined) { this.d.clearTimer(h); this.timers.delete(id); }
    if (had) this.save();
    return had;
  }

  private arm(task: Task): void {
    const delay = Math.max(0, task.fireAt - this.d.now());
    this.timers.set(task.id, this.d.setTimer(delay, () => { void this.onFire(task.id); }));
  }

  private async onFire(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;
    this.timers.delete(id);
    try { await this.d.fire(task); } catch { /* fire() logs its own errors */ }
    if (task.everyMs && task.everyMs > 0) {
      task.fireAt = this.d.now() + task.everyMs; // re-arm for the next occurrence
      this.arm(task);
    } else {
      this.tasks.delete(id);
    }
    this.save();
  }

  private save(): void { this.d.persist([...this.tasks.values()]); }
}
