import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
process.env.NODE_ENV = 'production';
const address = process.env.HOST === '::1' ? '[::1]' : '127.0.0.1';
process.env.APP_ORIGIN = `http://${address}:${process.env.PORT || 3000}`;
if (!existsSync('dist/server/server/index.js')) throw new Error('Run npm run build before npm start');
await import('../dist/server/server/index.js');
