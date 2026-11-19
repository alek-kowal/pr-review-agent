import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiOrigin = 'http://localhost:3000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // The router plugin must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, addExtensions: true }),
    react(),
  ],
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
