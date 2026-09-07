import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Content scripts cannot be ES modules in MV3 — build a single self-contained IIFE.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'esnext',
    lib: {
      entry: resolve(__dirname, 'src/content/content.tsx'),
      name: 'NarrateContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: { output: { extend: true, inlineDynamicImports: true } },
  },
});
