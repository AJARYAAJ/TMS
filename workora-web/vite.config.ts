import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const api = process.env.WORKORA_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  base: '/workora/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api/v1/realtime': { target: api, ws: true, changeOrigin: true },
      '/api': { target: api, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api/v1/realtime': { target: api, ws: true, changeOrigin: true },
      '/api': { target: api, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
