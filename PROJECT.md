# Project: Steam Cloud Manager — Full-Stack Web Application on Vercel

## Architecture
The application is a browser-accessible, zero-install full-stack web application hosted on Vercel:
- **Frontend**: React 18 + Vite SPA (`src/client/App.tsx`), precompiled into `dist/client`. Loads instantly at `/` in any browser (desktop and mobile) with light/dark themes and English/Russian localization.
- **Backend**: Node.js 22/24 Fastify application adapted for Vercel Functions (`api/index.ts`) using Vercel Fluid Compute (`fluid: true`, 300s `maxDuration`). Also runs standalone locally for developer workflows (`npm run dev`).
- **Session & Security Layer**:
  - Stateless `AES-256-GCM` encrypted session tokens stored in `HttpOnly`, `SameSite=Strict`, `Secure` cookies (`__Host-scm` in production / `scm-session` in dev/test).
  - 32-byte key sourced from `SCM_SESSION_KEY` in production/Vercel environments (with ephemeral 32-byte fallback in local dev/test).
  - Encrypted tokens encapsulate session ID, CSRF token, mode (`live` vs `demo`), timestamps, and Steam credentials (`refreshToken`) for transparent cold-instance re-hydration without shared database dependencies.
  - Strict Origin and Host checking (`appOrigin`, `*.vercel.app`, and local loopback), constant-time CSRF token verification, and DNS-pinned SSRF prevention for Steam Cloud CDN downloads with streaming SHA-1 verification.
- **Interactive Demo Sandbox**:
  - Session-scoped `POST /api/auth/demo` endpoint initializing an isolated `DemoCloudDriver` with preloaded templates (`Cities: Skylines II`, `ELDEN RING`, `Baldur's Gate 3`).
  - Supports 1-click exploration: game listing, save inspection, mock downloads, ZIP exports, and two-phase deletion confirmation without requiring Steam login.
- **Legacy Transition**:
  - Static prerendered site (`dist/public`) replaced at `https://steam-cloud-manager.vercel.app/` by the interactive web application.
  - GitHub Pages (`https://famence.github.io/steam-cloud-manager/`) equipped with instant `<meta http-equiv="refresh">` pointing directly to the live Vercel web app.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Vercel Serverless Config & Entrypoint | Adapt `src/server/config.ts` for `env.VERCEL`, create `api/index.ts` handler, configure `vercel.json` rewrites `/api/(.*)`, 300s duration, outputDirectory `dist/client`, and CSP. | M1 | Survey (Explorer 1 & 3) |
| F2 | AES-256-GCM Encrypted Session Cookies | Complete authenticated token encryption with AAD, `SCM_SESSION_KEY` management with dev/test fallback, and cold-instance session recovery in `src/server/sessions.ts`. | M1 | Survey (Explorer 1) & User Req R1 |
| F3 | Hosted Security & Origin/CSRF Guards | In `src/server/app.ts`, allow `*.vercel.app` hosts, deployment origin matching, stateless CSRF validation, SSRF DNS pinning, and streaming SHA-1 checks. | M1 | Survey (Explorer 1) & User Req R1 |
| F4 | 1-Click Demo Mode Backend Endpoint | Implement `POST /api/auth/demo` in `src/server/app.ts` with isolated `DemoCloudDriver` templates (`Cities: Skylines II`, `ELDEN RING`, `Baldur's Gate 3`). | M1 | Survey (Explorer 1) & User Req R2 |
| F5 | Interactive Client App at `/` | Point `vercel.json` output to `dist/client` and serve SPA directly at `/` with zero install/clone instructions. | M2 | Survey (Explorer 2) & User Req R2 |
| F6 | 1-Click Demo Mode UI in App.tsx | Dual login CTAs ("Sign in with Steam QR" and "Try Demo Mode"), visual divider, cancel QR button, persistent in-app demo status banner with Sign Out, and header demo badge. | M2 | Survey (Explorer 2) & User Req R2 |
| F7 | Translation & Localization Revision | Revise `src/client/i18n.ts` (EN/RU) to remove all local-install references, describe AES-256-GCM encrypted web app, and add demo mode keys. | M2 | Survey (Explorer 2) & User Req R2 |
| F8 | GitHub Pages Redirect & Docs Transition | Add instant HTML meta refresh in `scripts/prerender.tsx` / `public-app.tsx` pointing to Vercel app; update `README.md` and `README.ru.md` showcasing live web app. | M2 | Survey (Explorer 2) & User Req R2 |
| F9 | Test Suite Modernization & CI Pipeline | Standardize `npm run check`, add unit/integration tests for token encryption, serverless config, demo endpoint, and cold-instance recovery; update `.github/workflows/ci.yml`. | M3 | Survey (Explorer 3) & User Req R3 |
| F10 | Comprehensive Playwright E2E Suite | Update `playwright.config.ts` for `process.env.BASE_URL`, expand `tests/e2e/app.spec.ts` for 1-click Demo Mode, search, downloads, ZIP export, deletion confirmation, and sign-out. | M3 | Survey (Explorer 3) & User Req R3 |
| F11 | Final Milestone: 100% E2E Pass & Tier 5 Hardening | Pass 100% of Tiers 1-4 tests, followed by Tier 5 adversarial white-box coverage hardening. | M4 | Project Architecture Dual Track |
| F12 | Production Deployment & Live Verification | Push to `origin main`, verify GitHub Actions CI and Vercel deployment, execute automated verification script and live Playwright E2E against `https://steam-cloud-manager.vercel.app/`. | M5 | Survey (Explorer 3) & User Req R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend Serverless Adaptation & Encrypted Sessions | Implement F1, F2, F3, F4 (`config.ts`, `api/index.ts`, `session-token.ts`, `sessions.ts`, `app.ts`, `demo-driver.ts`, `vercel.json`). | none | DONE (Gate PASS: 244/244 base tests, 107/107 adversarial scenarios, clean forensic audit) |
| M2 | Web-First Client UX, Demo Mode UI & Docs | Implement F5, F6, F7, F8 (`App.tsx`, `styles.css`, `i18n.ts`, `public-app.tsx`, `prerender.tsx`, `README.md`, `README.ru.md`). | M1 | DONE (Gate PASS: dual CTAs, demo banner, 112/112 i18n parity, redirect verified, 244/244 tests pass, clean forensic audit) |
| M3 | E2E Testing Track: Test Infrastructure & Suites | Implement F9, F10 (unit tests, token tests, cold-start integration tests, Playwright E2E suite, `TEST_INFRA.md`, publish `TEST_READY.md`). | M1 | DONE (E1..E5 PASSED & CERTIFIED: 92 test cases across 4 tiers, 232 test runs, TEST_READY.md published) |
| M4 | Final Milestone: 100% E2E Test Pass & Tier 5 Adversarial Hardening | Implement F11: Phase 1 pass 100% of Tiers 1-4 tests; Phase 2 adversarial coverage hardening. | M2, M3 | DONE (Gate PASS: 270/270 tests pass across 5 tiers, 172 backend + 98 browser, clean forensic audit) |
| M5 | Production Deployment, Release & Live Cloud Verification | Implement F12: git commit cleanly, push to `origin main`, verify Vercel and CI, run live verification script and live Playwright against `https://steam-cloud-manager.vercel.app/`. | M4 | IN_PROGRESS |

