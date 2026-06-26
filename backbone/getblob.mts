import fs from "node:fs";
import os from "node:os";
import { ready, openFrom } from "./src/crypto.ts";
async function main() {
  const cfg = JSON.parse(fs.readFileSync(os.homedir()+"/.agentic-android/agent.json","utf8"));
  const id = process.argv[2];
  await ready();
  const res = await fetch(`${cfg.relayUrl}/blob/${id}`);
  if(!res.ok){console.error("get failed",res.status);process.exit(1);}
  const packed = await res.text();
  const bytes = openFrom(cfg.peerEdPub, cfg.self.edSec, packed);
  const out = `/tmp/${id}.jpg`;
  fs.writeFileSync(out, bytes);
  console.log(out, bytes.length);
}
main();
