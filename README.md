# Steam Cloud Manager

[Русский](README.ru.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

Browse, back up and delete Steam Cloud saves from a local web interface. MIT-licensed. English and Russian, system/light/dark themes, favorites, searchable game cards and lazy card loading.

## Important: local app, static public website

The manager runs on **your computer**. The Node.js process connects to Steam and keeps Steam session tokens in memory. A Vercel deployment serves only the public website and installation instructions; it has no Steam login, session, save-file or proxy endpoints.

This is not a browser-only manager: it requires a local Node.js process. During development the tested Steam CM endpoint accepted a WebSocket without an Origin and with the Steam Community origin, but rejected the project's website origin with HTTP 403. Rather than route full Steam sessions through a hosted proxy, the project keeps that connection local. Steam behavior can change; the integration uses unofficial client protocols.

See [SECURITY.md](SECURITY.md) for the exact data flow, residual risks and reporting policy. The project has not undergone an independent security audit.

## Run locally

Requires Node.js **22.12+** and Windows, macOS or Linux.

```sh
git clone https://github.com/famence/steam-cloud-manager.git
cd steam-cloud-manager
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Confirm the QR sign-in in Steam Guard. Signing out or stopping the process ends the application's local session. No Steam Web API key or hosted database is needed.

For development:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Optional settings are documented in `.env.example`; defaults work without an `.env` file. Do not reuse a remote `APP_ORIGIN` from older versions. Public backend hosting is intentionally rejected. Container hosting is not part of the supported setup; use the local Node process instead.

Set `DEMO_MODE=true` in a local `.env` to test with artificial saves and no Steam account.

## Using the library

The library contains applications classified by Steam metadata as games, not DLC, tools or soundtracks. Unclassified titles can be opened manually with a numeric AppID or a Steam store `/app/` URL.

Favorites are stored in this browser per Steam account. Available and unverified favorites appear first; confirmed empty/unsupported games remain at the end, even when favorited. The full lightweight game metadata list is fetched once. Cards and cover images are revealed lazily in batches of 24 as you scroll; this is incremental rendering, not server-side pagination of the PICS inventory.

Cloud file counts are checked in small batches, with at most two checks per account in parallel and a short-lived local cache. The application distinguishes:

- Saves found: a confirmed file count and size.
- No cloud saves: an actual successful empty response.
- Steam Cloud not supported: explicit metadata indicating zero Cloud quotas.
- Not checked or failed check: unknown, never treated as zero.

Some games do not expose enough metadata to establish support. Their state stays unknown until checked. Sorting can change as new results arrive.

## Backups and deletion

Download individual files or select up to 500 files for a ZIP backup. In Chromium browsers with the File System Access API, data streams to the chosen destination. Other browsers get an explicit, single-use download link, including inside the deletion dialog. Wait for the download to finish and verify the archive before deleting anything.

Deletion requires a fresh review, exact confirmation phrase and confirmation that the game and GeForce NOW are closed. Files are rechecked before the batch. Partial errors are reported. There is no rollback/recycle bin; another active game client may upload files again. Renaming and upload are not implemented.

## Checks and CI

```sh
npm run check
npm run test:browser:install
npm run test:e2e
```

GitHub Actions runs type checks, unit/API/protocol tests, local and public builds on Node.js 22/24, a production dependency audit and Chromium browser scenarios using demo data. It uses pinned actions, read-only permissions and no Steam or deployment secrets. Dependabot checks npm and Actions updates weekly.

Required status checks, branch protection and Vercel Deployment Checks are account settings that must be enabled by the maintainer. Adding a workflow does not enable those gates automatically.

## Public website on Vercel

Import this repository into a **separate Vercel project**. `vercel.json` installs dependencies, runs `npm run check` (tests and both builds) and publishes only `dist/public`. Do not configure Steam credentials or a backend/API rewrite.

The public pages `/en/` and `/ru/` are prerendered HTML with localized titles/descriptions, Open Graph metadata, `hreflang`, canonical URLs, SoftwareApplication microdata, `robots.txt` and a sitemap. Set `SITE_URL` to your final HTTPS origin, or use Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. Without a known origin, the build intentionally omits a fabricated canonical and is noindex. Preview builds are also noindex. SEO configuration does not guarantee search rankings or indexing.

```sh
SITE_URL=https://your-project.vercel.app npm run build:public
node scripts/preview-public.mjs
```

The public build verification rejects local API/Steam client code in its bundle. Its CSP disallows network connections from JavaScript. The local authenticated UI is always marked noindex.

## Before making the repository public

Review Git history for secrets, enable private vulnerability reporting, select required CI checks and verify the static deployment. A `LICENSE` file does not itself change GitHub repository visibility.

made by [@famence](https://github.com/famence)
