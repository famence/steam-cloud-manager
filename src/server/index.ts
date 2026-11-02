import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { readConfig } from './config.js';
import { buildApp } from './app.js';

if (existsSync('.env')) loadEnvFile('.env');
const config = readConfig();
const app = await buildApp({ config, serveStatic: config.production, logger: true });
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ mode: config.demoMode ? 'DEMO' : 'LIVE', origin: config.appOrigin }, 'Steam Cloud Manager ready');
} catch {
  app.log.error('Could not start server. Check HOST, PORT and APP_ORIGIN.');
  await app.close(); process.exitCode = 1;
}
