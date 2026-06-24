/**
 * Wire protocol — THE contract. Everything else is an adapter behind this.
 *
 * Two layers:
 *  - Envelope (cleartext): what the relay sees. Just enough to route: from/to/id/ts + opaque `enc`.
 *  - Inner message (inside `enc`, E2E-encrypted): the 4 message kinds. The relay never sees these.
 *
 * Relay-control frames (hello/challenge/auth/welcome/error) are NOT envelopes — they ride the same
 * socket during the handshake and are told apart by the `ctl` field.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

// ---------- Outer envelope (relay-visible) ----------
export const Envelope = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1), // unique per message; responses correlate via inner.reply_to === this id
  from: z.string().min(1), // sender fingerprint
  to: z.string().min(1), // destination fingerprint
  ts: z.number().int(),
  enc: z.string().min(1), // base64 ciphertext of an InnerMessage
});
export type Envelope = z.infer<typeof Envelope>;

// ---------- Inner messages (E2E-encrypted; 4 kinds) ----------
export const TypedError = z.object({
  code: z.string(), // e.g. CAMERA_IN_USE, PERMISSION_NOT_GRANTED, CONSENT_DENIED, UNKNOWN_METHOD
  message: z.string(),
  retriable: z.boolean().default(false),
});
export type TypedError = z.infer<typeof TypedError>;

export const RequestMsg = z.object({
  type: z.literal("request"),
  method: z.string(), // e.g. "phone.ring", "camera.capture", "schedule"
  params: z.record(z.unknown()).default({}),
});

export const ResponseMsg = z.object({
  type: z.literal("response"),
  reply_to: z.string(), // envelope id of the request being answered
  status: z.enum(["ok", "error"]),
  result: z.unknown().optional(),
  error: TypedError.optional(),
});

export const EventMsg = z.object({
  type: z.literal("event"),
  topic: z.string(), // e.g. "user_message", "wakeword", "notification.posted", "task.result"
  data: z.record(z.unknown()).default({}),
});

export const AckMsg = z.object({
  type: z.literal("ack"),
  ack: z.string(), // envelope id being acknowledged
});

export const InnerMessage = z.discriminatedUnion("type", [
  RequestMsg,
  ResponseMsg,
  EventMsg,
  AckMsg,
]);
export type InnerMessage = z.infer<typeof InnerMessage>;
export type RequestMsg = z.infer<typeof RequestMsg>;
export type ResponseMsg = z.infer<typeof ResponseMsg>;
export type EventMsg = z.infer<typeof EventMsg>;
export type AckMsg = z.infer<typeof AckMsg>;

// ---------- Relay control frames (handshake) ----------
export const ControlFrame = z.discriminatedUnion("ctl", [
  z.object({ ctl: z.literal("hello"), fp: z.string(), edpub: z.string() }),
  z.object({ ctl: z.literal("challenge"), nonce: z.string() }),
  z.object({ ctl: z.literal("auth"), sig: z.string() }),
  z.object({ ctl: z.literal("welcome") }),
  z.object({ ctl: z.literal("error"), message: z.string() }),
]);
export type ControlFrame = z.infer<typeof ControlFrame>;

// ---------- Parsing helpers (trust boundary: validate everything off the wire) ----------

/** Parse a raw WS text frame into either a control frame or an envelope. Throws on garbage. */
export function parseFrame(raw: string): { kind: "ctl"; frame: ControlFrame } | { kind: "env"; env: Envelope } {
  const obj = JSON.parse(raw);
  if (obj && typeof obj === "object" && "ctl" in obj) {
    return { kind: "ctl", frame: ControlFrame.parse(obj) };
  }
  return { kind: "env", env: Envelope.parse(obj) };
}

export function parseInner(json: string): InnerMessage {
  return InnerMessage.parse(JSON.parse(json));
}

export function encodeInner(msg: InnerMessage): string {
  return JSON.stringify(InnerMessage.parse(msg));
}

let _seq = 0;
/** Monotonic-ish unique message id. Not security-sensitive (routing only). */
export function newId(prefix = "m"): string {
  _seq = (_seq + 1) & 0xffffff;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}
