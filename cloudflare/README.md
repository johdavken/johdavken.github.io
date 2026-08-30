# Resin.tools authentication Worker

The paste-ready Worker source is [`worker.mjs`](./worker.mjs). Attach it to the existing `resin.tools/*` Worker Route in place of the Basic Authentication Worker.

## Request flow

1. Every request first verifies that all required secrets exist.
2. `GET /login` renders the standalone Resin.tools login page. A visitor with a valid session is redirected to the safe requested path.
3. `POST /login` compares the submitted credentials with the configured secrets. A valid login receives a seven-day HMAC-SHA-256 signed cookie and is redirected with HTTP 303.
4. `POST /logout` expires the cookie and redirects to `/login`.
5. `GET /.well-known/assetlinks.json` is deliberately public so Android can verify the Resin Tools App Link. It contains only the public package name and signing certificate fingerprints.
6. Every other request must carry a correctly signed, unexpired session token. Valid requests continue to the existing GitHub Pages origin through `fetch(request)`.
7. Login, logout, redirects, and authentication errors use `Cache-Control: no-store`.

The return path is restricted to the same origin and must begin with a single `/`. Query strings are retained.

## Required secrets

Define these three Cloudflare Worker secrets:

```text
AUTH_USERNAME
AUTH_PASSWORD
SESSION_SECRET
```

With Wrangler, run each command and enter the value when prompted:

```sh
wrangler secret put AUTH_USERNAME
wrangler secret put AUTH_PASSWORD
wrangler secret put SESSION_SECRET
```

Generate `SESSION_SECRET` independently from the password. Use at least 32 cryptographically random bytes. One suitable command is:

```sh
openssl rand -base64 48
```

Store the output as the secret; do not commit it to this repository or reuse it as `AUTH_PASSWORD`. Changing `SESSION_SECRET` immediately invalidates every existing session.

## Test checklist

- [ ] Open a protected URL in a private window and confirm it redirects to `/login` with the original path and query string retained.
- [ ] Confirm `https://resin.tools/.well-known/assetlinks.json` returns HTTP 200 as `application/json` with no redirect while signed out.
- [ ] Sign in with valid credentials and confirm the original page opens.
- [ ] Submit an invalid username or password and confirm the inline error appears without leaving `/login`.
- [ ] Refresh while authenticated and confirm the session remains valid.
- [ ] Confirm CSS, JavaScript, SVG, favicon, and other asset requests load after authentication.
- [ ] Submit `POST /logout` and confirm the cookie is cleared and protected pages redirect to `/login`.
- [ ] Modify the cookie in browser developer tools and confirm the next protected request redirects to `/login`.
- [ ] Test an expired token, or temporarily reduce `SESSION_MAX_AGE`, and confirm it is rejected.
- [ ] Confirm `/login` and authentication responses show `Cache-Control: no-store`.
- [ ] Test the login card and keyboard focus states at phone width.
- [ ] Confirm a return value such as `//example.com` or `https://example.com` cannot redirect away from `resin.tools`.
