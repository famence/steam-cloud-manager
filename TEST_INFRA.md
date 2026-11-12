# Test Infrastructure Specification: Steam Cloud Manager Full-Stack Web Application

## 1. Overview & Testing Philosophy

Steam Cloud Manager is transitioning from a local-only tool into a browser-accessible, zero-install full-stack web application deployed in production on Vercel (`https://steam-cloud-manager.vercel.app/`).

This document defines the comprehensive test infrastructure, opaque-box testing methodology, 4-tier test architecture, directory layout, test runner tooling, execution pipeline, naming conventions, and quality gate thresholds required across milestones E1 through E5.

### 1.1 Testing Principles

1. **Opaque-Box Requirement Derivation**:
   - Tests are derived strictly from authoritative user requirements (`ORIGINAL_REQUEST.md`) and architectural specifications (`PROJECT.md`).
   - Tests verify external HTTP contracts, headers, response status codes, cookie flags, DOM interactions, cryptographic tamper-resistance, and error codes rather than internal implementation details.
   - For every test case, the expected output is derived directly from documented specifications, mathematical/cryptographic invariants (e.g. AES-256-GCM authentication tag verification), or reference behavior.

2. **Dual-Target Execution (`BASE_URL`)**:
   - The test infrastructure seamlessly executes against two operational targets:
     - **Local Fastify Backend & Vite SPA (`http://127.0.0.1:3110`)**: Spun up locally by Playwright `webServer` or tested via Node.js Fastify injection with ephemeral 32-byte fallback session keys.
     - **Live Production Vercel Deployment (`https://steam-cloud-manager.vercel.app/`)**: Activated by setting `process.env.BASE_URL`. Playwright bypasses local `webServer` launch and runs tests directly against the deployed serverless functions and CDN assets over HTTPS.

3. **Hermetic & Isolated Multi-Instance Execution**:
   - Tests must be completely self-contained and isolated. No test may depend on execution order or dirty persistent storage.
   - Because Vercel Fluid Compute operates across distributed serverless instances with ephemeral process memory, tests explicitly verify cold-start rehydration across independent instances without shared RAM.

4. **Zero Flakiness Tolerance**:
   - Arbitrary sleep statements (`setTimeout`, `sleep()`) are strictly forbidden.
   - All asynchronous waits must use deterministic polling, event listeners (`page.waitForEvent('download')`), or Playwright auto-retrying web assertions (`expect(locator).toBeVisible()`).

5. **Adversarial Verification**:
   - All security barriers are verified against adversarial tampering: single-bit flipping in IV, tag, and ciphertext; host header injection; spoofed `*.vercel.app` suffixes; cross-site origin access; and timing-safe CSRF validation.

---

## 2. Feature Inventory (EF1 through EF6) & Requirements Traceability

The E2E Testing Track defines six core features (EF1 through EF6), mapped to the user requirements R1 through R4 from `ORIGINAL_REQUEST.md`:

| Feature ID | Feature Name | Description | Milestone | Source |
|---|---|---|---|---|
| **EF1** | Test Infrastructure & Framework Setup | Standardize runner commands, config flags, reporters, directory layout, and master `TEST_INFRA.md`. | E1 | Project Pattern & Req R3 |
| **EF2** | AES-256-GCM Session Encryption Tests | Authenticated token encryption with AAD, tamper detection, bit-flipping resilience, key derivation, expiration, purpose binding, and cold-instance rehydration. | E2 | Req R1 & PROJECT.md |
| **EF3** | Serverless Security & Origin/CSRF Tests | Hosted origin validation (`*.vercel.app`), CSRF token enforcement, `SameSite=Strict` cookies, `Sec-Fetch-Site` restrictions, SSRF DNS pinning, and streaming SHA-1 checks. | E2 | Req R1 & PROJECT.md |
| **EF4** | Demo Mode API Lifecycle & Integration | `POST /api/auth/demo`, session state, mock games list, downloads, ZIP export tickets, two-phase deletion with revision locking, and logout. | E3 | Req R2 & PROJECT.md |
| **EF5** | Interactive Playwright Browser E2E Suite | 1-click Demo Mode login, library search/favorites, file inspection, downloads, ZIP backup, deletion dialog, signout across desktop & mobile viewports. | E4 | Req R2, R3 & PROJECT.md |
| **EF6** | Test Suite Validation & `TEST_READY.md` | Full multi-tier test execution, 100% pass verification, coverage calculation, and publication of `TEST_READY.md`. | E5 | Project Pattern & Req R3 |

### Traceability Matrix to Requirements

| Requirement | Requirement Summary | Target Features | Primary Test Suites |
|---|---|---|---|
| **R1** | Full-stack serverless architecture on Vercel, AES-256-GCM encrypted cookies, hosted origin/CSRF protection, cold-start recovery | EF2, EF3 | `src/server/session-token.test.ts`<br>`src/server/security.test.ts` |
| **R2** | Web-first UX at `/`, 1-click Demo Mode (`POST /api/auth/demo`), demo warning banner, bilingual localization (EN/RU), zero install instructions | EF4, EF5 | `src/server/demo-api.test.ts`<br>`tests/e2e/app.spec.ts` |
| **R3** | Comprehensive 4-tier testing, test runner modernization, local and live cloud verification via `BASE_URL` | EF1, EF5, EF6 | `tests/e2e/playwright.config.ts`<br>`tests/e2e/app.spec.ts`<br>`TEST_READY.md` |
| **R4** | Production deployment on Vercel, live cloud verification, public domain validation | EF5, EF6 | `tests/e2e/app.spec.ts` (`BASE_URL`)<br>`scripts/verify-production.mjs` |

---

## 3. Standardized 4-Tier Test Architecture & Taxonomy

Every feature in scope is tested across four standardized tiers:

```
┌─────────────────────────────────────────────────────────────┐
│          Tier 4: Real-World Application Scenarios           │
│   (>=5 multi-step, end-to-end browser journeys in Playwright)│
├─────────────────────────────────────────────────────────────┤
│         Tier 3: Pairwise Cross-Feature Combinations         │
│     (Cross-boundary interactions, state combinations)       │
├─────────────────────────────────────────────────────────────┤
│             Tier 2: Boundary & Corner Cases                 │
│  (>=5 edge cases, bit-flips, tampering, overflows, limits)  │
├─────────────────────────────────────────────────────────────┤
│                 Tier 1: Feature Coverage                    │
│   (>=5 baseline requirement contracts per target feature)   │
└─────────────────────────────────────────────────────────────┘
```

- **Tier 1 — Feature Coverage**: Baseline functional coverage verifying each requirement and interface contract under valid conditions. **Requirement: >= 5 test cases per feature.**
- **Tier 2 — Boundary & Corner Cases**: Stress-testing boundaries, negative validation, cryptographic bit-flipping, malformed inputs, edge timestamps, rate limits, and network anomalies. **Requirement: >= 5 test cases per feature.**
- **Tier 3 — Cross-Feature Combinations**: Pairwise and multi-variable interactions (e.g. encrypted session rehydration + CSRF validation; demo session + deletion plan replay; mobile viewport + live origin + theme/locale).
- **Tier 4 — Real-World Application Scenarios**: Complete, browser-driven end-to-end user journeys executing realistic workflows from start to finish. **Requirement: >= 5 complete application scenarios.**

### Test Identifier Taxonomy

All tests implement a structured identifier to enable deterministic filtering and reporting:

$$\mathbf{T}\{\text{Tier}\}\text{-EF}\{\text{Feature Number}\}\text{-}\{\text{Case Number}\}\mathbf{: }\text{Description}$$

- **`T{1..4}`**: Test Tier (1 = Feature Coverage, 2 = Boundary & Corner, 3 = Cross-Feature, 4 = Real-World Scenario).
- **`EF{2..5}`**: Feature Identifier from the Scope Inventory (or pairwise `EF{A}-EF{B}`).
- **`{01..99}`**: Two-digit zero-padded test case sequence within the tier and feature.
- **`Description`**: Precise imperative statement of the action and expected outcome.

Examples:
- `T1-EF2-01: Encrypts session claims into authenticated base64url string with AAD`
- `T2-EF2-01: Single-bit flipped in ciphertext triggers auth tag rejection and returns null`
- `T3-EF2-EF3-01: Cold-start rehydration decrypts session state across independent store instances`
- `T4-EF5-01: First-Time Visitor 1-Click Demo Exploration & Live ZIP Backup`

---

## 4. Directory Layout & Test File Decomposition Across Milestones

### 4.1 File Tree Layout

