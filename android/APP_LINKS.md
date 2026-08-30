# Android App Links

Resin Tools claims the existing RT Sync URL shape:

`https://resin.tools/?rtSyncCode=AB12`

The website association is published from `/.well-known/assetlinks.json`.
That file contains the certificates for this checkout's debug build, locally
signed release/upload build, and the Google Play App signing build.

The Google Play fingerprint must always be the **SHA-256 fingerprint of the App
signing key certificate** shown for `tools.resin.app` in Google Play Console:

`Test and release` → `Setup` → `App integrity` → `App signing` →
`App signing key certificate` → `SHA-256 certificate fingerprint`

Do not substitute the `Upload key certificate` fingerprint. Google Play signs
the APK delivered to users with the App signing key, so Android verifies that
certificate against `assetlinks.json`.

After any signing-key rotation, replace or append the new Play fingerprint in
`target.sha256_cert_fingerprints` in `/.well-known/assetlinks.json`, deploy the
site, and confirm that the URL returns HTTP 200 as `application/json` without a
redirect before publishing the App Link-enabled Android release.
