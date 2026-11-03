# Steam Cloud Manager

[Русский](README.ru.md) · [Security](SECURITY.md) · [Vercel-only architecture](docs/vercel-only-architecture.md)

Open-source web app for browsing, backing up and managing Steam Cloud saves. End users install nothing: open the web app and authorize via Steam Guard QR.

**Status:** Vercel-only implementation in a draft pull request. Demo-based tests pass, but real Steam Guard login and refresh-token reconnect on deployed Vercel Functions are not verified. Destructive deletion is disabled by default until replay protection is proven.

## One hosting platform: Vercel

- /en/ and /ru/ are prerendered SEO pages.
- /app/ is a React app with English/Russian, system/light/dark themes, favorites and lazy game cards.
- /api/* is a same-origin Vercel Node.js Function, not an external service.
- The QR handshake is streamed through one Function invocation. A short-lived encrypted handoff establishes an AES-256-GCM-encrypted session cookie.
- The Secure HttpOnly SameSite=Strict cookie lives in the browser. Vercel decrypts it for each new request, reconnects to Steam, performs the operation and closes its connection.
- No VPS, external Steam API server, Electron or user-installed Node.js.

**Trust:** Vercel and the holder of the server encryption key can decrypt Steam credentials. Open source does not prove that the deployed code matches this repository and cannot guarantee security. This is not end-to-end encryption or a Cloud-only OAuth grant. See [SECURITY.md](SECURITY.md).

## Features

Steam Guard QR, game cards without DLC, search, favorites, lazy batches, grouped Cloud file checks, downloads and ZIP archives, EN/RU localization, responsive UI, GitHub footer, SEO landing pages and CI. Confirmed empty or unsupported games sort last; failed or unverified checks are not treated as zero.

## Vercel setup

Connect the repository to a Vercel project (Vite framework, repository root), which reads [vercel.json](vercel.json). No second server is required.

Configure these environment variables in Vercel:

- SCM_SESSION_KEY (required for all API sessions): 32 cryptographically secure random bytes encoded as 43-character base64url. Generate using Node crypto.randomBytes(32).toString('base64url') and paste the result into Vercel Environment Variables. Never commit or expose the key.
- SITE_URL (production SEO): final HTTPS site origin.
- DEMO_MODE (preview only): true to use artificial saves; never enabled in production.
- ENABLE_CLOUD_DELETE (optional): leave unset or false. Deletion is deliberately disabled until reliable cross-Function replay prevention and live Steam testing are completed.

The Vercel Function has maxDuration 300 seconds. Big ZIP transfers may exceed this; browser-side streaming ZIP assembly or shorter batches will be needed for very large saves. Do not delete original saves without checking that a complete backup opens correctly.

## Development

Only developers need Node.js 22.12 or newer. Run:

    npm ci
    npm run dev
    npm run check
    npm run test:browser:install
    npm run test:e2e

The local developer server uses the existing Fastify implementation, while Vercel uses stateless Functions. Tests include an HTTP demo of the Vercel API. Live Steam Cloud compatibility has not yet been independently verified.

See [docs/vercel-only-architecture.md](docs/vercel-only-architecture.md) and [SECURITY.md](SECURITY.md).

made by [@famence](https://github.com/famence)

### Automatic encryption-key setup

After signing into the Vercel CLI and linking the desired project, run `npm run setup:vercel-key -- preview`. This command checks for an existing `SCM_SESSION_KEY` and generates it only if absent. It passes the key through stdin directly to the Vercel CLI with Sensitive/Secret protection, without printing or saving its value. Use `npm run setup:vercel-key -- production` to set up an independent production key. Existing keys are never overwritten. Redeploy the corresponding environment after creation.