```
steam-cloud-manager/
├── api/
│   └── index.ts                         # Vercel Function serverless entrypoint
├── src/
│   ├── server/
│   │   ├── session-token.ts             # AES-256-GCM token encryption & key derivation
│   │   ├── session-token.test.ts        # [Milestone E2] EF2 AES-256-GCM token tests (Tiers 1-3)
│   │   ├── security.test.ts             # [Milestone E2] EF3 Serverless origin, CSRF, cookie security (Tiers 1-3)
│   │   ├── demo-api.test.ts             # [Milestone E3] EF4 Demo mode API lifecycle & isolation (Tiers 1-3)
│   │   ├── app.test.ts                  # Core API endpoint integration tests
│   │   ├── files.test.ts                # ZIP path sanitization, RFC 5987 headers
│   │   ├── library.test.ts              # AppID parsing and plurals
│   │   ├── sessions.test.ts             # SessionStore LRU/TTL eviction under flood
│   │   ├── opensource.test.ts           # Cloud support metadata, game ordering
│   │   └── steam/                       # Steam network protocol and driver tests (42 tests)
│   │       ├── cloud-operations.test.ts
│   │       ├── download.test.ts
│   │       ├── game-list.test.ts
│   │       ├── pics-owned-games.test.ts
│   │       └── protocol.test.ts
├── tests/
│   ├── e2e/
│   │   ├── app.spec.ts                  # [Milestone E4] EF5 Playwright browser journeys (Tiers 1-4)
│   │   ├── public-site.spec.ts          # [DEPRECATED / SEGREGATED] Legacy static landing page E2E suite (ignored in test:e2e)
│   │   ├── playwright.config.ts         # [Milestone E4] BASE_URL support, dual local/remote mode, testMatch segregation
│   │   ├── package.json                 # Dedicated Playwright dependencies (@playwright/test)
│   │   └── tsconfig.json                # E2E TypeScript compilation configuration
│   └── public-site.test.ts              # [DEPRECATED / SEGREGATED] Static landing page suite (excluded from check)
├── scripts/
│   ├── verify-production.mjs            # Standalone Node production HTTP API probe
│   └── start-local.mjs                  # Local production test server launcher
├── package.json                         # Test execution commands and pipeline scripts
├── TEST_INFRA.md                        # Master Test Infrastructure Specification (this document)
└── TEST_READY.md                        # Validation status and coverage gate artifact (Milestone E5)
```

> **Strict Isolation Rule**: `.agents/teamwork/` contains ONLY agent metadata (briefings, progress, dispatches, handoffs). Source code and test files must NEVER be placed in `.agents/teamwork/`.

### 4.2 Test File Responsibilities & Allocation

#### 1. `src/server/session-token.test.ts` (Milestone E2 — Feature EF2)
- **Role**: Cryptographic engine verification for AES-256-GCM authenticated tokens.
- **Framework**: Node.js native test runner (`node:test`, `node:assert/strict`).
- **Core Areas**:
  - Key derivation and resolution: Enforces 43-character base64url string (32 bytes) in production/Vercel; falls back cleanly to ephemeral 32-byte key in dev/test.
  - Wire format verification: `Buffer.concat([iv(12), authTag(16), ciphertext]).toString('base64url')`.
  - AAD binding: Authenticated Additional Data sealed with `steam-cloud-manager:vercel:v1`.
  - Confidentiality: Zero plaintext leaks of `refreshToken`, `steamId`, or `displayName`.
  - Tamper resistance: Bit-flipping IV, tag, or ciphertext yields `null`.
  - Expiration & clock-skew: Strict expiration bounds (`expiresAt <= now` rejected, `issuedAt > now + 5000` rejected).
  - Purpose binding: Rejection of cross-purpose token replay (`scm-session` vs `review-plan` vs `export-ticket`).
  - Cold-instance simulation: Multi-store encryption/decryption without shared RAM.

#### 2. `src/server/security.test.ts` (Milestone E2 — Feature EF3)
- **Role**: Serverless security boundary, origin allowlisting, and CSRF protection.
- **Framework**: Node.js native test runner (`node:test`, `node:assert/strict`).
- **Core Areas**:
  - Cookie security: `__Host-scm` (production HTTPS) or `scm-session` (dev HTTP) with `HttpOnly`, `SameSite=Strict`, `Path=/`, and conditional `Secure`.
  - Hosted Origin allowlisting: Accepts `config.appOrigin`, `https://steam-cloud-manager.vercel.app`, and `*.vercel.app` preview URLs.
  - Cross-Origin rejection: Returns 403 `INVALID_ORIGIN` on unauthorized or spoofed origins.
  - Host Header defense: Returns 403 `INVALID_HOST` on spoofed or mismatched Host headers.
  - CSRF Token verification: Constant-time check (`crypto.timingSafeEqual`) on `POST`, `PUT`, `DELETE`.
  - `Sec-Fetch-Site` enforcement: Returns 403 `CROSS_SITE_REQUEST` when header is `cross-site`.
  - SSRF DNS pinning & streaming SHA-1: Validates IP addresses against private/loopback subnets; streaming hash check during download.

#### 3. `src/server/demo-api.test.ts` (Milestone E3 — Feature EF4)
- **Role**: Complete REST API lifecycle and isolation of 1-click Demo Mode.
- **Framework**: Node.js native test runner (`node:test`, `node:assert/strict`).
- **Core Areas**:
  - Authentication: `POST /api/auth/demo` creates demo session without Steam credentials; returns user `76561198000000000` ("Demo Account").
  - Session verification: `GET /api/session` returns `mode: 'demo'` and active CSRF token.
  - Game catalog: `GET /api/games` returns 3 predefined demo games (`Cities: Skylines II`, `ELDEN RING`, `Baldur's Gate 3`).
  - Save file inspection: `GET /api/games/:appId/files` returns deterministic saves with SHA-1 checksums and revision.
  - Single-file streaming: `GET /api/games/:appId/download` streams save with RFC 5987 `Content-Disposition`.
  - ZIP export tickets: `POST /api/games/:appId/exports` generates single-use ticket; `GET /api/exports/:ticket` streams valid ZIP starting with `PK`.
  - Two-phase deletion: `POST /api/games/:appId/delete-plan` and `POST /api/games/:appId/delete` requiring exact confirmation phrase `DELETE <count>`.
  - Optimistic locking: Revision mismatch returns 409 `PLAN_EXPIRED`.
  - Session isolation: Mutations in Session A do not affect Session B.
  - Session termination: `POST /api/auth/logout` revokes cookies and resets session to disconnected.

#### 4. `tests/e2e/app.spec.ts` & `playwright.config.ts` (Milestone E4 — Feature EF5)
- **Role**: Full browser user journeys across desktop and mobile viewports against local or live Vercel deployments.
- **Framework**: Playwright (`@playwright/test`).
- **Core Areas**:
  - Web-first start screen: Direct load at `/` with dual CTAs ("Sign in with Steam QR" and "Try Demo Mode"), zero local install instructions.
  - 1-click Demo Mode login: Immediate transition to interactive game library.
  - Demo mode banner & header badge: Prominent visual indicator with functional Sign Out button.
  - Library search & filtering: Instant client-side search; favorites elevation; state persistence across reload.
  - Save file inspection & single download: Modal/table display; browser download event capture.
  - ZIP archive export: Multi-file selection; ZIP download; magic bytes validation (`PK`).
  - Two-phase deletion dialog: Confirmation button gated by exact confirmation phrase input `DELETE 1`.
  - Responsive mobile layout: 390x844 viewport, zero horizontal overflow (`scrollWidth <= innerWidth`).
  - Live production execution: Parameterized via `process.env.BASE_URL` to test `https://steam-cloud-manager.vercel.app`.

#### 5. Segregation of Legacy Static Site Tests (Unit & E2E)
- **Legacy Static Site Unit Tests (`tests/public-site.test.ts`)**:
  - Contains 82 tests for the previous static landing page (which previously caused Vercel deployment failure `dpl_3NgxywDtKxzRfaPBRXBEmuYrALGd` due to conflicting preview robots.txt assertions).
  - Segregated from `npm test` and `npm run check` by scoping the Node test runner to `'src/server/**/*.test.ts'`.
- **Legacy Static Site Browser E2E Tests (`tests/e2e/public-site.spec.ts`)**:
  - Contains 6 Playwright E2E tests (`T4-01` through `T4-06`) targeting the deprecated static landing page on `http://127.0.0.1:3111/steam-cloud-manager/en/`.
  - In the full-stack web application architecture, the legacy preview script (`scripts/preview-public.mjs` on port 3111) is removed from `playwright.config.ts` `webServer` because the app is served directly at `/` on port 3110 locally and `https://steam-cloud-manager.vercel.app/` on Vercel.
  - Executing `tests/e2e/public-site.spec.ts` without port 3111 causes an immediate `net::ERR_CONNECTION_REFUSED` crash (exit code 1). Furthermore, running against a live environment (`BASE_URL=https://steam-cloud-manager.vercel.app`) causes hard failure because `public-site.spec.ts` has hardcoded loopback URLs (`http://127.0.0.1:3111`).
  - Segregated from `npm run test:e2e` via `testMatch: ['**/app.spec.ts']` and `testIgnore: ['**/public-site.spec.ts']` in `tests/e2e/playwright.config.ts`.
- **Core Web Application Verification Scope**:
  - Full-stack web application testing is strictly performed by `src/server/**/*.test.ts` (Node native test runner) and `tests/e2e/app.spec.ts` (Playwright E2E browser runner).

---

## 5. Test Runner Tooling, Scripts & Environment Matrix

### 5.1 Dual-Runner Tooling Rationale

1. **Node.js Native Test Runner (`node:test`)**:
   - Provides fast, zero-dependency, hermetic execution (<2s per backend suite) with native TypeScript via `--import tsx`.
   - Used for cryptographic operations (AES-256-GCM), serverless security hooks, Fastify request dispatch, and API lifecycle contracts.
   - Standard Node 24 flags: `--test`, `--test-name-pattern="<regex>"`, `--test-reporter=spec`.

