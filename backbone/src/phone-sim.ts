/**
 * Simulated phone — stands in for the Android app so the WHOLE flow is testable without a device.
 * Mirrors the Android design: a capability registry + on-phone consent enforcement (Q8/Q10).
 *
 * The real app replaces the capability handlers with Kotlin providers (camera2, FusedLocation, …)
 * and the confirmer with a real notification/biometric prompt. Everything else is identical.
 */
import { BusEndpoint, type RequestHandler } from "./peer.ts";
import { type Identity } from "./crypto.ts";
import { type ResponseMsg } from "./protocol.ts";

export type Sensitivity = "allow" | "ask" | "deny";

export interface Capability {
  method: string;
  sensitivity: Sensitivity; // default policy; user can override per (agent, capability)
  summary: string;
  handler: (params: Record<string, unknown>, ctx: PhoneSim) => Promise<{ result?: unknown; error?: ResponseMsg["error"] }>;
}

/** Confirmer for `ask` capabilities. Real phone: a notification + biometric prompt. */
export type Confirmer = (method: string, params: Record<string, unknown>, agentFp: string) => Promise<boolean>;

export class PhoneSim {
  readonly bus: BusEndpoint;
  private readonly caps = new Map<string, Capability>();
  /** per-(agentFp -> method -> override) ; falls back to capability default (Q8: per-agent x capability). */
  private readonly policy = new Map<string, Map<string, Sensitivity>>();
  private confirmer: Confirmer = async () => false; // default: deny `ask` unless a confirmer is wired
  // tiny bit of device state to demonstrate typed errors + observe/recover
  cameraHeld = false;

  constructor(self: Identity, peerEdPub: string, relayUrl: string) {
    this.bus = new BusEndpoint({ self, peerEdPub, relayUrl });
    this.bus.onRequest(this.handle);
    this.registerDefaults();
  }

  connect() {
    return this.bus.connect();
  }
  close() {
    this.bus.close();
  }

  register(cap: Capability) {
    this.caps.set(cap.method, cap);
  }
  setPolicy(agentFp: string, method: string, s: Sensitivity) {
    const m = this.policy.get(agentFp) ?? new Map();
    m.set(method, s);
    this.policy.set(agentFp, m);
  }
  setConfirmer(c: Confirmer) {
    this.confirmer = c;
  }

  /** Phone-initiated event (capability B): e.g. a transcribed wake-word utterance. */
  emitUserMessage(text: string) {
    this.bus.event("user_message", { text });
  }

  private effective(agentFp: string, method: string, def: Sensitivity): Sensitivity {
    return this.policy.get(agentFp)?.get(method) ?? def;
  }

  private handle: RequestHandler = async (req, fromFp) => {
    if (req.method === "list_capabilities") {
      return {
        status: "ok",
        result: {
          capabilities: [...this.caps.values()].map((c) => ({
            method: c.method,
            sensitivity: this.effective(fromFp, c.method, c.sensitivity),
            summary: c.summary,
          })),
        },
      };
    }

    const cap = this.caps.get(req.method);
    if (!cap) return { status: "error", error: { code: "UNKNOWN_METHOD", message: req.method, retriable: false } };

    const eff = this.effective(fromFp, req.method, cap.sensitivity);
    if (eff === "deny") return { status: "error", error: { code: "CONSENT_DENIED", message: `${req.method} is denied`, retriable: false } };
    if (eff === "ask") {
      const ok = await this.confirmer(req.method, req.params, fromFp);
      if (!ok) return { status: "error", error: { code: "CONSENT_DENIED", message: "user declined", retriable: false } };
    }

    const out = await cap.handler(req.params, this);
    return out.error ? { status: "error", error: out.error } : { status: "ok", result: out.result };
  };

  // ---------- default Tier-1 capabilities ----------
  private registerDefaults() {
    this.register({
      method: "phone.ring",
      sensitivity: "allow",
      summary: "Ring the phone at full volume to locate it.",
      handler: async (p) => ({ result: { rang: true, ms: Number(p.ms ?? 3000) } }),
    });

    this.register({
      method: "location.get",
      sensitivity: "allow",
      summary: "Get current GPS location.",
      handler: async () => ({ result: { lat: 37.4219, lon: -122.084, accuracy_m: 8 } }),
    });

    // High-level atomic capability: internally "opens" the camera. Returns a typed error if the
    // camera is held by another app (demonstrates observe/recover chaining, Q10).
    this.register({
      method: "camera.capture",
      sensitivity: "allow",
      summary: "Capture a photo (opens the camera internally) and return it as an E2E blob.",
      handler: async (p, ctx) => {
        if (ctx.cameraHeld)
          return { error: { code: "CAMERA_IN_USE", message: "camera is held by another app", retriable: true } };
        const w = Number(p.width ?? 64);
        const h = Number(p.height ?? 64);
        const bytes = new Uint8Array(w * h).map((_, i) => (i * 13 + 7) & 0xff); // fake image
        const blob = await ctx.bus.putBlob(bytes, "image/jpeg");
        return { result: { ...blob, content_type: "image/jpeg", width: w, height: h } };
      },
    });
    this.register({
      method: "camera.state",
      sensitivity: "allow",
      summary: "Observe whether the camera is currently held.",
      handler: async (_p, ctx) => ({ result: { held: ctx.cameraHeld } }),
    });
    this.register({
      method: "camera.release",
      sensitivity: "allow",
      summary: "Release the camera if held by this app.",
      handler: async (_p, ctx) => {
        ctx.cameraHeld = false;
        return { result: { released: true } };
      },
    });

    this.register({
      method: "sms.send",
      sensitivity: "ask", // consequential -> requires confirmation by default
      summary: "Send an SMS.",
      handler: async (p) => ({ result: { sent: true, to: p.to } }),
    });

    this.register({
      method: "device.wipe",
      sensitivity: "deny", // example of a hard-denied capability
      summary: "Factory reset (denied by default).",
      handler: async () => ({ result: { wiped: true } }),
    });
  }
}
