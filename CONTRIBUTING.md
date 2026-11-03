# Contributing

Use Node.js 22.12 or newer. Install with `npm ci --ignore-scripts` and run `npm run check`. For browser tests, run `npm run test:browser:install` followed by `npm run test:e2e`. Tests run against isolated demo data, never a personal Steam account.

Use `npm run dev` for the local application. Use `npm run build:public` and `node scripts/preview-public.mjs` to preview the static site at `http://127.0.0.1:3111`.

Keep English and Russian message keys aligned. UI text should describe an action or state rather than use slogans. Respect keyboard navigation, reduced-motion settings and system theme selection. New library behavior needs tests for unknown/error states, not just success fixtures.

Preserve the local/public boundary. Do not add authentication proxies, browser token persistence, third-party scripts or telemetry to the public build. Do not relax storage URL validation to fix a download without adding precise allowlist tests. Treat protocol changes as compatibility-sensitive and test failure cases.

Submit focused pull requests with the behavior changed and the checks you ran. Never attach a real Steam session, QR code, signed file URL or private save. Read SECURITY.md for vulnerability reporting.