2. **Playwright Test Runner (`@playwright/test`)**:
   - Provides true browser execution in headless Chromium across desktop (1200x850) and mobile (390x844) viewports.
   - Captures real DOM events, downloads (`page.waitForEvent('download')`), network interceptions, local storage, and failure artifacts (screenshots, traces, videos).
   - Standard CLI flags: `-g, --grep <regex>`, `--project`, `--retries`, `--forbid-only`.

### 5.2 Standardized `package.json` Scripts

The standardized test scripts for `package.json`:

```json
{
  "scripts": {
    "dev": "concurrently -k -n api,web \"tsx watch src/server/index.ts\" \"vite --host 127.0.0.1\"",
    "build": "tsc --noEmit && vite build && tsc -p tsconfig.server.json",
    "start": "node scripts/start-local.mjs",
    "typecheck": "tsc --noEmit && tsc -p tests/e2e/tsconfig.json",
    "test": "node --import tsx --test 'src/server/**/*.test.ts'",
    "test:unit": "node --import tsx --test 'src/server/session-token.test.ts' 'src/server/files.test.ts' 'src/server/library.test.ts'",
    "test:security": "node --import tsx --test 'src/server/security.test.ts'",
    "test:api": "node --import tsx --test 'src/server/demo-api.test.ts' 'src/server/app.test.ts'",
    "test:tier1": "node --import tsx --test --test-name-pattern=\"Tier 1|T1-\" 'src/server/**/*.test.ts'",
    "test:tier2": "node --import tsx --test --test-name-pattern=\"Tier 2|T2-\" 'src/server/**/*.test.ts'",
    "test:tier3": "node --import tsx --test --test-name-pattern=\"Tier 3|T3-\" 'src/server/**/*.test.ts'",
    "test:tier4": "node tests/e2e/node_modules/playwright/cli.js test --config=tests/e2e/playwright.config.ts -g \"Tier 4|T4-\"",
    "test:e2e": "tsc -p tests/e2e/tsconfig.json && node tests/e2e/node_modules/playwright/cli.js test --config=tests/e2e/playwright.config.ts",
    "test:e2e:tier1": "npm run test:e2e -- -g \"Tier 1|T1-\"",
    "test:e2e:tier2": "npm run test:e2e -- -g \"Tier 2|T2-\"",
    "test:e2e:tier3": "npm run test:e2e -- -g \"Tier 3|T3-\"",
    "test:e2e:tier4": "npm run test:e2e -- -g \"Tier 4|T4-\"",
    "test:e2e:live": "BASE_URL=https://steam-cloud-manager.vercel.app npm run test:e2e",
    "test:all": "npm run typecheck && npm test && npm run test:e2e",
    "check": "npm run typecheck && npm test && npm run build",
    "test:browser:install": "npm ci --prefix tests/e2e --ignore-scripts && node tests/e2e/node_modules/playwright/cli.js install chromium"
  }
}
```

> **Runner Note on Filtered Scripts**: The scripts `test:tier1`, `test:tier2`, and `test:tier3` use `--test-name-pattern` for rapid developer feedback. Because `node:test` exits with code 0 when zero tests match a pattern, CI quality gating must execute the unpatterned suite `npm test` (`node --import tsx --test 'src/server/**/*.test.ts'`) or explicitly assert `pass > 0` in reporter output.

### 5.3 Playwright Configuration (`tests/e2e/playwright.config.ts`)

```typescript
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3110';
const isExternal = Boolean(process.env.BASE_URL);

export default defineConfig({
  testDir: '.',
  // Segregate legacy static landing page E2E suite (public-site.spec.ts requires legacy port 3111 preview server)
  // Strictly target core full-stack web application journeys (app.spec.ts)
  testMatch: ['**/app.spec.ts'],
  testIgnore: ['**/public-site.spec.ts'],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/html' }],
  ],
  use: {
    baseURL,
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1200, height: 850 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  // If targeting a live hosted environment (BASE_URL set), skip local webServer spawn
  webServer: isExternal
    ? undefined
    : {
        command: 'npm start',
        cwd: process.cwd(),
        url: 'http://127.0.0.1:3110/api/health',
        env: {
          PORT: '3110',
          DEMO_MODE: 'true',
          NODE_ENV: 'production',
        },
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
```

### 5.4 Environment Configuration Matrix

| Variable | Local Unit & API Tests | Local Playwright E2E | Live Vercel Production Run |
|---|---|---|---|
| `BASE_URL` | *Unset* | `http://127.0.0.1:3110` | `https://steam-cloud-manager.vercel.app` |
| `SCM_SESSION_KEY` | *Unset* (ephemeral 32-byte key fallback) | *Unset* (ephemeral 32-byte key fallback) | 32-byte base64url secret |
| `NODE_ENV` | `test` | `production` / `test` | `production` |
| `PORT` | `3000` / `3110` | `3110` | Managed by Vercel |
| `DEMO_MODE` | `false` | `true` | `false` (API supports demo via `/api/auth/demo`) |
| `CI` | `false` | `false` (or `true` in GitHub Actions) | `true` |

---

## 6. 5-Stage Execution Pipeline, Pass/Fail Semantics & Exit Code Contracts

### 6.1 5-Stage Sequential Pipeline

Execution order is strictly sequential and fails fast upon any error:

```
[Stage 1: Typecheck] ──► [Stage 2: Unit/Security] ──► [Stage 3: API Lifecycle] ──► [Stage 4: Build] ──► [Stage 5: Browser E2E]
```

1. **Stage 1: Static Type & Contract Checking**
   - Command: `npm run typecheck`
   - Validates root TypeScript and Playwright E2E TypeScript without emitting artifacts (`tsc --noEmit && tsc -p tests/e2e/tsconfig.json`).
2. **Stage 2: Fast Unit & Cryptographic Security Test Suites**
   - Command: `npm run test:unit && npm run test:security`
   - Validates token encryption, key derivation, bit-flipping tamper rejection, CSRF checks, and origin validation in-memory (<5s).
3. **Stage 3: Integration & API Lifecycle Tests**
   - Command: `npm run test:api`
   - Validates `POST /api/auth/demo`, game listing, save download streaming, ZIP export preparation, two-phase deletion, and cold-start recovery.
4. **Stage 4: Production Build Compilation**
   - Command: `npm run build`
   - Compiles React SPA to `dist/client` and Fastify server to `dist/server`.
5. **Stage 5: Browser E2E Journeys**
   - Command: `npm run test:e2e` (or `npm run test:e2e:live` against live deployment)
   - Executes desktop and mobile Playwright journeys against the application.

### 6.2 Pass/Fail Semantics & Silent Pass Guard

- **Zero-Tolerance Pass Criteria**:
  - 100% of discovered tests must pass.
  - Zero test failures (`fail === 0`).
  - Zero skipped tests (`skip === 0`). The use of `test.skip` or `test.todo` to bypass failing tests is strictly prohibited.
  - Zero uncaught exceptions or unhandled promise rejections.
  - Zero presence of `test.only` (`forbidOnly` enforced in CI).

- **Silent Pass Guard (`node:test --test-name-pattern`)**:
  - **Empirical Runner Behavior**: The Node.js native test runner (`node:test`) treats non-matching patterns as a clean pass at the file level and exits with code `0` even when zero individual tests execute.
  - **CI Quality Gating Requirement**: All automated CI pipelines and quality verification gates (`npm test`, `npm run check`) MUST execute unpatterned glob suites (`node --import tsx --test 'src/server/**/*.test.ts'`) to ensure all tests execute unconditionally.
  - **Patterned Runner Guard**: Any CI step utilizing `--test-name-pattern` filtering must explicitly assert that executed test count is greater than zero (`pass > 0`), guarding against pattern typos and skipped suites.

### 6.3 Exit Code Contracts

The execution pipeline enforces strict Unix exit code semantics across all test runners, compilers, and CI environments:

- **Exit Code `0`**: Success. All discovered tests passed cleanly, zero assertions failed, zero tests skipped, and no unhandled rejections occurred.
- **Exit Code `1`**: Tool-level failure (Test Failure, Compilation Error, or Runtime / Configuration Error).
  - Emitted by **Node.js** (`node:test`) on assertion failures, unhandled errors, unhandled promise rejections, missing test files, or unresolved module dependencies.
  - Emitted by **Playwright** (`@playwright/test`) on test failures, zero matched tests (`Error: No tests found`), missing browser binaries, or invalid configuration files.
  - Emitted by **TypeScript** (`tsc`) on static type errors or missing `tsconfig.json` path.
- **Exit Code `127`**: Command binary not found.
  - Emitted by the **operating system shell** (`bash`/`zsh`) when an executable binary (such as `node`, `npx`, or a script) is missing from `$PATH`.
- **CI Contract**: Any non-zero exit code (`$? !== 0`) is treated as a fatal blocking failure. CI scripts must not branch on exit code `2` or assume tools distinguish configuration errors from assertion failures via exit codes.

### 6.4 Flakiness & Retry Policies

- **Local Development**: `retries = 0`. Flaky tests fail immediately to prevent masking race conditions or timing defects.
- **CI / Hosted Environments**: `retries = 1`. Allowed solely to tolerate transient network latency when testing against live endpoints over the internet. Any test passing only on retry must be flagged as flaky in the test report.

