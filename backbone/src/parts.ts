/**
 * Typed parts for a rich assistant reply (Phase 6 wire shape).
 *
 * `assistant_message` stays backwards-compatible: it always carries a plain `text` (the spoken /
 * summary / history fallback). It MAY also carry `parts` — an ordered list the phone renders richly
 * (markdown, inline image, file attachment, table). The speech sanitizer speaks only text/markdown
 * parts (or `text` when there are none) and skips image/file/table, which have no useful audio.
 *
 * One shape used on both sides of the bus; the phone mirrors it in MsgPart.kt.
 */
export type MsgPart =
  | { kind: "text"; text: string }
  | { kind: "markdown"; text: string }
  | { kind: "image"; blobId: string; mime?: string; alt?: string }
  | { kind: "file"; blobId: string; name: string; mime?: string; size?: number }
  | { kind: "table"; columns: string[]; rows: string[][] };

export interface AssistantMessage {
  text: string;        // always present — plain-text fallback (spoken, stored, shown by old clients)
  parts?: MsgPart[];   // optional rich render
}

/** The text a TTS engine should speak: text/markdown parts joined, or `text` if there are no parts. */
export function spokenText(msg: AssistantMessage): string {
  if (!msg.parts?.length) return msg.text;
  const spoken = msg.parts
    .filter((p): p is { kind: "text" | "markdown"; text: string } => p.kind === "text" || p.kind === "markdown")
    .map((p) => p.text)
    .join(" ")
    .trim();
  return spoken || msg.text;
}
