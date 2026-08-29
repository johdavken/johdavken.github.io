"use strict";

// RT Cloud client crypto: recovery-code generation, one-way lookup
// derivation, PBKDF2 -> AES-GCM key derivation, and encrypt/decrypt of the
// existing Notes export envelope. Runs on Node's global Web Crypto - the
// same primitives the browser uses.

const test = require("node:test");
const assert = require("node:assert/strict");

const Crypto = require("./rt-cloud-crypto.js");
const NotesStore = require("./notes-store.js");

function sampleSnapshot() {
  return NotesStore.serializeExport(
    [
      { id: "note_a", title: "Line 4 startup", body: "<p>check dryers</p>", bodyFormat: "html", pinned: true, folderId: "folder_x1", createdAt: 10, updatedAt: 20 },
      { id: "note_b", title: "", body: "purge sequence", bodyFormat: "markdown", createdAt: 11, updatedAt: 21 }
    ],
    [{ id: "folder_x1", name: "Jobs", createdAt: 5, updatedAt: 5, sortOrder: 0 }]
  );
}

/* ---------------------------------------------------------------------- *
 *   Recovery code
 * -------------------------------------------------------------------- */

test("generateRecoveryCode uses Web Crypto randomness, not Math.random", () => {
  const src = require("node:fs").readFileSync("rt-cloud-crypto.js", "utf8");
  assert.doesNotMatch(src, /Math\.random\s*\(/, "no Math.random anywhere in the crypto module");
  assert.match(src, /getRandomValues/, "randomness comes from crypto.getRandomValues");

  // Determinism check: many draws, no collisions, full alphabet coverage.
  const seen = new Set();
  let alphabetHits = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { secret, code } = Crypto.generateRecoveryCode();
    assert.equal(secret.length, Crypto.RECOVERY_CODE_LENGTH);
    assert.equal(secret.length, 32, "32 Base32 chars == 160 bits of entropy (>= 128)");
    assert.ok(!seen.has(secret), "no repeat across 200 draws");
    seen.add(secret);
    for (const ch of secret) {
      assert.ok(Crypto.ALPHABET.includes(ch), `char ${ch} is in the unambiguous alphabet`);
      alphabetHits.add(ch);
    }
    // Display form: grouped by 4 with dashes, no ambiguous separators.
    assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
    assert.equal(Crypto.normalizeRecoveryCode(code), secret, "display form round-trips to the secret");
  }
  assert.ok(alphabetHits.size >= 24, "draws span most of the 32-symbol alphabet");
});

test("normalizeRecoveryCode is lenient about case, spacing and look-alikes", () => {
  const { secret, code } = Crypto.generateRecoveryCode();
  assert.equal(Crypto.normalizeRecoveryCode(code.toLowerCase()), secret);
  assert.equal(Crypto.normalizeRecoveryCode(code.replace(/-/g, " ")), secret);
  assert.equal(Crypto.normalizeRecoveryCode(`  ${code}  `), secret);
  // O -> 0, I/L -> 1 mapping
  assert.equal(Crypto.normalizeRecoveryCode("O".repeat(32)), "0".repeat(32));
  assert.equal(Crypto.normalizeRecoveryCode("I".repeat(32)), "1".repeat(32));
  // Wrong length / junk -> null, never a throw
  assert.equal(Crypto.normalizeRecoveryCode("too-short"), null);
  assert.equal(Crypto.normalizeRecoveryCode(null), null);
  assert.equal(Crypto.normalizeRecoveryCode("!@#$".repeat(8)), null);
});

/* ---------------------------------------------------------------------- *
 *   Lookup hash - one way, never the raw code
 * -------------------------------------------------------------------- */

test("deriveLookupHash is deterministic, base64url, and not reversible to the code", async () => {
  const { secret, code } = Crypto.generateRecoveryCode();
  const a = await Crypto.deriveLookupHash(secret);
  const b = await Crypto.deriveLookupHash(code); // display form derives the same
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{40,64}$/, "matches the Edge Function / DB CHECK charset");
  assert.ok(!a.includes(secret), "the raw secret does not appear in the hash");
  const other = await Crypto.deriveLookupHash(Crypto.generateRecoveryCode().secret);
  assert.notEqual(a, other);
});

/* ---------------------------------------------------------------------- *
 *   Encrypt / decrypt round-trip
 * -------------------------------------------------------------------- */

