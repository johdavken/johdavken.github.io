const SESSION_COOKIE = "rt_session";
const SESSION_MAX_AGE = 604800;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default {
  async fetch(request, env) {
    const missing = ["AUTH_USERNAME", "AUTH_PASSWORD", "SESSION_SECRET"]
      .filter(name => typeof env[name] !== "string" || env[name].length === 0);

    if (missing.length) {
      return noStoreResponse(
        `Server configuration error: missing ${missing.join(", ")}.`,
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    const url = new URL(request.url);

    if (url.pathname === "/login") {
      if (request.method === "GET") {
        const returnTo = safeReturnPath(url.searchParams.get("return"), request.url);
        if (await hasValidSession(request, env.SESSION_SECRET)) {
          return noStoreRedirect(returnTo, 302);
        }
        return loginPage(returnTo);
      }

      if (request.method === "POST") {
        return handleLogin(request, env);
      }

      return methodNotAllowed("GET, POST");
    }

    if (url.pathname === "/logout") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return noStoreRedirect("/login", 303, clearSessionCookie());
    }

    if (!await hasValidSession(request, env.SESSION_SECRET)) {
      const returnTo = `${url.pathname}${url.search}`;
      return noStoreRedirect(`/login?return=${encodeURIComponent(returnTo)}`, 302);
    }

    return fetch(request);
  }
};

async function handleLogin(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return loginPage("/", "Submit the sign-in form and try again.", 400);
  }

  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const returnTo = safeReturnPath(form.get("return"), request.url);
  const validUsername = constantTimeEqual(username, env.AUTH_USERNAME);
  const validPassword = constantTimeEqual(password, env.AUTH_PASSWORD);

  if (!validUsername || !validPassword) {
    return loginPage(returnTo, "Incorrect username or password.", 401);
  }

  const token = await createSessionToken(env.SESSION_SECRET, username);
  return noStoreRedirect(returnTo, 303, sessionCookie(token));
}

async function createSessionToken(secret, username) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: username,
    iat: now,
    exp: now + SESSION_MAX_AGE,
    nonce: crypto.randomUUID()
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

async function hasValidSession(request, secret) {
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  try {
    const payloadBytes = base64UrlToBytes(parts[0]);
    const signature = base64UrlToBytes(parts[1]);
    const key = await importHmacKey(secret, ["verify"]);
    const signatureValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(parts[0])
    );
    if (!signatureValid) return false;

    const payload = JSON.parse(decoder.decode(payloadBytes));
    const now = Math.floor(Date.now() / 1000);
    return payload?.v === 1
      && Number.isSafeInteger(payload.iat)
      && Number.isSafeInteger(payload.exp)
      && payload.iat <= now + 60
      && payload.exp > now;
  } catch {
    return false;
  }
}

async function sign(value, secret) {
  const key = await importHmacKey(secret, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return new Uint8Array(result);
}

function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

function constantTimeEqual(leftValue, rightValue) {
  const left = encoder.encode(String(leftValue));
  const right = encoder.encode(String(rightValue));
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

function safeReturnPath(value, requestUrl) {
  const candidate = typeof value === "string" ? value : "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  try {
    const requestOrigin = new URL(requestUrl).origin;
    const resolved = new URL(candidate, requestOrigin);
    if (resolved.origin !== requestOrigin) return "/";
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return "/";
  }
}

function readCookie(header, name) {
  if (!header) return "";
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return "";
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function noStoreRedirect(location, status, cookie = "") {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Location": location
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

function noStoreResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Cache-Control", "no-store");
  return new Response(body, { ...init, headers });
}

function methodNotAllowed(allow) {
  return noStoreResponse("Method not allowed.", {
    status: 405,
    headers: {
      "Allow": allow,
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

function loginPage(returnTo, error = "", status = 200) {
  const safeReturn = escapeHtml(returnTo);
  const safeError = escapeHtml(error);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Sign in · Resin.tools</title>
  <style>
    :root{color-scheme:dark;--page:#11171d;--card:#182129;--border:#32404b;--text:#e7edf3;--muted:#9fb0bf;--accent:#65c98b;--error:#ff6b61;--field:#111920}
    *{box-sizing:border-box}html,body{min-height:100%}body{display:grid;place-items:center;margin:0;padding:24px;background:var(--page);color:var(--text);font:16px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(100%,400px);padding:32px;border:1px solid var(--border);border-radius:14px;background:var(--card);box-shadow:0 18px 45px rgba(0,0,0,.28)}
    .brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}.mark{width:12px;height:12px;border:3px solid var(--accent);border-radius:50%;box-shadow:0 0 0 4px rgba(101,201,139,.1)}
    h1{margin:0;font-size:29px;line-height:1.1;letter-spacing:-.04em}.subtitle{margin:6px 0 0;color:var(--muted);font-size:14px}
    form{display:grid;gap:17px}label{display:grid;gap:7px;color:var(--muted);font-size:13px;font-weight:700}input{width:100%;min-height:46px;padding:11px 12px;border:1px solid var(--border);border-radius:8px;background:var(--field);color:var(--text);font:inherit;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(101,201,139,.18)}
    button{width:100%;min-height:46px;margin-top:2px;border:1px solid #78d99b;border-radius:8px;background:var(--accent);color:#0d1c13;font:800 15px/1 system-ui,sans-serif;cursor:pointer}button:hover{filter:brightness(1.06)}button:focus-visible{outline:3px solid rgba(101,201,139,.35);outline-offset:3px}
    .error{min-height:21px;margin:0;color:var(--error);font-size:13px}.foot{margin:22px 0 0;padding-top:18px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;text-align:center}
    @media(max-width:460px){body{padding:16px}main{padding:25px 20px;border-radius:12px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark" aria-hidden="true"></span><div><h1>Resin.tools</h1><p class="subtitle">Authorized access</p></div></div>
    <form method="post" action="/login">
      <input type="hidden" name="return" value="${safeReturn}">
      <label>Username<input name="username" type="text" autocomplete="username" required autofocus></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" role="alert" aria-live="polite">${safeError}</p>
      <button type="submit">Sign in</button>
    </form>
    <p class="foot">Private production workspace</p>
  </main>
</body>
</html>`;

  return noStoreResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
