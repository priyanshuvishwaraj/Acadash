import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: './client',
  envDir: '..',
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
