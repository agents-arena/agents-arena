// TypeScript mirrors of the arena-protocol JSON shapes (see arena-protocol/
// protocol.go + apiv1.go). Field names are camelCase to match the wire format.
// These describe only what the spectator UI consumes.

import type { FaceEmotion } from '@agents-arena/ui';

/** Terminal outcome of a game. `null` while the game is still in progress. */
export interface GameResult {
  kind: 'win' | 'draw';
  winner?: string;
  reason?: string;
}

/** A seated competitor as reported in a snapshot. */
export type PlayerStatus = 'open' | 'connecting' | 'connected' | 'lost';

export interface Player {
  seat: string;
  name?: string;
  model?: string;
  connected: boolean;
  /** Live presence of the seat's occupant (drives the status dot). */
  status?: PlayerStatus;
}

/** Tic-tac-toe board state (the JSON in `Snapshot.state` for this game). */
export interface TttState {
  /** 9 cells, row-major; each is "X", "O", or null. */
  board: (string | null)[];
  /** Side to play next. */
  next: string;
}

/** Connect Four board state (the JSON in `Snapshot.state` for this game). */
export interface ConnectFourState {
  /** 42 cells, row-major (7×6, row 0 = top); each is "R", "Y", or null. */
  board: (string | null)[];
  /** Side to play next. */
  next: string;
}

/** Reversi board state (the JSON in `Snapshot.state` for this game). */
export interface ReversiState {
  /** 64 cells, row-major (8×8, row 0 = top); each is "B", "W", or null. */
  board: (string | null)[];
  /** Side to play next. */
  next: string;
  /** Black's disc count. */
  b?: number;
  /** White's disc count. */
  w?: number;
}

/** Gomoku board state (the JSON in `Snapshot.state` for this game). */
export interface GomokuState {
  /** 225 points, row-major (15×15, row 0 = top); each is "B", "W", or null. */
  board: (string | null)[];
  /** Side to play next. */
  next: string;
  /** Index of the most recent stone, or null before the first move. */
  last: number | null;
}

/** Dots and Boxes state (the JSON in `Snapshot.state` for this game). */
export interface DotsAndBoxesState {
  /** 40 edges: 20 horizontal (row-major) then 20 vertical; each "A", "B", or null. */
  edges: (string | null)[];
  /** 16 boxes, row-major; each "A", "B", or null. */
  boxes: (string | null)[];
  /** Side to play next. */
  next: string;
  /** A's box count. */
  a?: number;
  /** B's box count. */
  b?: number;
}

/** Checkers state (the JSON in `Snapshot.state` for this game). */
export interface CheckersState {
  /** 64 squares, row-major (row 0 = top); "r"/"R" red man/king, "b"/"B" black, or null. */
  board: (string | null)[];
  /** Side to play next. */
  next: string;
  /** Square of a piece that must keep jumping, or null. */
  chain: number | null;
  /** Plies since the last capture or man move. */
  idle?: number;
}

/** Chess state (the JSON in `Snapshot.state` for this game). */
export interface ChessState {
  /** Full FEN of the current position. */
  fen: string;
  /** UCI move history, e.g. ["e2e4", "e7e8q"]. */
  moves: string[];
  /** SAN history, parallel to `moves`. */
  history: string[];
  /** Repetition bookkeeping keys (spectators can ignore). */
  keys: string[];
  /** Last move played, for board highlighting. */
  lastMove: { from: string; to: string } | null;
}

/** Canonical game state at a revision. `state` is game-specific JSON. */
export interface Snapshot {
  rev: number;
  gameId: string;
  state: unknown;
  toMove?: string;
  result: GameResult | null;
  players: Player[];
  /** Advisory text for the side to move; omitted when none. */
  hints?: string[];
  /** Declared reasoning mode for the room (`self` = model only, `open` = any tools). */
  reasoning?: 'self' | 'open';
}

/** A chat message authored by a player or commenter. */
export interface Comment {
  name: string;
  seat?: string;
  role: string;
  text: string;
  ts: number;
}

/** Pending seat-claim request shown in the spectator UI. */
export interface JoinRequestInfo {
  requestId: string;
  name: string;
  seat: string;
  ts: number;
}

/** A side-channel feeling broadcast by a seat. */
export interface Emote {
  seat: string;
  emotion: FaceEmotion;
  note?: string;
  ts: number;
}

/** Per-move telemetry an agent may attach. */
export interface MoveMeta {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  note?: string;
  /** Self-reported method of choosing this move (`model`|`engine`|`hybrid`|`human`). */
  method?: string;
}

/** One applied move in the match report. `move` is the game-specific payload. */
export interface MoveRecord {
  ply: number;
  seat: string;
  move: unknown;
  rev: number;
  turnStartedAt: number;
  appliedAt: number;
  thinkMs: number;
  meta?: MoveMeta;
}

/** Aggregate stats for one seat in the match report. */
export interface PlayerReport {
  seat: string;
  name?: string;
  model?: string;
  moves: number;
  totalThinkMs: number;
  avgThinkMs: number;
  rejected: number;
  tokensIn?: number;
  tokensOut?: number;
  /** Counts of self-reported methods across this player's moves. */
  methods?: Record<string, number>;
  /** Dominant / declared method when a full methods breakdown is absent. */
  method?: string;
}

/** Full post-game report emitted on the SSE stream and at GET /report. */
export interface MatchReport {
  protocolV: number;
  gameId: string;
  room: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  result: GameResult | null;
  players: PlayerReport[];
  moves: MoveRecord[];
  generatedAt: number;
  /** Declared room reasoning mode. */
  reasoning?: 'self' | 'open';
}

/** One finished match in the archive list (GET /v1/matches). */
export interface MatchSummary {
  room: string;
  gameId: string;
  reasoning?: 'self' | 'open';
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  result: GameResult | null;
  players: PlayerReport[];
  moveCount: number;
  comments: number;
}

/** Paginated archive listing. */
export interface ArchiveList {
  matches: MatchSummary[];
  total: number;
}

/** Full archived match: report + comments (GET /v1/matches/{room}). */
export interface ArchivedMatch {
  report: MatchReport;
  comments: Comment[];
}

/** One competitor row in the leaderboard API response. */
export interface LeaderRow {
  name: string;
  model?: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  avgThinkMs: number;
  topMethod?: string;
}

/** Leaderboard standings (GET /v1/leaderboard). */
export interface Leaderboard {
  rows: LeaderRow[];
}

/** Envelope for every SSE message: exactly one of snapshot/emote/report/comment/joinRequest is set. */
export interface ArenaEvent {
  type: string;
  snapshot?: Snapshot;
  emote?: Emote;
  report?: MatchReport;
  comment?: Comment;
  joinRequest?: JoinRequestInfo;
}

/** Response from POST /v1/rooms. */
export interface CreateRoomResponse {
  roomId: string;
  token: string;
  role: string;
  seat?: string;
  snapshot: Snapshot;
}
