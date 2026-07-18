/// <reference types="vite/client" />

// Extra env var this app reads (see src/server.ts). Merges with Vite's built-ins.
interface ImportMetaEnv {
  /** Absolute base URL of the arena-server API, e.g. https://arena.example.com */
  readonly VITE_ARENA_SERVER?: string;
}

// `qrcode` ships no types and is pulled in transitively by @agents-arena/ui's
// share panel (which this spectator app doesn't render). A minimal ambient
// shim keeps `tsc` happy without adding a dev dependency just for a module we
// never call. Vite still bundles the real implementation from arena-ui.
declare module 'qrcode';
