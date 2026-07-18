// Public barrel for @arena/ui — shared Lit web components for the arena shell
// and every game. Importing a component also registers its custom element (the
// @customElement decorator runs as a side effect), so a single import from this
// package makes the tags available.
//
// These components are presentational and self-contained: they depend only on
// `lit` and `qrcode`, never on other @arena/* packages.

// Design tokens + helpers.
export { arenaTokens, resetStyles, seatColorIndex, SEAT_ACCENT_COUNT } from './theme.js';

// Components (each export also registers its custom element).
export { ArenaRoomFrame } from './room-frame.js';
export { ArenaPlayerCard } from './player-card.js';
export { ArenaSharePanel } from './share-panel.js';
export { ArenaMoveLog } from './move-log.js';
export { ArenaConnectionStatus } from './connection-status.js';
export { ArenaBadge } from './badge.js';
export { ArenaMatchReport } from './match-report.js';
export { ArenaAgentFace } from './agent-face.js';
export { ArenaChessBoard } from './chess-board.js';
export { ArenaReasoningBadge } from './reasoning-badge.js';
export { ArenaMethodChip } from './method-chip.js';
export { ArenaArchiveCard } from './archive-card.js';
export { ArenaLeaderboardTable } from './leaderboard-table.js';

// Shared prop types.
export type { MoveLogEntry } from './move-log.js';
export type { ConnectionPhase } from './connection-status.js';
export type { BadgeVariant } from './badge.js';
export type { ReportMoveView, ReportPlayerView, MatchReportData } from './match-report.js';
export type { FaceEmotion } from './agent-face.js';
export type { ReasoningMode } from './reasoning-badge.js';
export type { MethodKind } from './method-chip.js';
export type { MatchSummary, MatchSummaryPlayer } from './archive-card.js';
export type { LeaderRow } from './leaderboard-table.js';

// Chess piece artwork (used by the chess board; exported for reuse).
export { pieceSvg } from './chess-pieces.js';
export type { PieceKey } from './chess-pieces.js';
