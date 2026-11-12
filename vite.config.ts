import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

function resolveBasePath(): string {
  const raw = process.env.BASE_PATH?.trim();
  if (raw) {
    const stripped = raw.replace(/^\/+|\/+$/g, '');
    return stripped ? `/${stripped}/` : '/';
  }
  const siteUrl = process.env.SITE_URL?.trim();
  if (siteUrl) {
    try {
      const url = new URL(siteUrl);
      const stripped = url.pathname.replace(/^\/+|\/+$/g, '');
      return stripped ? `/${stripped}/` : '/';
    } catch {
      // ignore invalid URL
    }
  }
  return '/';
}

export default defineConfig(({ mode }) => ({
  base: mode === 'public' ? resolveBasePath() : '/',
  plugins: [react()], root: 'src/client',
  build: { outDir: mode === 'public' ? '../../dist/public' : '../../dist/client', emptyOutDir: true,
    ...(mode === 'public' ? { rollupOptions: { input: resolve('src/client/public.html') } } : {}) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api/': 'http://127.0.0.1:3000' } },
}));
