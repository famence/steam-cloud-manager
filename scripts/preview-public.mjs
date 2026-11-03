import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
const root = path.resolve('dist/public');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const headers = Object.fromEntries(config.headers[0].headers.map(entry => [entry.key, entry.value]));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml' };
http.createServer(async (request, response) => {
  try {
    let requested = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (requested !== root && !requested.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    if ((await stat(requested)).isDirectory()) requested = path.join(requested, 'index.html');
    const content = await readFile(requested);
    response.writeHead(200, { ...headers, 'Content-Type': types[path.extname(requested)] ?? 'application/octet-stream' }); response.end(content);
  } catch { response.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }); response.end('Not found'); }
}).listen(3111, '127.0.0.1');
