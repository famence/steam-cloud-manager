import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => ({
  plugins: [react()], root: 'src/client',
  build: { outDir: mode === 'public' ? '../../dist/public' : '../../dist/client', emptyOutDir: true,
    ...(mode === 'public' ? { rollupOptions: { input: { landing: resolve('src/client/public.html'), app: resolve('src/client/app.html') } } } : {}) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api/': 'http://127.0.0.1:3000' } },
}));