### 6.5 Timeout Budgets

- **Node.js Unit Tests**: Max 30 seconds per suite; individual unit assertions expected < 100ms.
- **Playwright Browser Tests**: Max 30 seconds per test; locator action timeout 5 seconds; navigation timeout 15 seconds.
- **Overall Pipeline Budget**: 5 minutes.

### 6.6 Diagnostic Artifact Retention

- Playwright captures screenshots on failure (`screenshot: 'only-on-failure'`).
- Playwright retains execution traces on failure (`trace: 'on-first-retry'`).
- Playwright records videos on failure (`video: 'retain-on-failure'`).
- Playwright writes HTML summary report to `test-results/html`.

---

## 7. Exhaustive 4-Tier Test Mapping & Inventory (92 Comprehensive Test Cases)

### Summary Breakdown by Tier

| Tier | Description | Target Minimum | Total Cases Specified | Status |
|---|---|---|---|---|
| **Tier 1** | Feature Coverage | >= 5 per feature (>= 30 total) | **34** | EXCEEDS TARGET |
| **Tier 2** | Boundary & Corner Cases | >= 5 per feature (>= 30 total) | **37** | EXCEEDS TARGET |
| **Tier 3** | Pairwise Cross-Feature Combinations | Pairwise coverage (>= 8 total) | **15** | EXCEEDS TARGET |
| **Tier 4** | Real-World Application Scenarios | >= 5 scenarios | **6** | EXCEEDS TARGET |
| **TOTAL** | **Full E2E Test Suite** | **>= 75 test cases** | **92** | **COMPLETE** |

---

### 7.1 Tier 1: Feature Coverage (34 Test Cases)

*Target: >= 5 per feature across EF2-A (Tokens), EF2-B (Cold Start), EF3 (Security), EF4 (Demo API), EF5-A (Client UX), EF5-B (Browser Journeys).*

