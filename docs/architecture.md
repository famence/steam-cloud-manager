# Architecture

## Local application and static website

`npm run build` creates the local React UI (`dist/client`) and Fastify process (`dist/server`). `npm start` serves both on loopback. Development uses Vite port 5173 and proxies only `/api/` to port 3000; `/api.ts` must remain a frontend module.

`npm run build:public` uses an independent entry point and prerenders `/en/` and `/ru/` into `dist/public`. It does not import the local application or API client. Only this directory is deployed to Vercel. The public website contains installation and security information, not a hosted Steam-session manager. Its CSP prohibits JavaScript network connections. `scripts/verify-public.mjs` and browser tests verify this separation.

## Trust boundary

Browser at loopback -> local Fastify process -> Steam CM/auth and validated Steam storage.

Steam refresh/access tokens remain in the local process. The browser receives a QR challenge, session status and library/file metadata, not Steam refresh/access tokens. The public website receives none of these. Trust in the local process, browser and dependencies remains necessary. See SECURITY.md; no independent audit is implied.

The backend rejects public bind addresses, remote origins and a Vercel runtime. Host/origin/CSRF checks and SameSite HttpOnly cookies protect the local API. Sessions are memory-only. Restarting requires signing in again. There is no hosted CORS relay or claim of generic Steam OAuth access.

## Steam compatibility

The adapter is pinned to steam-user 5.3.0 and steam-session 1.9.4. Cloud RPCs use the installed protobuf schemas. Library discovery tries legacy Cloud inventory, Player.GetOwnedGames, then PICS ownership. Every path classifies applications using PICS type metadata; only an explicit game type appears in the library. Unknown types can be opened by AppID.

Cloud support is inferred conservatively from positive UFS quotas/category metadata. Only explicit zero quotas produce unsupported. Missing metadata stays unknown. A positive file listing overrides an unsupported metadata flag.

File listing uses GetAppFileChangelist with a paginated EnumerateUserFiles fallback for selected unsupported-method responses. Downloads use ClientFileDownload with a metadata-verified signed URL fallback. Storage hosts and public DNS addresses are allowlisted/pinned; size and SHA1 are checked while streaming. Unsupported encodings and integrity failures fail closed.

## Library and summaries

The lightweight metadata list is fetched once. Search, ordering and card pagination are client-side. The first 24 cards render; IntersectionObserver reveals subsequent batches, with a keyboard-accessible button fallback. Covers load lazily and show placeholders on errors. This is not server-side PICS pagination.

Cloud summaries run for a snapshot of a revealed batch, at most two concurrent checks. Result-driven reordering does not recursively scan the entire account. A per-account backend cache coalesces requests, expires after 60 seconds and holds at most 1,000 entries. File operations bypass the summary cache. Failed checks never mark games empty.

Confirmed empty/unsupported games sort last and are visually muted but stay accessible. Favorites sort first within available/unknown games and within inactive games. Browser storage contains language/theme and favorite AppIDs keyed by SteamID, not cloud file lists or tokens.

## File operations

Deletion needs a one-use account-bound plan, exact confirmation, acknowledgement that games are closed and a fresh file revision. Plans expire after five minutes. The driver completes the upload batch even after partial failure and verifies remaining files. There is no rollback or lock against another Steam client.

ZIP backups stream through the local process. File System Access browsers save through a WritableStream; other browsers use an explicit single-use download link. Preflight errors are shown in the deletion dialog. Tests use artificial saves, never real accounts.

## Language, themes and SEO

The local UI stores language/theme preferences in the browser. System theme changes are observed. Message keys are identical in English and Russian. The confirmation phrase follows Accept-Language at plan creation and stays fixed while the review is open.

Public `/en/` and `/ru/` URLs have prerendered text, reciprocal hreflang and canonical URLs when SITE_URL or the Vercel production URL is known. Preview/unconfigured builds are noindex; the local UI is always noindex. SEO metadata does not guarantee indexing or rankings.

## Verification

Unit/API/protocol tests cover data boundaries and failures. Playwright tests cover settings, library navigation, lazy rendering, backup/deletion and the static site's network boundary. Browser tooling has a separate lockfile under tests/e2e. CI runs read-only without Steam credentials on Node.js 22/24. Branch protection and deployment gates are separate maintainer settings.
