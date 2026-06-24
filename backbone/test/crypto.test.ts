import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  ready,
  generateIdentity,
  fingerprint,
  sign,
  verify,
  sealString,
  openString,
  sealFor,
  openFrom,
} from "../src/crypto.ts";

const enc = new TextEncoder();

before(async () => {
  await ready();
});

test("identities are distinct and fingerprint is stable", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  assert.notEqual(a.fp, b.fp);
  assert.equal(a.fp, fingerprint(a.edPub)); // fp derives from public key
});

test("sign/verify round-trips and rejects tampering", () => {
  const id = generateIdentity();
  const msg = enc.encode("challenge-nonce");
  const sig = sign(id.edSec, msg);
  assert.equal(verify(id.edPub, sig, msg), true);
  assert.equal(verify(id.edPub, sig, enc.encode("other")), false); // wrong message
  const other = generateIdentity();
  assert.equal(verify(other.edPub, sig, msg), false); // wrong key
});

test("E2E string round-trip between two identities", () => {
  const phone = generateIdentity();
  const agent = generateIdentity();
  const packed = sealString(agent.edPub, phone.edSec, "secret payload");
  assert.equal(openString(phone.edPub, agent.edSec, packed), "secret payload");
});

test("E2E rejects a tampered ciphertext", () => {
  const phone = generateIdentity();
  const agent = generateIdentity();
  let packed = sealString(agent.edPub, phone.edSec, "secret");
  // flip a char in the middle of the base64
  const i = Math.floor(packed.length / 2);
  packed = packed.slice(0, i) + (packed[i] === "A" ? "B" : "A") + packed.slice(i + 1);
  assert.throws(() => openString(phone.edPub, agent.edSec, packed));
});

test("E2E rejects the wrong recipient key (relay can't read)", () => {
  const phone = generateIdentity();
  const agent = generateIdentity();
  const eve = generateIdentity();
  const packed = sealString(agent.edPub, phone.edSec, "for-agent-only");
  assert.throws(() => openString(phone.edPub, eve.edSec, packed)); // eve is not the recipient
});

test("blob bytes round-trip (out-of-band media path)", () => {
  const phone = generateIdentity();
  const agent = generateIdentity();
  const photo = new Uint8Array(4096).map((_, i) => (i * 7) & 0xff);
  const packed = sealFor(agent.edPub, phone.edSec, photo);
  const out = openFrom(phone.edPub, agent.edSec, packed);
  assert.deepEqual(out, photo);
});