| Test ID | Feature | Test Name | Target File | Inputs / Setup | Observable Output | Exact Assertions |
|---|---|---|---|---|---|---|
| `T1-FEAT-F1-01` | EF2-A | AES-256-GCM Token Encryption Confidentiality & AAD Binding | `src/server/session-token.test.ts` | Valid `SessionTokenPayload`, 32-byte key | Base64url authenticated ciphertext string (>28 bytes); plaintext redacted | `assert.ok(!token.includes('sess_123'));`<br>`assert.equal(token.length >= 40, true);`<br>`assert.match(token, /^[A-Za-z0-9_-]+$/);` |
| `T1-FEAT-F1-02` | EF2-A | AES-256-GCM Token Decryption Round-Trip & Claim Recovery | `src/server/session-token.test.ts` | Encrypted token, matching 32-byte key, `purpose: 'scm-session'`, `now` within window | Fully reconstituted `SessionTokenPayload` | `assert.deepEqual(decrypted, originalPayload);`<br>`assert.equal(decrypted.mode, 'demo');`<br>`assert.equal(decrypted.purpose, 'scm-session');` |
| `T1-FEAT-F1-03` | EF2-A | `SCM_SESSION_KEY` Production Key Resolution from Environment | `src/server/session-token.test.ts` | `env = { SCM_SESSION_KEY: base64url32Bytes, NODE_ENV: 'production' }` | 32-byte Buffer | `assert.equal(key.length, 32);`<br>`assert.equal(key[0], 0x42);` |
| `T1-FEAT-F1-04` | EF2-A | Ephemeral Key Generation Fallback in Dev/Test Environments | `src/server/session-token.test.ts` | `env = { SCM_SESSION_KEY: undefined, NODE_ENV: 'test' }` | 32-byte Buffer; does not throw | `assert.doesNotThrow(() => resolveSessionKey(env));`<br>`assert.equal(key.length, 32);` |
| `T1-FEAT-F1-05` | EF2-A | Purpose Isolation Binding (`'scm-session'` vs `'review-plan'`) | `src/server/session-token.test.ts` | Token encrypted with `purpose: 'review-plan'`; decrypt expecting `'scm-session'` | Returns `null` | `assert.equal(decryptToken(planToken, key, 'scm-session'), null);` |
| `T1-FEAT-F1-06` | EF2-A | Token Lifecycle Expiration Enforcement | `src/server/session-token.test.ts` | Token with `issuedAt: 1000, expiresAt: 5000`; decrypt with `now = 5001` | Returns `null` | `assert.equal(decryptToken(expiredToken, key, 'scm-session', 5001), null);` |
| `T1-FEAT-F2-01` | EF2-B | Cold-Start Rehydration of Demo Session from Encrypted Cookie | `src/server/session-token.test.ts` | Fresh Fastify instance; `GET /api/session` with `Cookie: __Host-scm=<valid-token>` | Status 200; `mode: 'demo'`; `login.status: 'connected'` | `assert.equal(res.statusCode, 200);`<br>`assert.equal(body.mode, 'demo');`<br>`assert.equal(body.login.status, 'connected');` |
| `T1-FEAT-F2-02` | EF2-B | Demo Driver Attachment & State Continuity Across Cold Instances | `src/server/session-token.test.ts` | Fresh Fastify instance; `GET /api/games` with demo cookie | Status 200; returns 3 demo games | `assert.equal(res.statusCode, 200);`<br>`assert.equal(body.games.length, 3);` |
| `T1-FEAT-F2-03` | EF2-B | Unauthenticated Session Initialization on Missing Cookie | `src/server/session-token.test.ts` | `GET /api/session` without cookie | Status 200; sets fresh encrypted cookie; `login.status: 'disconnected'` | `assert.equal(res.statusCode, 200);`<br>`assert.ok(res.headers['set-cookie']);`<br>`assert.equal(body.login.status, 'disconnected');` |
| `T1-FEAT-F2-04` | EF2-B | Corrupted Session Cookie Recovery without 500 Server Error | `src/server/session-token.test.ts` | `GET /api/session` with `Cookie: __Host-scm=malformed-junk` | Status 200; generates fresh disconnected session; overwrites cookie | `assert.equal(res.statusCode, 200);`<br>`assert.ok(res.headers['set-cookie']);`<br>`assert.equal(body.login.status, 'disconnected');` |
| `T1-FEAT-F2-05` | EF2-B | Protected API Guard on Cold Instance without Valid Session | `src/server/session-token.test.ts` | `GET /api/games` without cookie or with expired token on fresh instance | Status 401; error code `'SESSION_REQUIRED'` | `assert.equal(res.statusCode, 401);`<br>`assert.equal(body.error.code, 'SESSION_REQUIRED');` |
| `T1-FEAT-F3-01` | EF3 | Canonical Production Host and `*.vercel.app` Preview Host Acceptance | `src/server/security.test.ts` | Requests with `Host: steam-cloud-manager.vercel.app` and `Host: branch.vercel.app` | Requests accepted; headers evaluated without 403 | `assert.equal(resProd.statusCode, 200);`<br>`assert.equal(resPreview.statusCode, 200);` |
| `T1-FEAT-F3-02` | EF3 | Hostile Host Header Rejection | `src/server/security.test.ts` | Request with `Host: attacker.com` | Status 403; error code `'INVALID_HOST'` | `assert.equal(res.statusCode, 403);`<br>`assert.equal(body.error.code, 'INVALID_HOST');` |
| `T1-FEAT-F3-03` | EF3 | Exact Origin Header Enforcement for Mutations | `src/server/security.test.ts` | `POST /api/auth/demo` with canonical origin vs `Origin: https://evil.com` | Canonical passes (200); evil origin rejected with 403 | `assert.equal(resOk.statusCode, 200);`<br>`assert.equal(resEvil.statusCode, 403);`<br>`assert.equal(resEvilBody.error.code, 'INVALID_ORIGIN');` |
| `T1-FEAT-F3-04` | EF3 | `Sec-Fetch-Site: cross-site` Blocking on API Routes | `src/server/security.test.ts` | `POST /api/auth/demo` with `Sec-Fetch-Site: cross-site` | Status 403; error code `'CROSS_SITE_REQUEST'` | `assert.equal(res.statusCode, 403);`<br>`assert.equal(body.error.code, 'CROSS_SITE_REQUEST');` |
| `T1-FEAT-F3-05` | EF3 | Constant-Time CSRF Token Verification on Mutations | `src/server/security.test.ts` | `POST /api/auth/demo` with matching `x-csrf-token` vs mismatched token | Matching passes (200); mismatch returns 403 | `assert.equal(resValid.statusCode, 200);`<br>`assert.equal(resInvalid.statusCode, 403);`<br>`assert.equal(bodyInvalid.error.code, 'CSRF_FAILED');` |
| `T1-FEAT-F3-06` | EF3 | Security Response Headers & Cookie Flags in Production | `src/server/security.test.ts` | `GET /api/session` under production HTTPS config | Headers include HSTS, CSP, X-Frame-Options; cookie has `__Host-`, Strict, Secure, HttpOnly | `assert.match(res.headers['set-cookie'][0], /^__Host-scm=/);`<br>`assert.ok(res.headers['set-cookie'][0].includes('SameSite=Strict'));` |
| `T1-FEAT-F4-01` | EF4 | 1-Click Demo Mode Login (`POST /api/auth/demo`) | `src/server/demo-api.test.ts` | `POST /api/auth/demo` with valid CSRF token | Status 200; `mode: 'demo'`; `user.steamId: '76561198000000000'`; sets encrypted demo cookie | `assert.equal(res.statusCode, 200);`<br>`assert.equal(body.mode, 'demo');`<br>`assert.equal(body.login.user.steamId, '76561198000000000');` |
| `T1-FEAT-F4-02` | EF4 | Demo Library Listing (`GET /api/games`) | `src/server/demo-api.test.ts` | `GET /api/games` under demo session | Status 200; returns 3 games (AppIDs 949230, 1086940, 1245620) | `assert.equal(res.statusCode, 200);`<br>`assert.deepEqual(body.games.map(g => g.appId).sort(), [949230, 1086940, 1245620].sort());` |
| `T1-FEAT-F4-03` | EF4 | Demo File Listing & Single Save Streaming Download | `src/server/demo-api.test.ts` | `GET /api/games/949230/files` then `GET /download?name=Saves/Cedar%20Valley.cok` | Status 200; `Content-Type: application/octet-stream`; RFC 5987 disposition; mock bytes in body | `assert.equal(res.statusCode, 200);`<br>`assert.ok(res.headers['content-disposition'].includes('filename='));`<br>`assert.ok(res.body.includes('DEMO ONLY'));` |
| `T1-FEAT-F4-04` | EF4 | Demo ZIP Export Ticket Creation and Retrieval | `src/server/demo-api.test.ts` | `POST /api/games/949230/exports` then `GET /api/exports/<ticket>` | Export returns ticketId; GET returns 200, `Content-Type: application/zip`, body starts with `PK` | `assert.equal(resTicket.statusCode, 200);`<br>`assert.equal(resZip.statusCode, 200);`<br>`assert.equal(resZip.body.subarray(0, 2).toString(), 'PK');` |
| `T1-FEAT-F4-05` | EF4 | Two-Phase Deletion Confirmation in Demo Mode | `src/server/demo-api.test.ts` | `POST /delete-plan` with filename; `POST /delete` with planId & `'DELETE 1'` | Plan returns confirmation phrase; delete returns `{ deleted: [...], batchCompleted: true }` | `assert.equal(resPlan.statusCode, 200);`<br>`assert.equal(resDel.statusCode, 200);`<br>`assert.equal(resDelBody.batchCompleted, true);` |
| `T1-FEAT-F4-06` | EF4 | Demo Session Logout & Identity Cleanup (`POST /api/auth/logout`) | `src/server/demo-api.test.ts` | `POST /api/auth/logout` with valid CSRF token | Status 200; `mode: 'live'`; `login.status: 'disconnected'`; subsequent `/api/games` returns 401 | `assert.equal(res.statusCode, 200);`<br>`assert.equal(body.mode, 'live');`<br>`assert.equal(resGamesAfter.statusCode, 401);` |
| `T1-FEAT-F5-01` | EF5-A | Root Path `/` Direct Interactive React SPA Load | `tests/e2e/app.spec.ts` | Browser loads `/` | Page title "Steam Cloud Manager"; `#root` renders interactive app; 0 static clone/install text | `expect(page).toHaveTitle(/Steam Cloud Manager/);`<br>`expect(page.locator('#root')).toBeVisible();`<br>`expect(page.getByText('git clone')).toHaveCount(0);` |
| `T1-FEAT-F5-02` | EF5-A | Dual Login CTAs ("Sign in with Steam QR" and "Try Demo Mode") | `tests/e2e/app.spec.ts` | Initial visit to `/` | Dual CTA buttons visible; visual divider present | `expect(page.getByRole('button', { name: /Sign in with Steam/i })).toBeVisible();`<br>`expect(page.getByRole('button', { name: /Try Demo Mode/i })).toBeVisible();` |
| `T1-FEAT-F5-03` | EF5-A | Persistent In-App Demo Warning Banner with Sign Out CTA | `tests/e2e/app.spec.ts` | Click "Try Demo Mode" button | Yellow warning banner visible above library; contains "Sign Out" button | `expect(page.locator('.demo-banner')).toBeVisible();`<br>`expect(page.getByRole('button', { name: /Sign Out\|Выйти/i })).toBeVisible();` |
| `T1-FEAT-F5-04` | EF5-A | Header Demo Mode Badge Display | `tests/e2e/app.spec.ts` | Active demo session | Top navigation bar displays "DEMO MODE" / "ДЕМО-РЕЖИМ" badge | `expect(page.locator('.demo-badge')).toBeVisible();`<br>`expect(page.locator('.demo-badge')).toContainText(/DEMO\|ДЕМО/);` |
| `T1-FEAT-F5-05` | EF5-A | English and Russian Translation Parity for Web App | `tests/e2e/app.spec.ts` | Switch language selector between "en" and "ru" | All UI strings update cleanly; zero missing keys or raw placeholders | `expect(page.getByRole('heading', { name: /^Games\|^Игры/ })).toBeVisible();`<br>`expect(page.locator('html')).toHaveAttribute('lang', 'ru');` |
| `T1-FEAT-F6-01` | EF5-B | 1-Click Demo Mode Browser Login Journey | `tests/e2e/app.spec.ts` | Click "Try Demo Mode" in headless browser | Transitions to library; 3 game cards rendered | `await expect(page.locator('.game-card')).toHaveCount(3);`<br>`await expect(page.getByText('Cities: Skylines II')).toBeVisible();` |
| `T1-FEAT-F6-02` | EF5-B | Game Library Search and Client-Side Filtering | `tests/e2e/app.spec.ts` | Fill searchbox with `'Elden'` | 1 game card matches; `ELDEN RING` displayed | `await expect(page.locator('.game-card')).toHaveCount(1);`<br>`await expect(page.locator('.game-card').first()).toContainText('ELDEN RING');` |
| `T1-FEAT-F6-03` | EF5-B | Save File Table Inspection and Single Download Event | `tests/e2e/app.spec.ts` | Open `Cities: Skylines II`; click download icon | Browser receives download event; downloaded file size > 0 | `await expect(page.locator('tbody tr')).toHaveCount(6);`<br>`const download = await downloadPromise; expect(await download.path()).toBeTruthy();` |
| `T1-FEAT-F6-04` | EF5-B | Modal ZIP Backup Export and Archive Header Validation | `tests/e2e/app.spec.ts` | Click "Download ZIP"; click "Save prepared ZIP" | Browser downloads `.zip` file; magic bytes match `PK` | `const file = await download.path(); const bytes = await readFile(file); expect(bytes.subarray(0, 2).toString()).toBe('PK');` |
| `T1-FEAT-F6-05` | EF5-B | Two-Phase Deletion Confirmation Dialog Journey | `tests/e2e/app.spec.ts` | Check save checkbox; click Delete; type `DELETE 1`; click Delete permanently | Modal closes; table row count decreases by 1 | `await expect(dialog.getByRole('button', { name: /Delete permanently/i })).toBeDisabled();`<br>`await expect(page.locator('tbody tr')).toHaveCount(5);` |
| `T1-FEAT-F6-06` | EF5-B | Browser Sign-Out Journey Returning to Dual-CTA Screen | `tests/e2e/app.spec.ts` | Click "Sign Out" in demo warning banner | Session cleared; returns to initial dual-CTA screen | `await expect(page.getByRole('button', { name: /Try Demo Mode/i })).toBeVisible();`<br>`await expect(page.locator('.game-card')).toHaveCount(0);` |

---

### 7.2 Tier 2: Boundary & Corner Cases (37 Test Cases)

*Target: >= 5 per feature covering edge cases, bit-flipping, malformed inputs, limit testing, and anomalous environments.*

