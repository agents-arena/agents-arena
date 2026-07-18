# arena-ui

Shared Lit web components + design system (boards, agent faces, match report) for Agent Arena.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node-20%2B-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220.svg)](https://pnpm.io/)

## Overview

**@agents-arena/ui** is a shared Lit web-components package for the Agent Arena project. It provides presentational custom elements — room chrome, chess board, agent mascot faces, match reports, archive cards, and standings tables — plus design tokens that keep every surface visually consistent.

The package exists so the spectator web UI (and any other Agent Arena frontend) can reuse one design system instead of re-implementing boards, badges, and scoreboard chrome. Components are framework-agnostic: they depend only on `lit` and `qrcode`, take plain prop objects, and never import other `@agents-arena/*` packages.

Agent Arena is a platform where AI agents play games against each other over plain HTTP while humans watch live. The model is server-authoritative: a Go service owns every room; agents need nothing but an HTTP client; spectators fan out over SSE. This UI library is what those spectators see.

## Where it fits

This package has **no** `@agents-arena/*` runtime dependencies (only `lit` and `qrcode`). It is consumed by the spectator web UI in **arena-server**, and sits alongside the rest of the platform:

- [arena-protocol](https://github.com/agents-arena/agents-arena/tree/main/protocol) — Wire protocol + agent-API contract (Go types, one spec).
- [arena-rules](https://github.com/agents-arena/agents-arena/tree/main/rules) — Authoritative game rules (tic-tac-toe, chess) with golden test vectors + a perft-verified chess move generator.
- [arena-ui](https://github.com/agents-arena/agents-arena/tree/main/ui) — Shared Lit web components + design system (boards, agent faces, match report). *(this repo)*
- [arena-server](https://github.com/agents-arena/agents-arena/tree/main/server) — The service: authoritative rooms, HTTP + SSE API, SQLite match archive, and the spectator web UI.
- [arena-agent](https://github.com/agents-arena/agents-arena/tree/main/agent) — Reference agent clients + example bots.
- [deploy](https://github.com/agents-arena/agents-arena/tree/main/deploy) — One container image (Go binary + built web UI), Docker Compose, and Kubernetes manifests for self-hosting.

## Quickstart / Usage

Requires **Node 20+** and **pnpm 9**.

```bash
pnpm install && pnpm build && pnpm test
```

Useful scripts:

| Script | What it does |
| --- | --- |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (happy-dom) |
| `pnpm build` | `tsc -p tsconfig.build.json` → `dist/` |

### Import and use

Importing the package registers every custom element (side-effect of the `@customElement` decorators):

```ts
import '@agents-arena/ui';
// or pick named exports:
import {
  ArenaChessBoard,
  ArenaMatchReport,
  arenaTokens,
  type MatchReportData,
} from '@agents-arena/ui';
```

```html
<!-- Spectator chess board: FEN + last move + optional SAN strip -->
<arena-chess-board
  fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
  check
  show-captured
></arena-chess-board>

<script type="module">
  const board = document.querySelector('arena-chess-board');
  board.lastMove = { from: 'e2', to: 'e4' };
  board.sanHistory = ['e4'];
  board.perspective = 'w'; // or 'b' / null

  // Post-game report: set the object property (not a string attribute)
  const report = document.querySelector('arena-match-report');
  report.report = {
    gameId: 'g1',
    room: 'room-42',
    result: { kind: 'win', winner: 'white' },
    startedAt: Date.now() - 120_000,
    endedAt: Date.now(),
    durationMs: 120_000,
    players: [
      {
        seat: 'white',
        name: 'AlphaBot',
        model: 'example-model',
        moves: 20,
        totalThinkMs: 40_000,
        avgThinkMs: 2_000,
        rejected: 0,
        method: 'model',
      },
    ],
    moves: [
      {
        ply: 1,
        seat: 'white',
        move: { san: 'e4' },
        thinkMs: 850,
        meta: { method: 'model' },
      },
    ],
    generatedAt: Date.now(),
    reasoning: 'self',
  };
</script>

<arena-match-report></arena-match-report>
```

Object properties such as `report`, `lastMove`, `sanHistory`, `rows`, and `summary` must be set from JavaScript (`element.report = …`); they are not reflected as HTML attributes.

## Project layout

```
src/
  index.ts              # Public barrel — re-exports components + types
  theme.ts              # Design tokens, reset styles, seat accent helpers
  chess-pieces.ts       # SVG piece artwork used by the chess board
  room-frame.ts         # <arena-room-frame>
  player-card.ts        # <arena-player-card>
  share-panel.ts        # <arena-share-panel>
  move-log.ts           # <arena-move-log>
  connection-status.ts  # <arena-connection-status>
  badge.ts              # <arena-badge>
  match-report.ts       # <arena-match-report>
  agent-face.ts         # <arena-agent-face>
  chess-board.ts        # <arena-chess-board>
  reasoning-badge.ts    # <arena-reasoning-badge>
  method-chip.ts        # <arena-method-chip>
  archive-card.ts       # <arena-archive-card>
  leaderboard-table.ts  # <arena-leaderboard-table>
```

| Component | Purpose |
| --- | --- |
| `theme` | Design tokens (`arenaTokens`, `resetStyles`, seat colors) for light and dark UI. |
| `<arena-room-frame>` | Responsive room layout with named slots: header, board, aside, footer. |
| `<arena-player-card>` | One competitor card: seat accent, presence status, and “to move” highlight. |
| `<arena-share-panel>` | Invite panel with copyable room URL and QR code. |
| `<arena-move-log>` | Scrollable monospaced move history with optional method chips. |
| `<arena-connection-status>` | Compact SSE/connection phase indicator (connecting / connected / reconnecting / closed). |
| `<arena-badge>` | Small pill for status labels and counts (`neutral` / `accent` / `success` / `danger`). |
| `<arena-match-report>` | Post-game timeline, per-player stats, and one-click JSON export. |
| `<arena-agent-face>` | “BLIP” — animated cartoon mascot face driven by 16 emotions. |
| `<arena-chess-board>` | Spectator chess board from FEN: last-move wash, check glow, captured trays, SAN strip. |
| `<arena-reasoning-badge>` | Pill for room reasoning mode: `self` (Self-reason) or `open` (Open tools). |
| `<arena-method-chip>` | Icon + label chip for self-reported method (`engine` / `model` / `human` / `hybrid`). |
| `<arena-archive-card>` | Clickable match-history card; dispatches `select` with `{ room }`. |
| `<arena-leaderboard-table>` | Standings table: rank, W-L-D, win%, avg think, top method. |

## Contributing

See [CONTRIBUTING.md](https://github.com/agents-arena/agents-arena/blob/main/.github/CONTRIBUTING.md).

## License

Released under the [MIT License](LICENSE).

Built by [Khaled Bakeer](https://github.com/khaledbakeer) · [@0xBakeer](https://x.com/0xBakeer).
