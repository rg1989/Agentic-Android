/**
 * RawAgent — a non-MCP agent adapter that speaks the bus directly (DESIGN.md Q3).
 *
 * Non-LLM (scripted) agents don't need MCP's tool-advertising layer: they know exactly
 * which methods exist and call them directly.  This class wraps BusEndpoint with the
 * lightweight interface a scripted agent actually needs:
 *
 *   - listCapabilities()  — fetch the phone's catalog (replaces `tools/list` in MCP)
 *   - call()              — invoke a phone method and await its typed response
 *   - onPhoneEvent()      — subscribe to phone-initiated events (user_message, task.result, …)
 *
 * Imports only peer.ts (BusEndpoint, PeerConfig) and protocol.ts (ResponseMsg, EventMsg).
 * Zero import of bridge.ts / @modelcontextprotocol — proves the MCP layer is skippable
 * (grep-checkable from the build contract).
 */
import { BusEndpoint, type PeerConfig } from "../src/peer.ts";
import { type ResponseMsg, type EventMsg } from "../src/protocol.ts";

// Re-export so callers don't need to import protocol.ts themselves.
export type { ResponseMsg, EventMsg, PeerConfig };

export interface CatalogEntry {
  method: string;
  sensitivity: string;
  summary: string;
}

export class RawAgent {
  readonly bus: BusEndpoint;

  /**
   * @param self     This agent's ed25519 identity (generated at pairing time).
   * @param peerEdPub The phone's ed25519 public key (exchanged during QR pairing, DESIGN.md Q5).
   * @param relayUrl  http://host:port of the self-hosted relay.
   * @param requestTimeoutMs Optional per-request timeout (default 30 s).
   */
  constructor(self: PeerConfig["self"], peerEdPub: string, relayUrl: string, requestTimeoutMs = 30_000) {
    this.bus = new BusEndpoint({ self, peerEdPub, relayUrl, requestTimeoutMs });
  }

  /** Open the relay connection. Must be called before listCapabilities / call. */
  connect(): Promise<void> {
    return this.bus.connect();
  }

  /** Gracefully close the relay socket. */
  close(): void {
    this.bus.close();
  }

  /**
   * Ask the phone for its capability catalog.
   * Identical to what Bridge.start() does before building MCP tools — but without MCP.
   */
  async listCapabilities(): Promise<CatalogEntry[]> {
    const resp = await this.bus.request("list_capabilities", {});
    if (resp.status !== "ok") {
      throw new Error(`list_capabilities failed: ${resp.error?.message ?? "unknown"}`);
    }
    const raw = resp.result as { capabilities: CatalogEntry[] };
    return raw.capabilities;
  }

  /**
   * Invoke a phone method and return the full typed ResponseMsg
   * (status, result, error — never stripped, so the caller can observe+recover, Q10).
   */
  call(method: string, params: Record<string, unknown> = {}): Promise<ResponseMsg> {
    return this.bus.request(method, params);
  }

  /**
   * Subscribe to phone-initiated events (capability B: user_message, wakeword, task.result, …).
   * Replaces Bridge's agentRunner injection — the scripted agent handles events directly.
   */
  onPhoneEvent(cb: (ev: EventMsg) => void): void {
    this.bus.onEvent(cb);
  }
}

// ---------- manual smoke-test entrypoint (pnpm tsx examples/raw-agent.ts) ----------
// PhoneSim and helpers are imported here — in main() only, NOT in the RawAgent class above.
import { pathToFileURL } from "node:url";
import { ready, generateIdentity } from "../src/crypto.ts";
import { createRelay } from "../src/relay.ts";
import { PhoneSim } from "../src/phone-sim.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ready();

  // Spin up an in-process relay + simulated phone so this file is self-contained.
  const relay = createRelay();
  const port = await relay.listen();
  const url = `http://127.0.0.1:${port}`;

  const P = generateIdentity();
  const G = generateIdentity();

  const phone = new PhoneSim(P, G.edPub, url);
  await phone.connect();

  const agent = new RawAgent(G, P.edPub, url);
  agent.onPhoneEvent((ev) => console.log("[event]", ev.topic, ev.data));
  await agent.connect();

  const caps = await agent.listCapabilities();
  console.log("[catalog]", caps.map((c) => c.method).join(", "));

  const ring = await agent.call("phone.ring", { ms: 1000 });
  console.log("[ring]", ring.status, ring.result);

  phone.emitUserMessage("hello from the phone");
  await new Promise((r) => setTimeout(r, 50)); // let the event arrive

  agent.close();
  phone.close();
  await relay.close();
}
