# Vercel-only architecture — implementation staging

**Hard constraint:** The public website, Steam QR authentication, Steam Cloud operations, file downloads and deletion APIs must run **only on Vercel**. No VPS, persistent Node service, Electron, local Node installation, remote HTTP proxy, or separately deployed server is permitted.

## Verified platform capabilities and limitations (November 2026)

- Vercel Functions support accepting WebSockets (GA October 20, 2026). This does **not** guarantee a Function instance or its memory remains available to subsequent HTTP requests.
- Fluid Functions have invocation duration limits. A normal Hobby deployment can execute for up to 300 seconds; eligible Pro/Enterprise functions can opt into up to 1800 seconds in beta. A single multi-GB backup may exceed this even if streaming is used.
- HTTP stream support does not eliminate invocation timeouts, network failures or file transfer costs.
- Steam's browser-unfriendly client API requires actual Steam client credentials. The deployed Vercel environment will handle a *full Steam client session*, not a narrowly scoped Steam Cloud OAuth token.
- Publishing source code helps review but cannot prove the deployed build, platform operator or its environment secrets are uncompromised. Never advertise tokens as client-only in a server-backed design.

## Proposed serverless design

```
Browser — same-origin HTTPS — Vercel static UI
                          |— Vercel Function: QR streaming login (single request, ~120s)
                          |— Vercel Function: session exchange → Secure HttpOnly cookie
                          |— Vercel Function: catalog, files, per-file download
                          |— Vercel Function: ZIP stream / deletion
                                   ↳ fresh outbound Steam CM client connection per request
```

1. The QR login Function keeps the Steam Guard handshake inside **one streaming request**; subsequent polling requests cannot count on the same Function's memory. A short-lived encrypted, nonce-bound handoff ticket may be used to establish the browser session.
2. Use a Vercel encryption secret to protect Steam refresh-token material inside a short-lived **host-only Secure HttpOnly SameSite=Strict cookie**. The cookie is encrypted, but Vercel decrypts it; it must be treated as an authentication credential, not as a guarantee of zero knowledge. Do not expose the token to JavaScript, localStorage or logs.
3. Every authenticated request establishes its **own** Steam client connection and closes it when finished. Any claim that this works reliably with Steam refresh tokens, including multiple concurrent requests, requires real integration tests before production.
4. Authentication must validate the exact request Origin and CSRF, reject hostile Host values, bind QR exchange tickets to the login challenge, expire credentials, and clear them on logout. Cookie clearing does not necessarily revoke the underlying Steam refresh token at Steam.
5. Deletion needs a fresh account-bound file revision, explicit acknowledgement and exact confirmation. Encrypted stateless plans are **not globally one-time**: concurrent requests may replay them on different Functions. Before enabling destructive deletion for real users, use a durable, atomic replay-prevention mechanism available through Vercel-managed capabilities, or otherwise prove a safe equivalent. Never claim exactly-once semantics from process-local maps.
6. Prefer browser-native downloads with real streaming and error propagation. Native streaming can still time out for multi-GB ZIPs; chunking into multiple requests or client-side streamed archives may be necessary. Do not silently produce corrupt archives or weaken storage URL/SHA validation.
7. Functions must not store Steam credentials in instance-global memory, a shared cache, debug logs, or analytics. Refresh tokens must be encrypted, short-lived and invalidated when possible.

## Release gates

- [ ] Proven Steam QR handshake and reconnect across **different** Vercel Function invocations
- [ ] Session isolation and CSRF / cookie security tests on a real Vercel preview URL
- [ ] Bounded parallel connections tested without kicking out Steam sessions
- [ ] Successful real Steam Cloud listing and *completed* download of a disposable save
- [ ] Verified interruption handling for large ZIP and a documented maximum
- [ ] Cross-Function replay prevention before enabling deletion in production
- [ ] Vercel secret configured without putting it in Git history; logs checked for secrets
- [ ] CI, browser E2E and production build pass, then independent deployment verification

**Status:** engineering specification and token cryptography can be staged without changing the working `main` implementation. This document is not a claim of completed Vercel deployment or production readiness.
