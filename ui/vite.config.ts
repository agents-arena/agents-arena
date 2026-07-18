import { defineConfig } from 'vite';

// Library build: bundle the components as ESM, leaving lit/qrcode external
// (peer runtime deps the consumer already has).
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['lit', /^lit\/.*/, 'qrcode'],
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