| Test ID | Feature | Test Name | Target File | Inputs / Setup | Observable Behavior | Exact Assertions |
|---|---|---|---|---|---|---|
| `T2-BOUND-F1-01` | EF2-A | Single-Bit Ciphertext Flipping Triggers Auth Tag Rejection | `src/server/session-token.test.ts` | Flip 1 bit in ciphertext section of valid token | Decipher fails; caught safely; returns `null` | `assert.equal(decryptToken(flippedToken, key, 'scm-session'), null);` |
| `T2-BOUND-F1-02` | EF2-A | Single-Bit IV and Auth Tag Modification Rejection | `src/server/session-token.test.ts` | Flip 1 bit in IV (bytes 0–11) or Auth Tag (bytes 12–27) | GCM tag verification fails; returns `null` | `assert.equal(decryptToken(badIvToken, key, 'scm-session'), null);`<br>`assert.equal(decryptToken(badTagToken, key, 'scm-session'), null);` |
| `T2-BOUND-F1-03` | EF2-A | Future-Issued Token Clock Skew Boundary (`issuedAt > now + 5000`) | `src/server/session-token.test.ts` | Token with `issuedAt = now + 5001` | Clock skew rejected; returns `null` | `assert.equal(decryptToken(futureToken, key, 'scm-session', now), null);` |
| `T2-BOUND-F1-04` | EF2-A | Exact Expiration Boundary (`now === expiresAt` vs `expiresAt - 1`) | `src/server/session-token.test.ts` | Token with `expiresAt = 10000`; test at 9999, 10000, 10001 | 9999 succeeds; 10000 & 10001 return `null` | `assert.ok(decryptToken(token, key, 'scm-session', 9999));`<br>`assert.equal(decryptToken(token, key, 'scm-session', 10000), null);` |
| `T2-BOUND-F1-05` | EF2-A | Inverted Timestamps Rejection (`expiresAt <= issuedAt`) | `src/server/session-token.test.ts` | Encrypt token with `issuedAt = 1000, expiresAt = 1000` | Throws Error `'Invalid encryption key or expiry'` | `assert.throws(() => encryptToken({ purpose: 'scm-session', issuedAt: 1000, expiresAt: 1000 }, key));` |
| `T2-BOUND-F1-06` | EF2-A | Maximum Token Size Denial-of-Service Boundary (`MAX_TOKEN_BYTES = 16384`) | `src/server/session-token.test.ts` | Token string > 32768 chars | Aborts before parsing; returns `null` | `assert.equal(decryptToken('A'.repeat(33000), key, 'scm-session'), null);` |
| `T2-BOUND-F2-01` | EF2-B | Rapid Sequential Invocations Across Distinct Memory Instances | `src/server/session-token.test.ts` | 10 requests routed to brand new Fastify instances with same cookie | All 10 succeed (200 OK); state consistent | `assert.equal(results.every(r => r.statusCode === 200), true);` |
| `T2-BOUND-F2-02` | EF2-B | Expired Cookie on Cold Start Reverts to Fresh Idle Session | `src/server/session-token.test.ts` | Cold instance receives expired cookie (`expiresAt < now`) | Returns 200 on `/api/session`; fresh `Set-Cookie` replacement | `assert.equal(res.statusCode, 200);`<br>`assert.equal(body.login.status, 'disconnected');`<br>`assert.notEqual(res.headers['set-cookie'], oldCookie);` |
| `T2-BOUND-F2-03` | EF2-B | Rehydration with Unknown or Malformed Mode in Payload | `src/server/session-token.test.ts` | Token encrypted with `mode: 'malicious'` | Rejected; falls back to unauthenticated session | `assert.equal(body.mode, 'live');`<br>`assert.equal(body.login.status, 'disconnected');` |
| `T2-BOUND-F2-04` | EF2-B | Multi-Instance Delete Plan Expiration Boundary Across Cold Instances | `src/server/session-token.test.ts` | Plan on Instance A (`expiresAt = now + 300_000`); Instance B executes at `now + 300_001` | Instance B returns 409 `'PLAN_EXPIRED'` | `assert.equal(res.statusCode, 409);`<br>`assert.equal(body.error.code, 'PLAN_EXPIRED');` |
| `T2-BOUND-F2-05` | EF2-B | Cold-Start Rehydration Preserves CSRF Token Parity | `src/server/session-token.test.ts` | Request `POST /api/auth/demo` with `x-csrf-token` matching decrypted cookie CSRF | Matching passes (200); 1 char mismatch returns 403 | `assert.equal(resValid.statusCode, 200);`<br>`assert.equal(resMismatch.statusCode, 403);` |
| `T2-BOUND-F3-01` | EF3 | Wildcard `*.vercel.app` Subdomain Boundary Checks | `src/server/security.test.ts` | `Host: preview-1.vercel.app` (valid) vs `Host: evil.vercel.app.attacker.com` | Valid passes (200); suffix spoof rejected (403) | `assert.equal(resPreview.statusCode, 200);`<br>`assert.equal(resSpoof.statusCode, 403);` |
| `T2-BOUND-F3-02` | EF3 | Case-Insensitivity of Host and Origin Headers | `src/server/security.test.ts` | `Host: STEAM-CLOUD-MANAGER.VERCEL.APP` | Normalized to lowercase; returns 200 | `assert.equal(res.statusCode, 200);` |
| `T2-BOUND-F3-03` | EF3 | Origin with Port, Username, Search, or Trailing Path Rejection | `src/server/security.test.ts` | `Origin: https://steam-cloud-manager.vercel.app/subpath` | Mismatch detected; returns 403 `'INVALID_ORIGIN'` | `assert.equal(resPath.statusCode, 403);` |
| `T2-BOUND-F3-04` | EF3 | `Sec-Fetch-Site` Values (`same-origin`, `same-site`, `none`, `cross-site`) | `src/server/security.test.ts` | Probe with 4 distinct `Sec-Fetch-Site` values | `cross-site` returns 403; others pass | `assert.equal(resCrossSite.statusCode, 403);`<br>`assert.equal(resSameOrigin.statusCode, 200);` |
| `T2-BOUND-F3-05` | EF3 | Empty and Whitespace-Only CSRF Header Rejection | `src/server/security.test.ts` | `POST /api/auth/demo` with `x-csrf-token: ""` and `"   "` | Both rejected with 403 `'CSRF_FAILED'` | `assert.equal(resEmpty.statusCode, 403);`<br>`assert.equal(resWhitespace.statusCode, 403);` |
| `T2-BOUND-F3-06` | EF3 | SSRF IP Boundary Checks for Cloud Storage (Forbidden Subnets) | `src/server/security.test.ts` | Storage URL resolving to `169.254.169.254` or `127.0.0.1` | Resolved IP rejected; connection aborted | `assert.rejects(async () => resolveStorageAddress('169.254.169.254'));` |
| `T2-BOUND-F3-07` | EF3 | Fastify Request Body Limit Defense (Oversized JSON Payload Rejection) | `src/server/security.test.ts` | Send mutation (`POST /api/auth/demo`) with body > 3 MiB (`bodyLimit: 3 * 1024 * 1024`) | Fastify terminates parsing; returns 413 `Payload Too Large` | `assert.equal(resOversized.statusCode, 413);`<br>`assert.match(resOversizedBody.error \|\| resOversizedBody.message, /Payload Too Large\|body too large/i);` |
| `T2-BOUND-F4-01` | EF4 | Rapid Repeated Clicks to `POST /api/auth/demo` (Idempotence) | `src/server/demo-api.test.ts` | 5 simultaneous `POST /api/auth/demo` requests | All 5 return 200 OK; mode remains `'demo'` | `assert.equal(responses.every(r => r.statusCode === 200), true);` |
| `T2-BOUND-F4-02` | EF4 | Selection Limit Cap for ZIP Export and Deletion (500 Files Boundary) | `src/server/demo-api.test.ts` | `POST /delete-plan` with array of 501 file names | Validation error 400 | `assert.equal(res.statusCode, 400);` |
| `T2-BOUND-F4-03` | EF4 | Deletion Replay Prevention (Double Delete Attempt) | `src/server/demo-api.test.ts` | Call `POST /delete` with `planId`; immediately repeat with same `planId` | 1st returns 200; 2nd returns 409 `'PLAN_EXPIRED'` | `assert.equal(res1.statusCode, 200);`<br>`assert.equal(res2.statusCode, 409);`<br>`assert.equal(body2.error.code, 'PLAN_EXPIRED');` |
| `T2-BOUND-F4-04` | EF4 | Exact Confirmation Phrase Matching (`DELETE 1` vs `delete 1`) | `src/server/demo-api.test.ts` | Plan expects `'DELETE 1'`; send `'delete 1'` or `'DELETE 2'` | Returns 400 `'CONFIRMATION_MISMATCH'` | `assert.equal(resLower.statusCode, 400);`<br>`assert.equal(resWrongCount.statusCode, 400);` |
| `T2-BOUND-F4-05` | EF4 | Download File Traversal and Special Characters in File Name | `src/server/demo-api.test.ts` | `GET /download?name=../../etc/passwd` | Returns 404 `'FILE_NOT_FOUND'`; zero traversal | `assert.equal(resTraversal.statusCode, 404);` |
| `T2-BOUND-F4-06` | EF4 | Concurrency Cap: Max 2 Active Downloads per Session | `src/server/demo-api.test.ts` | Trigger 3 concurrent downloads in same session | First 2 stream; 3rd returns 429 `'DOWNLOAD_LIMIT'` | `assert.equal(res3.statusCode, 429);`<br>`assert.equal(body3.error.code, 'DOWNLOAD_LIMIT');` |
| `T2-BOUND-F4-07` | EF4 | Empty Selection Array Rejection (`names: []` Boundary) | `src/server/demo-api.test.ts` | `POST /api/games/:appId/exports` and `/delete-plan` with `{ names: [], revision }` | Rejected with 400 Bad Request; zero ticket or plan generated | `assert.equal(resExport.statusCode, 400);`<br>`assert.equal(resPlan.statusCode, 400);` |
| `T2-BOUND-F4-08` | EF4 | Zero-Byte Cloud Save Streaming Download & SHA-1 Verification | `src/server/demo-api.test.ts` | `GET /api/games/:appId/download` for save with `size: 0` and empty SHA-1 (`da39a3ee...`) | Status 200; `Content-Length: 0`; body length 0; SHA-1 verified cleanly | `assert.equal(res.statusCode, 200);`<br>`assert.equal(res.headers['content-length'], '0');`<br>`assert.equal(res.rawPayload.length, 0);`<br>`assert.equal(createHash('sha1').update(res.rawPayload).digest('hex'), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');` |
| `T2-BOUND-F5-01` | EF5-A | Rapid Double-Click on "Try Demo Mode" Button | `tests/e2e/app.spec.ts` | Fast double-click on demo CTA | Button debounces; single login request fired | `await expect(page.locator('.game-card')).toHaveCount(3);`<br>`await expect(page.locator('.alert-error')).toHaveCount(0);` |
| `T2-BOUND-F5-02` | EF5-A | Steam QR Login Pending Cancellation Return to Idle Login | `tests/e2e/app.spec.ts` | Click "Sign in with Steam QR"; click "Cancel" | Polling cancelled; returns to idle dual-action card | `await page.getByRole('button', { name: /Cancel\|Отмена/i }).click();`<br>`await expect(page.getByRole('button', { name: /Try Demo Mode/i })).toBeVisible();` |
| `T2-BOUND-F5-03` | EF5-A | Extreme Viewport Resizing (320px to 4K Ultrawide) | `tests/e2e/app.spec.ts` | Resize viewport from 320x568 to 3840x2160 | No horizontal scroll in either resolution | `expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);` |
| `T2-BOUND-F5-04` | EF5-A | LocalStorage Quota Exceeded / Disabled Handling | `tests/e2e/app.spec.ts` | Mock `localStorage.setItem` to throw `QuotaExceededError` | UI updates in React state without JS crash | `await expect(page.locator('.game-card')).toHaveCount(3);` |
| `T2-BOUND-F5-05` | EF5-A | Unicode & Cyrillic Search Query Boundary | `tests/e2e/app.spec.ts` | Fill searchbox with Cyrillic `"Город"` or emoji `"🎮"` | No crash; zero matches; displays localized empty message | `await expect(page.getByText(/No games found\|Игры не найдены/i)).toBeVisible();` |
| `T2-BOUND-F6-01` | EF5-B | Browser Navigation (Back / Forward) Across Demo and Detail Views | `tests/e2e/app.spec.ts` | In demo mode, open game, click browser Back, then Forward | Back returns to grid; Forward returns to file list | `await page.goBack();`<br>`await expect(page.locator('.game-card')).toHaveCount(3);`<br>`await page.goForward();`<br>`await expect(page.locator('tbody tr')).toHaveCount(6);` |
| `T2-BOUND-F6-02` | EF5-B | Browser Hard Refresh (`Ctrl+F5`) During Active Demo Session | `tests/e2e/app.spec.ts` | Trigger `page.reload()` inside game view | Session cookie rehydrates; user stays in game view | `await page.reload();`<br>`await expect(page.locator('.demo-banner')).toBeVisible();`<br>`await expect(page.locator('.game-card')).toHaveCount(3);` |
| `T2-BOUND-F6-03` | EF5-B | Mobile Viewport (390x844) Touch Target & Dialog Usability | `tests/e2e/app.spec.ts` | Set viewport to 390x844; open deletion dialog | Dialog fits within viewport; buttons >=44px clickable | `await expect(page.getByRole('dialog')).toBeVisible();`<br>`expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);` |
| `T2-BOUND-F6-04` | EF5-B | Keyboard Accessibility & Focus Management in Security Dialogs | `tests/e2e/app.spec.ts` | Open security modal; press Tab; press Escape | Focus trapped inside modal; Escape closes modal | `await page.keyboard.press('Escape');`<br>`await expect(page.getByRole('dialog')).toHaveCount(0);` |
| `T2-BOUND-F6-05` | EF5-B | `BASE_URL` Hosted Target Execution Resilience | `tests/e2e/app.spec.ts` | Run test with `BASE_URL=https://steam-cloud-manager.vercel.app` | Verifies live TLS, HTTPS headers, and interactive DOM | `expect(response.status()).toBe(200);`<br>`expect(response.securityDetails().protocol).toMatch(/TLS/);` |
| `T2-BOUND-F6-06` | EF5-B | Network Disconnect / Offline Simulation During Save Download | `tests/e2e/app.spec.ts` | Trigger download; set `page.context().setOffline(true)` | UI displays actionable error toast; stays responsive | `await expect(page.locator('.alert, [role="alert"]')).toBeVisible();` |

