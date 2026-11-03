# Security and data handling

## Scope and architecture

Steam Cloud Manager is a **local application with a static public website**, not a hosted Steam-account service. This repository has not undergone an independent security audit. A successful test suite is not a security guarantee.

The public build (`dist/public`) contains prerendered English/Russian information and installation instructions. It does not contain the Steam client, auth handlers, save-file API, analytics or a proxy. Its Content Security Policy sets `connect-src 'none'`. Vercel and other infrastructure providers can still record ordinary website access information such as IP addresses. Do not claim that visiting a hosted site sends no data to any server.

The local Node.js process holds a **full Steam client session**, created through Steam Guard QR confirmation. Steam tokens are kept in process memory, not intentionally persisted to browser storage, files, a database or application logs. Closing/logging out ends the application's local session and clears retained references; this is not a promise of secure RAM erasure or revocation of every token previously issued by Steam. Use Steam's device/session settings to revoke access when necessary.

The browser receives session status, the QR challenge and your library from the loopback backend. Therefore this is **not a browser-only, zero-local-server design**. Steam authentication and game-management requests leave your computer only for Steam; file contents are downloaded from Steam storage. Game covers are requested directly from Steam's CDN without a referrer. A trusted proxy explicitly configured by the user may also carry this traffic.

## Local boundaries

- The server accepts only literal loopback bind addresses. Public bind addresses, remote `APP_ORIGIN` values and a Vercel runtime are rejected. Do not expose the service through tunnels, public reverse proxies or port forwarding.
- API requests validate the Host header. Cross-site requests are rejected. Mutations require the exact configured origin and a session-bound CSRF token.
- Browser session cookies are HttpOnly and SameSite=Strict. Steam tokens are never returned as an API field.
- Browser storage contains language, theme and favorite AppIDs, with the SteamID used in the favorite-storage key to separate accounts. File lists and save contents are not stored in localStorage. Anyone with access to this browser profile can inspect these preferences.
- Logging intentionally excludes cookies, authorization headers, QR contents, signed storage URLs, file names and Steam tokens. Third-party debug output is not enabled.
- Do not use the application in an untrusted browser profile or on an infected device. Browser extensions, compromised dependencies, modified application code and software running as your OS user remain within the threat model.

## Destructive operations and backups

Deletion is limited to a reviewed, account-bound set of at most 500 files. The user must confirm that games are closed and enter the server-generated confirmation phrase. The plan expires and is consumed once. The server re-reads files and verifies their revision before executing a batch. This does not lock out another Steam client, provide a rollback or create a recycle bin.

Backups stream rather than loading multiple gigabytes into browser memory. Storage downloads use a strict HTTPS hostname allowlist, public-IP DNS pinning and SHA1/size verification. SHA1 here verifies Steam-provided file identity; it is not a modern digital signature or a substitute for TLS. Unsupported encoding, changed metadata or an invalid URL must fail, not produce a success claim. Always open and verify a backup before deleting cloud saves.

Cloud availability badges are advisory and may be briefly cached. Missing metadata and failed checks must not be represented as an empty cloud. They never authorize a deletion.

## Reporting a vulnerability

Do not publish tokens, QR codes, signed URLs, cookies or private saves in an issue. Use GitHub's private vulnerability reporting for this repository when the maintainer has enabled it. If the private reporting option is unavailable, open an issue asking for a private reporting channel without including exploit details or personal data. Maintainers should enable private reporting before the public launch.

## Maintainer release checklist

Review source and Git history for secrets before making the repository public. Review dependency and GitHub Actions updates; actions are pinned to full commit IDs and CI has read-only repository permission. CI must not receive Steam credentials. Enable branch protection/required CI checks and Vercel Deployment Checks separately; the presence of a YAML file does not configure those account settings. Deploy only `dist/public` to Vercel. Review the exact commit and public-build verification output before release.
