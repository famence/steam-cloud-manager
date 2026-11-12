import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve('dist/public');
let headers = {};
try {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  headers = Object.fromEntries(config.headers[0].headers.map(entry => [entry.key, entry.value]));
} catch {
  headers = {};
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

export function resolvePreviewPrefixes(basePath = process.env.BASE_PATH) {
  const rawBase = (basePath || '').trim();
  const cleaned = rawBase.replace(/^\/+|\/+$/g, '');
  const normalizedBase = cleaned ? `/${cleaned}` : '';
  return Array.from(new Set([normalizedBase, '/steam-cloud-manager'])).filter(p => Boolean(p) && p !== '/');
}

const port = Number(process.env.PUBLIC_PORT || 3111);

export function createPreviewServer(serverPort = port, targetRoot = root) {
  const prefixes = resolvePreviewPrefixes();
  return http.createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
      for (const prefix of prefixes) {
        if (pathname === prefix) {
          response.writeHead(301, { Location: `${prefix}/` });
          response.end();
          return;
        }
      }
      for (const prefix of prefixes) {
        if (pathname.startsWith(`${prefix}/`)) {
          pathname = pathname.slice(prefix.length) || '/';
          break;
        }
      }
      let requested = path.resolve(targetRoot, '.' + pathname);
      if (requested !== targetRoot && !requested.startsWith(targetRoot + path.sep)) {
        response.writeHead(403);
        response.end();
        return;
      }
      if ((await stat(requested)).isDirectory()) requested = path.join(requested, 'index.html');
      const content = await readFile(requested);
      response.writeHead(200, { ...headers, 'Content-Type': types[path.extname(requested)] ?? 'application/octet-stream' });
      response.end(content);
    } catch {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
      response.end('Not found');
    }
  }).listen(serverPort, '127.0.0.1');
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const server = createPreviewServer();
  server.on('listening', () => {
    console.log(`Public preview server listening on http://127.0.0.1:${port}`);
  });
}

export default createPreviewServer;
