/**
 * parse-omp-stream — turn omp's `--mode=json` NDJSON into orchestration activity events, so omp can
 * narrate its OWN internals (tool calls + subagents) to the hub, the same way Claude does via stream-json.
 *
 * omp emits type-tagged events: session / agent_start / turn_start / message_start / message_end /
 * message_update / tool_execution_{start,update,end} / turn_end / agent_end. We map tool_execution to
 * activity start/end and read the final answer from the last assistant message (message_end / agent_end).
 * omp tool events are flat (no parent linkage), so they hang directly under the agent's turn.
 */
import type { AgentActivity } from "./agent-runner.ts";

export interface OmpParsed { activities: AgentActivity[]; text?: string; final?: { text: string } }

// omp's subagent/dispatch tools (vs ordinary bash/read/edit/grep/…) — labelled as subagents in the tree.
const SUBAGENT = /subagent|dispatch|(^|[_-])(task|agent)([_-]|$)|spawn/i;

function summarize(result: unknown): string | undefined {
  if (result == null) return undefined;
  const s = typeof result === "string" ? result : JSON.stringify(result);
  return s.replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
}
function assistantText(content: unknown): string {
  return Array.isArray(content) ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "";
}

export function parseOmpEvent(obj: any): OmpParsed {
  const out: OmpParsed = { activities: [] };
  if (!obj || typeof obj !== "object") return out;
  switch (obj.type) {
    case "tool_execution_start":
      if (typeof obj.toolCallId === "string") {
        const name = String(obj.toolName ?? "tool");
        out.activities.push({ id: obj.toolCallId, parentId: null, kind: SUBAGENT.test(name) ? "subagent" : "tool", name, detail: typeof obj.intent === "string" ? obj.intent : undefined, status: "start" });
      }
      break;
    case "tool_execution_end":
      if (typeof obj.toolCallId === "string") {
        out.activities.push({ id: obj.toolCallId, kind: "tool", name: "", status: "end", error: obj.isError === true, reply: summarize(obj.result) });
      }
      break;
    case "message_end": {
      if (obj.message?.role === "assistant") { const t = assistantText(obj.message.content); if (t) out.text = t; }
      break;
    }
    case "agent_end": {
      const last = Array.isArray(obj.messages) ? [...obj.messages].reverse().find((m: any) => m?.role === "assistant") : null;
      out.final = { text: last ? assistantText(last.content) : "" };
      break;
    }
  }
  return out;
}
