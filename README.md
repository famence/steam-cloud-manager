# Steam Cloud Manager

[Русский](README.ru.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

**Live Web Application**: [https://steam-cloud-manager.vercel.app/](https://steam-cloud-manager.vercel.app/)

Browse, back up and delete Steam Cloud saves directly in your web browser with zero installation. Includes a 1-click interactive Demo Mode, official Steam Guard QR sign-in, AES-256-GCM encrypted sessions, light/dark themes, and full Russian & English localization.

## Highlights

- **Zero Download & Zero Install**: Full-stack web application hosted on Vercel at [https://steam-cloud-manager.vercel.app/](https://steam-cloud-manager.vercel.app/). Works out of the box in any modern browser on desktop and mobile.
- **1-Click Interactive Demo Mode**: Explore the full manager with realistic mock saves (`Cities: Skylines II`, `ELDEN RING`, `Baldur's Gate 3`) without signing into Steam. Test browsing saves, downloading files, ZIP exports, and safe two-phase deletion.
- **Official Steam Guard QR Sign-In**: Scan the QR code using the official Steam Mobile App to connect securely via the serverless Fluid Compute backend.
- **End-to-End Encrypted Sessions**: Session state is sealed with `AES-256-GCM` authenticated encryption in secure, `HttpOnly`, `SameSite=Strict` cookies. State survives serverless cold instances without shared database dependencies.
- **Strict Security Perimeter**: DNS-pinned SSRF prevention for Steam Cloud CDN downloads, streaming SHA-1 integrity verification, cryptographic CSRF tokens, and strict origin validation.
- **Bilingual & Themes**: Full English and Russian localization with automatic system and manual light/dark theme switching.

## Live Application UX

Opening [https://steam-cloud-manager.vercel.app/](https://steam-cloud-manager.vercel.app/) immediately loads the interactive web application:

1. **Sign in with Steam QR**: Generates an encrypted Steam Guard QR code. Confirm the sign-in in your Steam Mobile App to manage your personal cloud saves.
2. **Try Demo Mode**: Click the demo button to enter a sandboxed interactive demo session instantly with simulated cloud saves. A persistent status banner indicates active demo mode, and clicking "Sign out" returns cleanly to the login card.

## Library & Cloud Save Features

The manager provides a comprehensive set of cloud management capabilities:

- **Game Library**: Lists all games in your Steam library with lazy card rendering and high-res cover art from Steam's CDN. Unclassified games can be opened manually via AppID or Steam store URL.
- **Favorites**: Stored locally in your browser per account, keeping your most played games at the top.
- **Save File Inspection**: Inspect cloud files, file sizes, and modification timestamps for any supported game.
- **Direct & ZIP Downloads**: Download individual save files or select multiple files for single-click ZIP archive backup. Streams directly to your disk.
- **Safe Two-Phase Deletion**: Destructive deletion requires explicit file selection, closing active games/GeForce NOW, re-verifying cloud revisions, and typing an exact confirmation phrase.

## Architecture

The application is deployed on Vercel as a unified full-stack architecture:

- **Frontend**: React 18 + Vite SPA (`src/client/App.tsx`), precompiled into `dist/client` and served directly at `/`.
- **Backend**: Node.js Fastify application adapted for Vercel Functions (`api/index.ts`) using Vercel Fluid Compute (300s `maxDuration`).
- **Stateless Session Tokens**: `AES-256-GCM` encrypted cookies (`SCM_SESSION_KEY`) encapsulate session identity, CSRF tokens, mode (`live` vs `demo`), and credentials for seamless cold-instance recovery.
- **GitHub Pages**: [https://famence.github.io/steam-cloud-manager/](https://famence.github.io/steam-cloud-manager/) automatically redirects visitors to the live production web app.

## Local Development & Contributing

Contributors and developers can run the stack locally:

```sh
git clone https://github.com/famence/steam-cloud-manager.git
cd steam-cloud-manager
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite development server proxies API requests to the Fastify backend on `http://127.0.0.1:3000`.

To run tests and builds:

```sh
npm run check              # Typecheck, test suite, and production builds
npm run test:browser:install # Install Chromium for Playwright E2E
npm run test:e2e           # Run headless Playwright E2E tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) for contribution guidelines and security disclosures.

## License

MIT © [famence](https://github.com/famence)