test("serialize -> encrypt -> decrypt -> parseImport round-trips every preserved field", async () => {
  const snapshot = sampleSnapshot();
  const { secret } = Crypto.generateRecoveryCode();
  const salt = Crypto.generateKdfSalt();
  const key = await Crypto.deriveKey(secret, salt);

  const enc = await Crypto.encryptSnapshot(key, snapshot);
  assert.equal(enc.encryptionVersion, Crypto.ENCRYPTION_VERSION);
  assert.match(enc.iv, /^[A-Za-z0-9+/]+=*$/);
  assert.match(enc.ciphertext, /^[A-Za-z0-9+/]+=*$/);
  assert.ok(!enc.ciphertext.includes("startup"), "no plaintext leaks into the ciphertext");

  const key2 = await Crypto.deriveKey(secret, salt);
  const plain = await Crypto.decryptSnapshot(key2, enc.iv, enc.ciphertext);
  assert.equal(plain, snapshot);

  const parsed = NotesStore.parseImport(plain);
  assert.ok(parsed.ok);
  assert.equal(parsed.notes.length, 2);
  assert.equal(parsed.folders.length, 1);
  const a = parsed.notes.find((n) => n.id === "note_a");
  assert.equal(a.title, "Line 4 startup");
  assert.equal(a.body, "<p>check dryers</p>");
  assert.equal(a.bodyFormat, "html");
  assert.equal(a.pinned, true);
  assert.equal(a.folderId, "folder_x1");
  assert.equal(a.createdAt, 10);
  assert.equal(a.updatedAt, 20);
});

test("a fresh IV per call means the same notebook encrypts to different ciphertext", async () => {
  const snapshot = sampleSnapshot();
  const { secret } = Crypto.generateRecoveryCode();
  const salt = Crypto.generateKdfSalt();
  const key = await Crypto.deriveKey(secret, salt);
  const one = await Crypto.encryptSnapshot(key, snapshot);
  const two = await Crypto.encryptSnapshot(key, snapshot);
  assert.notEqual(one.iv, two.iv);
  assert.notEqual(one.ciphertext, two.ciphertext);
  // ...yet both decrypt back to the identical plaintext.
  assert.equal(await Crypto.decryptSnapshot(key, one.iv, one.ciphertext), snapshot);
  assert.equal(await Crypto.decryptSnapshot(key, two.iv, two.ciphertext), snapshot);
});

test("a wrong recovery code fails decryption instead of returning garbage", async () => {
  const snapshot = sampleSnapshot();
  const right = Crypto.generateRecoveryCode().secret;
  const wrong = Crypto.generateRecoveryCode().secret;
  const salt = Crypto.generateKdfSalt();
  const enc = await Crypto.encryptSnapshot(await Crypto.deriveKey(right, salt), snapshot);
  await assert.rejects(
    () => Crypto.decryptSnapshot(Crypto.deriveKey(wrong, salt).then((k) => k), enc.iv, enc.ciphertext),
    "deriveKey promise passed directly still rejects"
  );
  const wrongKey = await Crypto.deriveKey(wrong, salt);
  await assert.rejects(() => Crypto.decryptSnapshot(wrongKey, enc.iv, enc.ciphertext));
});

test("corrupted ciphertext or IV fails safely", async () => {
  const snapshot = sampleSnapshot();
  const { secret } = Crypto.generateRecoveryCode();
  const salt = Crypto.generateKdfSalt();
  const key = await Crypto.deriveKey(secret, salt);
  const enc = await Crypto.encryptSnapshot(key, snapshot);

  const flipped = enc.ciphertext.slice(0, -4) + (enc.ciphertext.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  await assert.rejects(() => Crypto.decryptSnapshot(key, enc.iv, flipped));
  await assert.rejects(() => Crypto.decryptSnapshot(key, "AAAA", enc.ciphertext), /Invalid backup IV/);
});

test("encryption never mutates the source notes", async () => {
  const notes = [
    { id: "n1", title: "keep", body: "body", bodyFormat: "markdown", createdAt: 1, updatedAt: 2 }
  ];
  const before = JSON.stringify(notes);
  const snapshot = NotesStore.serializeExport(notes, []);
  const { secret } = Crypto.generateRecoveryCode();
  const salt = Crypto.generateKdfSalt();
  const key = await Crypto.deriveKey(secret, salt);
  await Crypto.encryptSnapshot(key, snapshot);
  assert.equal(JSON.stringify(notes), before, "source array untouched by encrypt");
});
