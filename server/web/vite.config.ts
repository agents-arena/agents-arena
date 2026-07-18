import { defineConfig } from 'vite';

// This app is a browser spectator for the arena-server. In `dev` we proxy the
// API to the running Go server so the frontend can treat it as same-origin
// (EventSource + fetch with no CORS ceremony). Override the target with
// ARENA_SERVER_TARGET when the server listens elsewhere.
//
// @types/node isn't a dependency; declare the tiny slice of `process` we touch.
declare const process: { env: Record<string, string | undefined> };

const target = process.env.ARENA_SERVER_TARGET || 'http://localhost:8099';

export default defineConfig({
  base: '/',
  server: {
    proxy: {
      // REST API. `ws: false` — these are plain HTTP + SSE, not WebSockets.
      '/v1': { target, changeOrigin: true },
      '/healthz': { target, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