---

### 7.3 Tier 3: Pairwise Cross-Feature Combinations (15 Test Cases)

*Target: Pairwise coverage across Cryptography (F1), Cold-Start (F2), Origin Security (F3), Demo API (F4), Client UX (F5), and Browser E2E (F6).*

| Test ID | Features | Interaction Scenario | Setup / Inputs | Expected Output & Assertions |
|---|---|---|---|---|
| `T3-COMB-01` | EF2-A + EF2-B | Encrypted Token + Cold Start Rehydration | Encrypt demo token with ephemeral key; pass to fresh Fastify instance with empty memory | Session rehydrates with matching `sessionId` and `csrfToken`;<br>`assert.equal(rehydrated.id, original.id);` |
| `T3-COMB-02` | EF2-A + EF3 | Encrypted Token + CSRF / Origin Guard | Send valid encrypted token with mismatched `Origin` or bad `x-csrf-token` | Guard rejects before mutating;<br>`assert.equal(resBadOrigin.statusCode, 403);`<br>`assert.equal(resBadOriginBody.error.code, 'INVALID_ORIGIN');` |
| `T3-COMB-03` | EF2-A + EF4 | Encrypted Token + Demo Mode Lifecycle | Call `POST /api/auth/demo`; inspect emitted `Set-Cookie` | Emitted cookie contains valid AES-256-GCM token with `mode: 'demo'`;<br>`assert.equal(decrypted.mode, 'demo');` |
| `T3-COMB-04` | EF2-B + EF3 | Cold Start Rehydration + Sec-Fetch-Site Guard | Cold instance receives valid cookie but `Sec-Fetch-Site: cross-site` header | Blocked with 403 before executing rehydration;<br>`assert.equal(res.statusCode, 403);` |
| `T3-COMB-05` | EF2-B + EF4 | Cold Start Rehydration + Demo Deletion Revision Lock | Plan delete on Instance A (revision `rev_1`); change save revision; execute delete on Instance B | Instance B catches revision mismatch; returns 409;<br>`assert.equal(res.statusCode, 409);` |
| `T3-COMB-06` | EF3 + EF4 | Hosted Vercel Origin + Demo Mode API Operations | Run full demo API flow with `Origin: https://steam-cloud-manager.vercel.app` | All operations succeed;<br>`assert.equal(gamesRes.statusCode, 200);`<br>`assert.equal(exportRes.statusCode, 200);` |
| `T3-COMB-07` | EF3 + EF5-A | Host Header Verification + Client SPA Direct Load | Load SPA at `/` with canonical host and preview host | Both return 200 with CSP `connect-src 'self'`;<br>`assert.ok(csp.includes("connect-src 'self'"));` |
| `T3-COMB-08` | EF4 + EF5-A | 1-Click Demo API + UI Demo Banner & Sign Out | Click "Try Demo Mode" in UI; observe banner; click "Sign Out" | Banner appears on login; disappears on logout;<br>`await expect(page.locator('.demo-banner')).toBeVisible();` |
| `T3-COMB-09` | EF4 + EF5-B | Demo Mode API + Browser E2E Download & Deletion | Download save from UI, then delete second save via confirmation modal | Download valid; row deleted from DOM;<br>`expect(downloadBytes.length).toBeGreaterThan(0);` |
| `T3-COMB-10` | EF5-A + EF5-B | Dual-CTA UI + Browser Search & Favorites Persistence | Favorite `ELDEN RING`; reload browser | `ELDEN RING` remains sorted first; `localStorage` contains `scm:favorites:76561198000000000` |
| `T3-COMB-11` | EF2-A + EF5-B | Token Expiration + Browser Graceful Session Recovery | Expire session token; click game card in browser | 401 intercepted; UI prompts session renewal;<br>`await expect(page.getByRole('button', { name: /Try Demo Mode/i })).toBeVisible();` |
| `T3-COMB-12` | EF2-B + EF5-B | Cold Start Mid-Journey + Browser ZIP Export & Download | Trigger export; simulate cold restart before clicking "Save prepared ZIP" | Cold instance streams ZIP without session loss;<br>`const file = await download.path(); expect(file).toBeTruthy();` |
| `T3-COMB-13` | EF3 + EF5-B | Live `BASE_URL` + Browser Playwright Session Navigation | Run browser test suite against remote `https://steam-cloud-manager.vercel.app` | Navigates live URL; cards render;<br>`expect(page.url()).toContain('vercel.app');` |
| `T3-COMB-14` | EF4 + EF2-B + EF3 | Demo Mode Multi-Tab Cold Start under Strict Origin | Open 2 tabs in demo mode; delete save in Tab 1; try exporting it in Tab 2 | Tab 2 receives clean 409 error toast;<br>`await expect(tab2.locator('.alert-error')).toBeVisible();` |
| `T3-COMB-15` | EF5-A + EF5-B + EF3 | Mobile Viewport + Live Origin + Theme/Locale Override | Mobile viewport (390x844); switch to Russian (`ru`) and dark theme | Dark mode applied; Cyrillic rendered; zero horizontal scroll;<br>`await expect(page.locator('html')).toHaveAttribute('lang', 'ru');` |

---

### 7.4 Tier 4: Real-World Application Scenarios (6 Complete Application Journeys)

*Target: >= 5 realistic end-to-end multi-step user workflows executed in Playwright.*

