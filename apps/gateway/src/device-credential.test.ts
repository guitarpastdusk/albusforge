import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openCredential, parseHandoffKeys, sealCredential } from "./device-credential";
const key = () => randomBytes(32).toString("base64url");
const ring = () => parseHandoffKeys(JSON.stringify({ active: "current", keys: { current: key() } }))!;
const binding = () => ({ deviceId: randomUUID(), tenantId: randomUUID(), buildId: randomUUID(), planVersion: 1, handoffVersion: 1 });
it("encrypts each handoff independently and binds ciphertext to ownership, plan and generation", () => {
  const keys = ring(), owner = binding(), token = key();
  const sealed = sealCredential(token, owner, keys);
  expect(JSON.stringify(sealed)).not.toContain(token);
  expect(openCredential(sealed, owner, keys)).toBe(token);
  expect(sealCredential(token, owner, keys)).not.toEqual(sealed);
  for (const change of [{ deviceId: randomUUID() }, { tenantId: randomUUID() }, { buildId: randomUUID() }, { planVersion: 2 }, { handoffVersion: 2 }]) {
    expect(() => openCredential(sealed, { ...owner, ...change }, keys)).toThrow("cannot be decrypted");
  }
  expect(() => openCredential({ ...sealed, ciphertext: `${sealed.ciphertext[0] === "A" ? "B" : "A"}${sealed.ciphertext.slice(1)}` }, owner, keys)).toThrow("cannot be decrypted");
  expect(() => openCredential(sealed, owner, ring())).toThrow("cannot be decrypted");
});
it("supports retiring-key reads with fresh issuance under the active key", () => {
  const old = key(), current = key(), owner = binding(), token = key();
  const oldRing = parseHandoffKeys(JSON.stringify({ active: "old", keys: { old } }))!;
  const next = parseHandoffKeys(JSON.stringify({ active: "current", keys: { old, current } }))!;
  const sealed = sealCredential(token, owner, oldRing);
  expect(openCredential(sealed, owner, next)).toBe(token);
  expect(sealCredential(token, owner, next).keyId).toBe("current");
  expect(() => openCredential(sealed, owner, parseHandoffKeys(JSON.stringify({ active: "current", keys: { current } }))!)).toThrow("cannot be decrypted");
});
it("has no default key and keeps invalid configuration values out of errors", () => {
  expect(parseHandoffKeys(undefined)).toBeNull();
  const secret = "a-secret-value-that-must-not-be-logged";
  for (const value of [secret, JSON.stringify({ active: "a", keys: { a: secret } }), JSON.stringify({ active: "missing", keys: { a: key() } }), JSON.stringify({ active: "a", keys: { a: key() }, extra: true })]) {
    try { parseHandoffKeys(value); expect.fail("configuration should fail"); } catch (error) { expect(String(error)).not.toContain(secret); expect(String(error)).toContain("Invalid DEVICE_HANDOFF_KEYS"); }
  }
});
