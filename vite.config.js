import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Used by `npm run dev` on localhost:5174 only. Docker/Jenkins production
  // serves the built app through Nginx and its /api reverse proxy instead.
  // No Client .env, Dev Tunnel or browser-facing localhost:5000 URL required.
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // Preserve the /api prefix: Express mounts its wall router at
      // /api/qr-wall. This also proxies EventSource `/stream` requests.
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
});
