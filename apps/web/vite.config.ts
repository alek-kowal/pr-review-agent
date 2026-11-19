import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The e2e stack runs the api on its own port (playwright.config.ts).
const apiOrigin = process.env.API_PROXY_TARGET || 'http://localhost:3000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // The router plugin must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, addExtensions: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // One origin in dev: the browser talks to Vite, Vite forwards these to the api.
    proxy: {
      '/api': apiOrigin,
      '/webhooks': apiOrigin,
      '/health': apiOrigin,
    },
  },
});
