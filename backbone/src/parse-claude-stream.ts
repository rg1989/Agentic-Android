/**
 * parse-claude-stream — turn Claude Code's `--output-format stream-json` NDJSON into orchestration
 * activity events, so an agent can narrate its OWN internals (Task subagents + tool calls) to the hub.
 *
 * Claude emits one JSON object per line: a `system/init`, then `assistant` messages (whose content may
 * hold `tool_use` blocks — `name:"Task"` is a subagent spawn), `user` messages (with `tool_result`
 * blocks that close a tool/subagent), and a final `result`. A subagent's own messages carry
 * `parent_tool_use_id` = the spawning Task's id, which gives exact nesting.
 */
export interface ClaudeActivity {
  id: string;
  parentId: string | null;
  kind: "subagent" | "tool";
  name: string;
  detail?: string;
  status: "start" | "end";
  error?: boolean;
}
export interface ParsedEvent {
  activities: ClaudeActivity[];
  text?: string;            // top-level assistant prose (the agent's own answer; subagent text excluded)
  final?: { text: string; sessionId?: string; isError?: boolean };
  sessionId?: string;
}

export function parseClaudeEvent(obj: any): ParsedEvent {
  const out: ParsedEvent = { activities: [] };
  if (!obj || typeof obj !== "object") return out;
  const parent = typeof obj.parent_tool_use_id === "string" ? obj.parent_tool_use_id : null;

  if (obj.type === "system" && obj.subtype === "init") { out.sessionId = obj.session_id; return out; }

  if (obj.type === "assistant" && obj.message && Array.isArray(obj.message.content)) {
    let txt = "";
    for (const b of obj.message.content) {
      if (b?.type === "text" && typeof b.text === "string") txt += b.text;
      else if (b?.type === "tool_use" && typeof b.id === "string") {
        const isTask = b.name === "Task";
        out.activities.push({
          id: b.id,
          parentId: parent,
          kind: isTask ? "subagent" : "tool",
          name: isTask ? String(b.input?.subagent_type ?? "subagent") : String(b.name ?? "tool"),
          detail: isTask ? String(b.input?.description ?? b.input?.prompt ?? "").slice(0, 120) : undefined,
          status: "start",
        });
      }
    }
    if (txt && !parent) out.text = txt; // only the driver-seat agent's own text is its answer
    if (typeof obj.session_id === "string") out.sessionId = obj.session_id;
    return out;
  }

  if (obj.type === "user" && obj.message && Array.isArray(obj.message.content)) {
    for (const b of obj.message.content) {
      if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        out.activities.push({ id: b.tool_use_id, parentId: null, kind: "tool", name: "", status: "end", error: b.is_error === true });
      }
    }
    return out;
  }

  if (obj.type === "result") {
    out.final = { text: typeof obj.result === "string" ? obj.result : "", sessionId: obj.session_id, isError: obj.is_error === true };
    if (typeof obj.session_id === "string") out.sessionId = obj.session_id;
    return out;
  }
  return out;
}

/** Line-buffered NDJSON: feed raw stdout chunks, get one parsed object per complete line. */
export function makeLineParser(onObj: (obj: any) => void): (chunk: string) => void {
  let buf = "";
  return (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { onObj(JSON.parse(line)); } catch { /* partial or non-JSON line */ }
    }
  };
}
