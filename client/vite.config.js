import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy /api to the Express server so the browser sees one origin in dev.
    // This keeps the httpOnly SameSite=Strict auth cookies working without
    // any cross-site cookie configuration.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
