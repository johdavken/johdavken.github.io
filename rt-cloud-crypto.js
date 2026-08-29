(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynRtCloudCrypto = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Client-side crypto for RT Cloud (see rt-cloud.js). Pure Web Crypto - no
  // IndexedDB, no network, no app state. Everything here runs the same in the
  // browser and in Node's `node:test` (Node exposes the same global
  // `crypto.subtle` / `crypto.getRandomValues`).
  //
  // The RT Cloud Recovery Code is the ONLY credential. From it we derive, on
  // the device and never anywhere else:
  //
  //   - a one-way lookup hash  (what the Edge Function receives - it locates
  //     the encrypted row, and that is all it can do)
  //   - an AES-GCM key         (never leaves the device; Supabase never sees
  //     a key or a plaintext note)
  //
  // Nothing in here uses, needs, or accepts an RT Sync Device ID, an
  // anonymous RT User ID, a workspace ID, or any hardware/browser
  // fingerprint. Recovery works on a brand-new install with brand-new RT Sync
  // identities, from the code alone.

  const webcrypto =
    (root_crypto()) ||
    (typeof crypto !== "undefined" ? crypto : null);

  function root_crypto() {
    const g = typeof globalThis !== "undefined" ? globalThis : null;
    return g && g.crypto && g.crypto.subtle ? g.crypto : null;
  }

  function subtle() {
    if (!webcrypto || !webcrypto.subtle) {
      throw new Error("Web Crypto is not available on this device.");
    }
    return webcrypto.subtle;
  }

  // --- constants --------------------------------------------------------

  const ENCRYPTION_VERSION = 1;
  const PBKDF2_ITERATIONS = 210000;
  const PBKDF2_HASH = "SHA-256";
  const AES_KEY_BITS = 256;
  const IV_BYTES = 12;
  const KDF_SALT_BYTES = 16;
  // 20 random bytes -> exactly 32 Base32 characters -> 160 bits of entropy,
  // comfortably above the 128-bit floor. Displayed as 8 groups of 4.
  const RECOVERY_SECRET_BYTES = 20;
  const RECOVERY_CODE_LENGTH = 32;
  const RECOVERY_GROUP_SIZE = 4;
  const LOOKUP_DOMAIN = "rtcloud/lookup/v1\n";

  // Crockford Base32: digits + uppercase, minus I, L, O, U. Unambiguous to
  // read aloud and to type. Decode is lenient (see normalizeRecoveryCode).
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  // --- byte / text helpers -------------------------------------------------

  function randomBytes(n) {
    if (!webcrypto || typeof webcrypto.getRandomValues !== "function") {
      throw new Error("A secure random source is not available on this device.");
    }
    const out = new Uint8Array(n);
    webcrypto.getRandomValues(out);
    return out;
  }

  function utf8(str) {
    return new TextEncoder().encode(String(str));
  }

  function fromUtf8(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function toBase64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < arr.length; i += chunk) {
      binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
    }
    if (typeof btoa === "function") return btoa(binary);
    return Buffer.from(binary, "binary").toString("base64");
  }

  function fromBase64(text) {
    const clean = String(text || "").trim();
    if (typeof atob === "function") {
      const binary = atob(clean);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(clean, "base64"));
  }

  function toBase64Url(bytes) {
    return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  // --- Base32 (recovery code encoding) ----------------------------------

  function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  // --- recovery code ---------------------------------------------------

  // { secret, code } - `secret` is the canonical 32-char string used for all
  // derivation; `code` is the grouped, dashed display form. Store the display
  // form; normalize whatever the user types back to `secret` before use.
  function generateRecoveryCode() {
    const secret = base32Encode(randomBytes(RECOVERY_SECRET_BYTES)).slice(0, RECOVERY_CODE_LENGTH);
    return { secret, code: formatRecoveryCode(secret) };
  }

  function formatRecoveryCode(secret) {
    const s = String(secret || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    const groups = [];
    for (let i = 0; i < s.length; i += RECOVERY_GROUP_SIZE) {
      groups.push(s.slice(i, i + RECOVERY_GROUP_SIZE));
    }
    return groups.join("-");
  }

  // Lenient decode: strip separators, uppercase, map the classic Crockford
  // look-alikes (O->0, I/L->1). Returns the canonical 32-char secret, or null
  // if it is not a well-formed recovery code. Never throws.
  function normalizeRecoveryCode(input) {
    if (input == null) return null;
    let s = String(input).toUpperCase().replace(/[\s-]+/g, "");
    s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
    if (s.length !== RECOVERY_CODE_LENGTH) return null;
    for (let i = 0; i < s.length; i += 1) {
      if (ALPHABET.indexOf(s[i]) === -1) return null;
    }
    return s;
  }

  // --- key derivation ------------------------------------------------------

  async function deriveLookupHash(secretOrCode) {
    const secret = normalizeRecoveryCode(secretOrCode);
    if (!secret) throw new Error("That is not a valid RT Cloud Recovery Code.");
    const digest = await subtle().digest("SHA-256", utf8(LOOKUP_DOMAIN + secret));
    return toBase64Url(new Uint8Array(digest));
  }

  function generateKdfSalt() {
    return toBase64(randomBytes(KDF_SALT_BYTES));
  }

  async function deriveKey(secretOrCode, kdfSaltBase64) {
    const secret = normalizeRecoveryCode(secretOrCode);
    if (!secret) throw new Error("That is not a valid RT Cloud Recovery Code.");
    const salt = fromBase64(kdfSaltBase64);
    if (!salt || salt.length < 8) throw new Error("Missing or invalid backup salt.");
    const baseKey = await subtle().importKey("raw", utf8(secret), { name: "PBKDF2" }, false, [
      "deriveKey"
    ]);
    return subtle().deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
      baseKey,
      { name: "AES-GCM", length: AES_KEY_BITS },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // --- encrypt / decrypt -------------------------------------------------

  // Fresh random IV per call, so the same notebook encrypted twice produces
  // two different ciphertexts. `plaintext` is the string from
  // PolynNotesStore.serializeExport() - the existing export envelope, reused
  // verbatim, never a second note schema.
  async function encryptSnapshot(key, plaintext) {
    const iv = randomBytes(IV_BYTES);
    const cipher = await subtle().encrypt(
      { name: "AES-GCM", iv },
      key,
      utf8(plaintext)
    );
    return {
      encryptionVersion: ENCRYPTION_VERSION,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(cipher))
    };
  }

  // Throws on any failure (wrong key, corrupted ciphertext, truncated IV).
  // Callers treat a throw as "leave local notes untouched".
  async function decryptSnapshot(key, ivBase64, ciphertextBase64) {
    const iv = fromBase64(ivBase64);
    if (!iv || iv.length !== IV_BYTES) throw new Error("Invalid backup IV.");
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv },
      key,
      fromBase64(ciphertextBase64)
    );
    return fromUtf8(new Uint8Array(plain));
  }

  return {
    ENCRYPTION_VERSION,
    PBKDF2_ITERATIONS,
    IV_BYTES,
    RECOVERY_CODE_LENGTH,
    ALPHABET,
    generateRecoveryCode,
    formatRecoveryCode,
    normalizeRecoveryCode,
    generateKdfSalt,
    deriveLookupHash,
    deriveKey,
    encryptSnapshot,
    decryptSnapshot,
    // exported for tests / diagnostics only
    _internal: { base32Encode, toBase64, fromBase64, toBase64Url, randomBytes }
  };
});