## Interface Contracts

### 1. Client ↔ Server Session & Auth Endpoints
- **`GET /api/session`**:
  - Response (200): `{ csrfToken: string, mode: 'live' | 'demo', login: LoginStatus }`
  - Cookie: `__Host-scm` (production HTTPS) or `scm-session` (dev HTTP), `HttpOnly; SameSite=Strict; Path=/; Secure`.
- **`POST /api/auth/demo`**:
  - Headers: `x-csrf-token: <csrfToken>`
  - Body: `{}`
  - Response (200): `{ csrfToken: string, mode: 'demo', login: { status: 'connected', user: { steamId: '76561198000000000', displayName: 'Demo Account' } } }`
  - Sets encrypted session cookie with `mode: 'demo'`.
- **`POST /api/auth/steam`**:
  - Headers: `x-csrf-token: <csrfToken>`
  - Body: `{}`
  - Response (200): `{ csrfToken: string, mode: 'live', login: { status: 'pending', qrDataUrl: 'data:image/png;base64,...' } }`
- **`POST /api/auth/logout`**:
  - Headers: `x-csrf-token: <csrfToken>`
  - Body: `{}`
  - Response (200): `{ csrfToken: string, mode: 'live', login: { status: 'disconnected' } }`
  - Clears session cookie and destroys server session.

### 2. Encrypted Session Cookie Token Contract
- **Format**: `Buffer.concat([iv (12), authTag (16), ciphertext]).toString('base64url')`
- **Cipher**: `AES-256-GCM` with AAD `steam-cloud-manager:vercel:v1`
- **Payload Schema**:
  ```typescript
  interface SessionTokenPayload {
    purpose: 'scm-session';
    sessionId: string;
    csrfToken: string;
    mode: 'live' | 'demo';
    issuedAt: number;
    expiresAt: number;
    steamId?: string;
    displayName?: string;
    refreshToken?: string;
  }
  ```
- **Review Plan & Export Ticket Tokens**:
  - Plan token purpose: `'review-plan'`, payload: `{ purpose: 'review-plan', appId: number, names: string[], revision: string, issuedAt: number, expiresAt: number }`

### 3. Vercel Serverless Function Adapter Contract
- **File**: `api/index.ts`
- **Export**: `export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void>`
- **Behavior**: Caches Fastify instance across warm Fluid Compute invocations; dispatches request via `app.server.emit('request', req, res)`.

## Code Layout
- `api/`: Vercel serverless function entrypoint (`api/index.ts`).
- `src/server/`: Backend source code:
  - `config.ts`: Environment configuration and origin resolution.
  - `app.ts`: Fastify application routes, security middleware, and auth endpoints.
  - `sessions.ts`: Session store with AES-256-GCM cold-instance rehydration.
  - `session-token.ts`: AES-256-GCM token encryption and key derivation.
  - `demo-driver.ts`: Offline demo cloud driver with mock save templates.
  - `steam/`: Steam protocol, PICS, download streaming, and cloud operations.
- `src/client/`: Frontend React application:
  - `App.tsx`: Main interactive application component.
  - `main.tsx`: Client entrypoint.
  - `i18n.ts`: English and Russian localization dictionaries.
  - `styles.css`: Styles for dark/light themes, demo banner, and login card.
  - `components/`: UI components (`Shell.tsx`, `GameCard.tsx`, `FileList.tsx`, etc.).
  - `public-app.tsx`: Transition/redirect component for static builds.
- `scripts/`: Build and verification scripts:
  - `prerender.tsx`: Prerenders redirect HTML for GitHub Pages.
  - `verify-production.mjs`: Automated live production verification probe.
- `tests/`: Test suites:
  - `tests/e2e/`: Playwright E2E tests (`app.spec.ts`, `playwright.config.ts`).
  - `src/server/*.test.ts`: Server unit and integration tests.