#### Scenario 1 (`T4-SCEN-01`): First-Time Visitor 1-Click Demo Exploration & Live ZIP Backup
- **Target Persona**: New visitor evaluating the manager without logging into Steam.
- **Workflow Steps**:
  1. Opens `https://steam-cloud-manager.vercel.app/` on a fresh browser profile.
  2. Verifies interactive start screen loads directly at `/` (zero install instructions, zero `git clone`).
  3. Observes dual-CTA login card ("Sign in with Steam QR" and "Try Demo Mode").
  4. Clicks "Try Demo Mode"; backend fires `POST /api/auth/demo` and sets encrypted cookie.
  5. React UI renders game library with yellow warning banner and header demo badge.
  6. Searches for "Cities"; opens `Cities: Skylines II`.
  7. Selects 2 saves; clicks "Download ZIP"; modal prepares archive; clicks "Save prepared ZIP".
  8. Browser downloads valid `.zip` file with `PK` magic bytes containing demo saves.
  9. Clicks "Sign Out" in warning banner; session cleanly destroyed; returns to login card.
- **Key Assertions**: Clean zero-install load; valid ZIP archive; complete session teardown.

#### Scenario 2 (`T4-SCEN-02`): Two-Phase Deletion Safety Workflow with Backup & Revision Collision
- **Target Persona**: Player cleaning up cloud saves while protecting against accidental deletion.
- **Workflow Steps**:
  1. User logs into demo mode and opens `ELDEN RING` saves.
  2. Selects `ER0000.sl2`; clicks Delete button; deletion security modal opens.
  3. Modal disables "Delete permanently" button until confirmation is met.
  4. User clicks "Download ZIP" inside modal to create a pre-deletion backup.
  5. User enters confirmation phrase `DELETE 1`; "Delete permanently" button enables.
  6. Background process simulates save revision change (e.g. cloud sync collision).
  7. User clicks "Delete permanently"; server detects revision mismatch; returns 409 `'PLAN_EXPIRED'`.
  8. Modal displays warning indicating files were modified and refuses to delete blindly.
- **Key Assertions**: Optimistic concurrency lock protects saves; no blind deletion on revision mismatch.

#### Scenario 3 (`T4-SCEN-03`): Serverless Cold-Instance Recovery During Multi-Step Save Management
- **Target Persona**: User interacting with the application across distributed Vercel serverless invocations.
- **Workflow Steps**:
  1. Step 1: User logs into demo mode on serverless Function Instance 1 (`POST /api/auth/demo`).
  2. Step 2: User lists games on Function Instance 2 (simulating a cold start with zero shared memory).
  3. Step 3: User inspects files on Function Instance 3 (simulating cold start).
  4. Step 4: User creates delete plan on Function Instance 4 (simulating cold start).
  5. Step 5: User confirms deletion on Function Instance 5 (simulating cold start).
  6. Verifies all 5 steps succeed without session dropouts, 401 errors, or data loss.
- **Key Assertions**: 100% stateless rehydration across memory boundaries using AES-256-GCM cookies.

#### Scenario 4 (`T4-SCEN-04`): Cross-Site Attack & Host Header Injection Deflection
- **Target Persona**: Adversary attempting CSRF, host spoofing, and iframe clickjacking.
- **Workflow Steps**:
  1. Attacker embeds application in malicious `<iframe>`; browser blocks load due to `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`.
  2. Attacker script triggers `fetch('/api/auth/demo', { method: 'POST' })` with `Sec-Fetch-Site: cross-site`; blocked with 403 `CROSS_SITE_REQUEST`.
  3. Attacker sends mutation with spoofed `Host: attacker.com`; blocked with 403 `INVALID_HOST`.
  4. Attacker attempts request without CSRF token; blocked with 403 `CSRF_FAILED`.
  5. Attacker attempts bit-flipping on session cookie; decipher verification fails; returns `null`.
- **Key Assertions**: Complete defense-in-depth protection across all serverless attack surfaces.

#### Scenario 5 (`T4-SCEN-05`): Dual-Locale, Dual-Theme Switching and Offline/Network Glitch Resilience
- **Target Persona**: International user experiencing intermittent network connectivity.
- **Workflow Steps**:
  1. Russian user switches interface language to `ru`; verifies all headings, buttons, and deletion confirmation phrases (`УДАЛИТЬ 1`) update.
  2. Switches theme to Dark Mode; verifies data attributes and dark palette render immediately.
  3. Reloads page; verifies language and theme persist via `localStorage`.
  4. Initiates download of save file while browser network offline mode is toggled on.
  5. Client catches network interruption and displays accessible error banner.
  6. Toggles network back online; clicks retry; download streams to completion.
- **Key Assertions**: 100% Russian/English translation parity; error resilience on network glitch.

#### Scenario 6 (`T4-SCEN-06`): Full Mobile Journey from Demo Login to Backup Export on Low-Res Screen
- **Target Persona**: Mobile phone user managing saves on the go.
- **Workflow Steps**:
  1. User navigates to web app on iPhone/Pixel viewport (390x844).
  2. Verifies responsive single-column layout; zero horizontal overflow (`scrollWidth <= innerWidth`).
  3. Clicks "Try Demo Mode"; library cards stack neatly with >=44px touch targets.
  4. Uses search filter; opens `Baldur's Gate 3`.
  5. Selects save; opens deletion dialog; verifies dialog fits within mobile viewport.
  6. Downloads ZIP backup directly to device storage.
  7. Closes dialog and signs out smoothly.
- **Key Assertions**: Strict viewport constraint compliance; touch accessibility; zero layout overflow.

---

## 8. Coverage Thresholds & Quality Gate Pass/Fail Criteria

### 8.1 Minimum Required Test Counts by Category

| Category | Component / Milestone | Tier 1 Tests | Tier 2 Tests | Tier 3 Tests | Tier 4 Tests | Total Tests |
|---|---|---|---|---|---|---|
| **Cryptographic Tokens (EF2-A)** | `session-token.test.ts` (E2) | 6 | 6 | 3 | — | **15** |
| **Cold Start Rehydration (EF2-B)** | `session-token.test.ts` (E2) | 5 | 5 | 3 | — | **13** |
| **Serverless Security (EF3)** | `security.test.ts` (E2) | 6 | 7 | 3 | — | **16** |
| **Demo Mode API (EF4)** | `demo-api.test.ts` (E3) | 6 | 8 | 3 | — | **17** |
| **Web Client UX (EF5-A)** | `app.spec.ts` (E4) | 5 | 5 | 2 | — | **12** |
| **Browser E2E Journeys (EF5-B)** | `app.spec.ts` (E4) | 6 | 6 | 1 | 6 | **19** |
| **Subtotal (New Test Suites)** | | **34** | **37** | **15** | **6** | **92** |
| **Retained Steam & Server Suites** | Protocol & steam drivers | — | — | — | — | **>= 65** |
| **Grand Total (Full Project Suite)**| | | | | | **>= 157** |

### 8.2 Code Coverage Target Thresholds

| Source File | Function / Scope | Statement Coverage | Branch Coverage | Function Coverage |
|---|---|---|---|---|
| `src/server/session-token.ts` | AES-256-GCM token encryption & key derivation | **>= 95%** | **>= 95%** | **100%** |
| `src/server/sessions.ts` | Session store & cold-start recovery | **>= 90%** | **>= 90%** | **>= 95%** |
| `src/server/app.ts` | Security hooks & Demo routes (`POST /api/auth/demo`) | **>= 90%** | **>= 90%** | **>= 90%** |
| `src/server/demo-driver.ts` | Offline mock cloud driver | **>= 95%** | **>= 95%** | **100%** |
| `src/server/config.ts` | Origin & host derivation | **>= 90%** | **>= 90%** | **100%** |

### 8.3 Quality Gate Checklist (Required for Milestone E5)

Before Milestone E5 can publish `TEST_READY.md`:
- [ ] **100% Pass Rate**: Every test in Tiers 1 through 4 passes with zero failures (`fail === 0`).
- [ ] **Zero Skipped Tests**: `skip === 0`. No tests bypassed via `test.skip` or `test.todo`.
- [ ] **Zero Flakiness**: Retries = 0 locally; in CI retries = 1 permitted only for live URL network latency.
- [ ] **Clean Typecheck**: `npm run typecheck` exits with code 0 (`tsc --noEmit` and E2E `tsconfig.json`).
- [ ] **Clean Production Build**: `npm run build` compiles without warnings or errors.
- [ ] **Zero Leaked Secrets**: No session secrets, API tokens, or Steam credentials in logs, source code, or git diffs.
- [ ] **Live Target Verification**: Playwright tests pass against `BASE_URL=https://steam-cloud-manager.vercel.app` (Tier 4 scenario 5).

---

## 9. Test Invalidation Conditions

The test suite must be invalidated and re-executed under any of the following triggers:
1. `SCM_SESSION_KEY` is rotated or modified in the deployment environment.
2. Node.js runtime engine is upgraded or altered (target: Node >=22.12).
3. Fastify or Playwright package minor/major dependency versions are upgraded.
4. Steam Cloud API contracts or PICS metadata protobuf definitions are changed.
5. Vercel deployment URL or routing rewrites in `vercel.json` are modified.
6. Encryption token payload schema (`SessionTokenPayload`) is altered or version bumped.
