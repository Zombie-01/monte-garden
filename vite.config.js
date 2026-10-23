import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), rooms: resolve(import.meta.dirname, 'rooms.html') } },
  },
});
