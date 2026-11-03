# Security — Vercel-only Steam Cloud Manager

## Trust boundary

Steam Guard QR authorizes a full Steam client session, not a Cloud-only OAuth permission. The Vercel Function obtains the Steam refresh token, encrypts it with a 256-bit AES-GCM environment key and sends the ciphertext to the browser in a Secure HttpOnly SameSite=Strict cookie.

The browser stores the encrypted cookie. **Vercel decrypts the Steam token inside Functions on each API request.** Vercel administrators, compromised deployed code or attackers with the environment key may access it. This is not zero-knowledge security. Open-source code allows review but is not a security audit or proof that hosted code is identical.

## Implemented precautions

- Same-origin API; Origin and Fetch Metadata checks for cross-site requests; session-scoped CSRF tokens for mutations.
- Short-lived encrypted and authenticated refresh-token cookie, host-only __Host- prefix, HttpOnly, Secure and SameSite=Strict attributes.
- QR login uses one streamed Function request, a nonce-bound encrypted handoff and short-lived login cookie.
- Each Steam Cloud operation creates its own Steam client connection and closes it afterwards.
- No intentional logging or database storage of Steam refresh/access tokens, QR codes, cookies or signed file URLs.
- Cloud file selection is revalidated against current Steam metadata before download or deletion.
- File downloads validate Steam storage URLs, public DNS addresses, SHA1 and size.

## Known limitations

- The Vercel host/operator has full-session credential access. A malicious deployment can use those credentials.
- Stateless logout clears a browser cookie but cannot revoke a previously copied encrypted cookie or the Steam refresh token. Key rotation forces all users to log in again.
- Short-lived QR exchange tickets are nonce-bound but not tracked in a global replay ledger.
- Stateless deletion reviews cannot be atomically consumed across Function instances. Deletion is disabled by default (ENABLE_CLOUD_DELETE is unset/false). Do not enable it publicly until durable replay prevention is implemented and tested.
- A Function can time out during a multi-GB ZIP. Partial archives must not be trusted.
- Steam client RPCs are unofficial. Failed Cloud requests are not proof that a game has no saves.
- Steam Guard reconnect across independent Vercel Functions must be verified using a real account before production launch.
- No independent security audit has been performed.

## Release gates

Review the Git history for secrets, protect the main branch, run CI, configure the SCM_SESSION_KEY directly in Vercel, test a disposable Steam save on a Vercel Preview, test large-file cancellation and implement durable cross-Function replay protection before enabling deletion.

Use GitHub private vulnerability reporting where available. Never post real Steam tokens, cookies, QR challenges, signed download URLs or saves in public issues.
