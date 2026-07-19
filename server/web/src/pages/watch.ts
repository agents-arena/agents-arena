import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import { arenaTokens, resetStyles, arenaKeyframes, seatColorIndex } from '@agents-arena/ui';
import type {
  MatchupPlayer,
  FeedItem,
  MatchReportData,
  ReportMoveView,
  ReportPlayerView,
  ChessResult,
} from '@agents-arena/ui';
import { WatchController } from '../watch-controller.js';
import type { WatchView } from '../watch-controller.js';
import type { ChessState, MatchReport, Player, Snapshot, TttState } from '../types.js';
import { serverBase } from '../server.js';
import { agentInstructions, skillUrl } from '../instructions.js';
import { landingHash } from '../router.js';
import '../components/ttt-watch-board.js';

/** Friendly display name per game id. */
const GAME_NAMES: Record<string, string> = {
  'tic-tac-toe': 'Tic-Tac-Toe',
  chess: 'Chess',
};

/** Default seat labels per game, shown before both players are seated. */
const DEFAULT_SEATS: Record<string, string[]> = {
  'tic-tac-toe': ['X', 'O'],
  chess: ['white', 'black'],
};

/** The felt-table gradient behind the board, per game. */
const FELT: Record<string, string> = {
  chess: 'radial-gradient(130% 150% at 50% -10%, #1e4132 0%, #132a1f 52%, #0d1c14 100%)',
  'tic-tac-toe': 'radial-gradient(120% 140% at 50% -10%, #1d1a2e 0%, #141220 55%, #0e0d17 100%)',
};

/** Format a think time compactly: "850ms", "2.6s", "1m 03s". */
function formatThink(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/**
 * Spectator view of one server-hosted room. Opens the room's SSE stream through
 * a WatchController and renders the live wooden board, the matchup panel with a
 * live "thinking" clock, the running commentary (moves + agent trash talk), and
 * — once the match ends — the full report, all in the dark arena shell.
 */
@customElement('arena-watch-page')
export class ArenaWatchPage extends LitElement {
  /** Room id to watch. */
  @property({ type: String }) roomId = '';
  /** Resolved arena-server base URL. */
  @property({ type: String }) server = '';

  @state() private _view: WatchView | null = null;
  @state() private _copied = false;
  @state() private _methodsBySeat: Map<string, string> = new Map();

  private _controller: WatchController | null = null;
  private _startedFor: string | null = null;
  private _base = '';
  private _copyTimer: ReturnType<typeof setTimeout> | undefined;
  private _priorCommentCount = 0;

  // Live-clock bookkeeping: the server has no per-player countdown, so we time
  // the current move on the client (a real "thinking for Ns" stopwatch).
  private _prevToMove: string | null = null;
  private _turnStartAt = 0;
  private _tick: ReturnType<typeof setInterval> | undefined;
  // Per-ply client timestamps, so live moves interleave with comments in order.
  private _moveStamps: Map<number, number> = new Map();
  private _baseTs = 0;

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        min-height: 100vh;
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
      }

      .page {
        max-width: 1240px;
        margin: 0 auto;
        padding: clamp(12px, 2.5vw, 22px) clamp(12px, 3vw, 30px) 110px;
        animation: aa-rise 0.45s ease both;
      }
      @media (prefers-reduced-motion: reduce) {
        .page {
          animation: none;
        }
      }

      /* ---- Header strip ------------------------------------------------- */
      .room-header {
        display: flex;
        flex-wrap: wrap;
        row-gap: 10px;
        align-items: center;
        gap: 14px;
        margin-bottom: 20px;
      }
      .back {
        font-family: var(--arena-font-mono);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: var(--arena-text-label);
        text-decoration: none;
      }
      .back:hover {
        color: var(--arena-gold);
      }
      .room-title {
        margin: 0;
        font-size: 24px;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: var(--arena-text-strong);
      }
      .badges {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .header-spacer {
        margin-left: auto;
      }
      .room-id {
        font-family: var(--arena-font-mono);
        letter-spacing: 0.04em;
      }

      /* ---- Room layout -------------------------------------------------- */
      .room {
        display: flex;
        flex-wrap: wrap;
        gap: 26px;
        align-items: flex-start;
      }
      .stage {
        flex: 1 1 620px;
        min-width: 0;
      }
      .rail {
        flex: 1 1 380px;
        max-width: 430px;
        min-width: min(330px, 100%);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* ---- Felt panel --------------------------------------------------- */
      .felt {
        border-radius: 20px;
        padding: clamp(14px, 2.6vw, 26px) clamp(12px, 3vw, 30px);
        background: var(--felt);
        border: 1px solid var(--arena-border-soft);
        box-shadow: var(--arena-shadow-2);
        position: relative;
      }
      .felt.ttt {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: clamp(16px, 4vw, 44px);
      }
      .side-label {
        display: flex;
        justify-content: flex-end;
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(235, 222, 199, 0.45);
        margin: 0 4px 8px;
      }
      .side-label.bottom {
        margin: 10px 4px 0;
      }

      /* ---- Under-board strip -------------------------------------------- */
      .underboard {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 16px;
        flex-wrap: wrap;
      }
      .clock-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-family: var(--arena-font-mono);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--arena-text-label);
        border: 1px solid var(--arena-border);
        background: rgba(255, 255, 255, 0.03);
        padding: 7px 12px;
        border-radius: var(--arena-radius-pill);
      }
      .seat-chip {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: 3px 9px;
        border-radius: 6px;
        text-transform: uppercase;
      }
      .seat-chip.white {
        color: var(--arena-chip-white-ink);
        background: var(--arena-chip-white-bg);
      }
      .seat-chip.black {
        color: var(--arena-chip-black-ink);
        background: var(--arena-chip-black-bg);
        border: 1px solid var(--arena-border-strong);
      }
      .seat-chip.accent {
        color: #0e0d17;
        background: var(--seat);
      }
      .result-banner {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-family: var(--arena-font-mono);
        font-size: 12px;
        font-weight: 700;
        color: var(--arena-gold-hi);
        animation: aa-pop 0.4s ease both;
      }

      /* ---- Rail panels -------------------------------------------------- */
      .panel {
        background: var(--arena-surface);
        border: 1px solid var(--arena-border);
        border-radius: 16px;
        padding: 16px;
      }
      .panel-eyebrow {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--arena-text-label);
        margin: 2px 2px 12px;
      }

      /* ---- Bring your agents ------------------------------------------- */
      .agents {
        border-radius: 16px;
        padding: 16px;
        background: linear-gradient(
            160deg,
            color-mix(in srgb, var(--accent) 8%, transparent),
            color-mix(in srgb, var(--accent) 2%, transparent) 60%
          ),
          var(--arena-surface);
        border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--arena-border));
      }
      .agents h3 {
        margin: 0 0 6px;
        font-size: 13px;
        font-weight: 800;
        color: var(--arena-text-strong);
      }
      .agents p {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--arena-text-muted);
      }
      .room-facts {
        display: flex;
        gap: 8px;
        margin: 10px 0 12px;
        flex-wrap: wrap;
      }
      .room-facts span {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 600;
        color: var(--arena-text-dim);
        background: var(--arena-overlay);
        border: 1px solid var(--arena-border);
        padding: 4px 8px;
        border-radius: 6px;
      }
      .agent-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        border: 1px solid transparent;
        border-radius: 9px;
        padding: 9px 14px;
        font-size: 12px;
        transition:
          transform 140ms ease,
          filter 140ms ease,
          background 140ms ease;
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .btn.primary {
        color: var(--arena-brand-ink);
        background: linear-gradient(180deg, var(--arena-gold-a), var(--arena-gold-b));
        box-shadow: 0 6px 18px rgba(232, 184, 75, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.45);
      }
      .btn.primary:hover:not([disabled]) {
        transform: translateY(-1px);
      }
      .btn.ok {
        color: #06210f;
        background: linear-gradient(180deg, var(--arena-success-hi), var(--arena-success));
      }
      .btn.ghost {
        color: var(--arena-text);
        background: rgba(255, 255, 255, 0.04);
        border-color: var(--arena-border-strong);
      }
      .btn.ghost:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .btn[disabled] {
        cursor: progress;
        opacity: 0.65;
      }

      /* ---- Hint chip ---------------------------------------------------- */
      .hint-chip {
        display: inline-flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 12px;
        padding: 6px 12px;
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--arena-warning) 14%, var(--arena-surface));
        color: color-mix(in srgb, var(--arena-warning) 65%, var(--arena-text-bright));
        border: 1px solid color-mix(in srgb, var(--arena-warning) 34%, transparent);
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
      }

      /* ---- Join-request banner ----------------------------------------- */
      .join-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        margin-top: 16px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--arena-gold) 38%, var(--arena-border));
        background: color-mix(in srgb, var(--arena-gold) 8%, var(--arena-surface));
        font-size: 13px;
        font-weight: 600;
        color: var(--arena-text);
      }

      /* ---- Report inside rail ------------------------------------------ */
      .report-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* ---- Centered states (connecting / error) ------------------------ */
      .centered {
        display: grid;
        place-items: center;
        min-height: 92vh;
        padding: 40px;
      }
      .state-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        max-width: 520px;
        padding: clamp(24px, 6vw, 44px) clamp(20px, 7vw, 56px);
        text-align: center;
        border: 1px solid var(--arena-border-strong);
        border-radius: 22px;
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-3);
        animation: aa-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
      }
      .state-card .orb {
        position: absolute;
        width: 220px;
        height: 220px;
        border-radius: 50%;
        filter: blur(60px);
        top: -40px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
      }
      .state-eyebrow {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.3em;
        text-transform: uppercase;
        color: var(--arena-text-label);
      }
      .state-title {
        margin: 0;
        font-size: clamp(1.6rem, 5vw, 2.1rem);
        font-weight: 900;
        letter-spacing: -0.01em;
        color: var(--arena-text-strong);
      }
      .state-body {
        margin: 0;
        color: var(--arena-text-muted);
        line-height: 1.6;
        font-size: 14px;
      }
      .state-id {
        font-family: var(--arena-font-mono);
        color: var(--arena-text);
      }
      .state-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: center;
      }
      .ko {
        animation: aa-float 4s ease infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .state-card,
        .ko,
        .result-banner {
          animation: none;
        }
      }

      @media (max-width: 760px) {
        .rail {
          max-width: none;
        }
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('roomId') && this._startedFor !== null && this._startedFor !== this.roomId) {
      this._teardown();
      this._view = null;
      this._methodsBySeat = new Map();
      this._startedFor = null;
    }
  }

  protected override updated(): void {
    if (this.roomId && this._startedFor !== this.roomId) {
      this._start();
    }
    this._autoScrollComments();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._copyTimer !== undefined) clearTimeout(this._copyTimer);
    if (this._tick !== undefined) clearInterval(this._tick);
    this._teardown();
  }

  private _start(): void {
    this._startedFor = this.roomId;
    this._methodsBySeat = new Map();
    this._prevToMove = null;
    this._turnStartAt = Date.now();
    this._moveStamps = new Map();
    this._baseTs = Date.now();
    const base = this.server || serverBase();
    this._base = base;
    this._controller = new WatchController(base, this.roomId, (view) => {
      this._ingestMethods(view);
      this._ingestTiming(view);
      this._view = view;
    });
    this._view = this._controller.getView();
    this._controller.start();
    if (this._tick === undefined) {
      this._tick = setInterval(() => {
        const v = this._view;
        // Only re-render for the live clock while a side is actually on the move.
        if (v && v.snapshot && v.snapshot.result == null && v.snapshot.toMove) {
          this.requestUpdate();
        }
      }, 250);
    }
  }

  private _teardown(): void {
    this._controller?.destroy();
    this._controller = null;
  }

  /** Track when the side-to-move changed (turn start) + stamp new plies. */
  private _ingestTiming(view: WatchView): void {
    const snap = view.snapshot;
    const toMove = snap?.toMove ?? null;
    if (toMove !== this._prevToMove) {
      this._prevToMove = toMove;
      this._turnStartAt = Date.now();
    }
    // Stamp any newly-seen chess plies so the feed orders correctly.
    if (snap?.gameId === 'chess') {
      const history = this._chess(snap)?.history ?? [];
      for (let i = 0; i < history.length; i++) {
        if (!this._moveStamps.has(i)) this._moveStamps.set(i, Date.now());
      }
    }
  }

  private async _copyInstructions(): Promise<void> {
    const text = agentInstructions(this._base || serverBase(), this.roomId, this._gameId());
    if (this._copyTimer !== undefined) clearTimeout(this._copyTimer);
    try {
      await navigator.clipboard.writeText(text);
      this._copied = true;
    } catch {
      this._copied = false;
    }
    this._copyTimer = setTimeout(() => {
      this._copied = false;
    }, 1900);
  }

  private _gameId(): string {
    return this._view?.snapshot?.gameId ?? 'tic-tac-toe';
  }

  private _ingestMethods(view: WatchView): void {
    const report = view.report;
    if (!report) return;
    let changed = false;
    const next = new Map(this._methodsBySeat);
    for (const m of report.moves ?? []) {
      const method = m.meta?.method;
      if (typeof method === 'string' && method.trim()) {
        const trimmed = method.trim();
        if (next.get(m.seat) !== trimmed) {
          next.set(m.seat, trimmed);
          changed = true;
        }
      }
    }
    for (const p of report.players ?? []) {
      if (typeof p.method === 'string' && p.method.trim() && !next.has(p.seat)) {
        next.set(p.seat, p.method.trim());
        changed = true;
      }
    }
    if (changed) this._methodsBySeat = next;
  }

  private _retry(): void {
    if (this._controller) this._controller.retry();
    else this._start();
  }

  // ---- Derivations --------------------------------------------------------

  private _cells(snap: Snapshot | null): (string | null)[] {
    const state = snap?.state as Partial<TttState> | undefined;
    if (state && Array.isArray(state.board) && state.board.length === 9) return state.board;
    return new Array<string | null>(9).fill(null);
  }

  private _next(snap: Snapshot | null): string {
    const state = snap?.state as Partial<TttState> | undefined;
    return typeof state?.next === 'string' ? state.next : 'X';
  }

  private _seats(snap: Snapshot): string[] {
    if (snap.players.length >= 2) return snap.players.map((p) => p.seat);
    return DEFAULT_SEATS[snap.gameId] ?? ['X', 'O'];
  }

  private _chess(snap: Snapshot | null): ChessState | null {
    const state = snap?.state as Partial<ChessState> | undefined;
    if (state && typeof state.fen === 'string') {
      return {
        fen: state.fen,
        moves: Array.isArray(state.moves) ? state.moves : [],
        history: Array.isArray(state.history) ? state.history : [],
        keys: Array.isArray(state.keys) ? state.keys : [],
        lastMove:
          state.lastMove && typeof state.lastMove.from === 'string'
            ? { from: state.lastMove.from, to: state.lastMove.to }
            : null,
      };
    }
    return null;
  }

  /** Build the two matchup cards from the live snapshot + report. */
  private _matchupPlayers(view: WatchView): MatchupPlayer[] {
    const snap = view.snapshot;
    if (!snap) return [];
    let seats = this._seats(snap);
    // Chess: show black on top to match the board's orientation.
    if (snap.gameId === 'chess') {
      seats = [...seats].sort((a, b) => (a === 'black' ? -1 : b === 'black' ? 1 : 0));
    }
    const toMove = snap.toMove ?? null;
    const result = snap.result;
    const now = Date.now();
    return seats.map((seat) => {
      const p = snap.players.find((x) => x.seat === seat);
      const status: MatchupPlayer['status'] =
        p?.status ?? (p ? (p.connected ? 'connected' : 'lost') : 'open');
      const active = result == null && toMove === seat;
      const winner = result?.kind === 'win' && result.winner === seat;
      const name = status === 'open' || !p?.name ? 'Open seat' : p.name;
      let clockMs: number | undefined;
      let clockLabel: string | undefined;
      if (active) {
        clockMs = now - this._turnStartAt;
        clockLabel = 'thinking';
      } else if (view.report) {
        const rp = view.report.players.find((x) => x.seat === seat);
        if (rp) {
          clockMs = rp.totalThinkMs;
          clockLabel = 'think total';
        }
      }
      return { seat, name, model: p?.model, status, active, winner, clockMs, clockLabel };
    });
  }

  /** Merge moves (chess SAN) and comments into one time-ordered feed. */
  private _feedItems(view: WatchView): FeedItem[] {
    const snap = view.snapshot;
    const rows: { ts: number; item: FeedItem }[] = [];
    if (snap?.gameId === 'chess') {
      const history = this._chess(snap)?.history ?? [];
      const report = view.report;
      for (let i = 0; i < history.length; i++) {
        const seat = i % 2 === 0 ? 'white' : 'black';
        const san = history[i] ?? '';
        let ts = this._moveStamps.get(i) ?? this._baseTs + i;
        let thinkLabel: string | undefined;
        const rm = report?.moves?.[i];
        if (rm) {
          if (Number.isFinite(rm.appliedAt) && rm.appliedAt > 0) ts = rm.appliedAt;
          thinkLabel = `thought ${formatThink(rm.thinkMs)}`;
        }
        rows.push({ ts, item: { kind: 'move', seat, san, thinkLabel } });
      }
    }
    for (const c of view.comments) {
      rows.push({ ts: c.ts, item: { kind: 'say', seat: c.seat, name: c.name, text: c.text } });
    }
    rows.sort((a, b) => a.ts - b.ts);
    return rows.map((r) => r.item);
  }

  private _reportData(r: MatchReport): MatchReportData {
    const result: MatchReportData['result'] = r.result
      ? r.result.kind === 'win'
        ? { kind: 'win', winner: r.result.winner ?? '' }
        : { kind: 'draw' }
      : null;
    const players: ReportPlayerView[] = r.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      model: p.model,
      moves: p.moves,
      totalThinkMs: p.totalThinkMs,
      avgThinkMs: p.avgThinkMs,
      rejected: p.rejected,
      tokensIn: p.tokensIn,
      tokensOut: p.tokensOut,
      methods: p.methods,
      method: p.method,
    }));
    const moves: ReportMoveView[] = r.moves.map((m) => ({
      ply: m.ply,
      seat: m.seat,
      move: m.move,
      thinkMs: m.thinkMs,
      meta: m.meta
        ? {
            model: m.meta.model,
            tokensIn: m.meta.tokensIn,
            tokensOut: m.meta.tokensOut,
            latencyMs: m.meta.latencyMs,
            note: m.meta.note,
            method: m.meta.method,
          }
        : undefined,
    }));
    return {
      gameId: r.gameId,
      room: r.room,
      result,
      startedAt: r.startedAt,
      endedAt: r.endedAt ?? null,
      durationMs: r.durationMs ?? null,
      players,
      moves,
      generatedAt: r.generatedAt,
      reasoning: r.reasoning ?? this._view?.snapshot?.reasoning,
    };
  }

  private _seatStatus(player: Player | undefined): 'waiting' | 'connecting' | 'connected' | 'lost' {
    if (!player) return 'waiting';
    switch (player.status) {
      case 'open':
        return 'waiting';
      case 'connecting':
        return 'connecting';
      case 'connected':
        return 'connected';
      case 'lost':
        return 'lost';
      default:
        return player.connected ? 'connected' : 'waiting';
    }
  }

  // ---- Render -------------------------------------------------------------

  protected override render() {
    const view = this._view;
    if (!view || (view.phase === 'connecting' && !view.snapshot)) return this._renderConnecting(view);
    if (view.phase === 'error') return this._renderError(view);
    return this._renderRoom(view);
  }

  private _renderConnecting(view: WatchView | null) {
    return html`
      <div class="centered">
        <div class="state-card">
          <span class="orb" style="background: rgba(232,184,75,.14)"></span>
          <arena-agent-avatar seat="white" .size=${76} mood="thinking"></arena-agent-avatar>
          <span class="state-eyebrow">Room <span class="state-id">${this.roomId}</span></span>
          <h1 class="state-title">Tuning in…</h1>
          <arena-connection-status
            phase=${view?.connection ?? 'connecting'}
            detail="opening the live feed"
          ></arena-connection-status>
          <p class="state-body">Connecting to the room's live event stream.</p>
        </div>
      </div>
    `;
  }

  private _renderError(view: WatchView) {
    return html`
      <div class="centered">
        <div class="state-card">
          <span class="orb" style="background: rgba(255,90,82,.12)"></span>
          <div class="ko">
            <arena-agent-avatar seat="lost" .size=${76} mood="ko"></arena-agent-avatar>
          </div>
          <span class="state-eyebrow">Can't watch this room</span>
          <h1 class="state-title">Room unavailable</h1>
          <p class="state-body">
            ${view.error ??
            "Couldn't connect to this room. It may not exist, or the server is taking a nap. The agents are unbothered."}
          </p>
          <div class="state-actions">
            <button class="btn primary" type="button" @click=${this._retry}>Try again</button>
            <a class="btn ghost" href=${landingHash()}>Back to start</a>
          </div>
        </div>
      </div>
    `;
  }

  private _renderRoom(view: WatchView) {
    const snap = view.snapshot;
    const gameId = snap?.gameId ?? 'tic-tac-toe';
    const gameName = (snap && GAME_NAMES[gameId]) || gameId || 'Match';
    const live = snap?.result == null && view.connection !== 'closed';
    return html`
      <div class="page">
        <div class="room-header">
          <a class="back" href=${landingHash()} aria-label="Back to start">← ARENA</a>
          <h1 class="room-title">${gameName}</h1>
          <div class="badges">
            <arena-badge variant="neutral">Spectating</arena-badge>
            ${live
              ? html`<arena-badge variant="danger" dot>Live</arena-badge>`
              : snap?.result != null
                ? html`<arena-badge variant="accent">Final</arena-badge>`
                : nothing}
            ${snap?.reasoning
              ? html`<arena-reasoning-badge mode=${snap.reasoning}></arena-reasoning-badge>`
              : nothing}
            <arena-connection-status phase=${view.connection}></arena-connection-status>
          </div>
          <span class="header-spacer"></span>
          <arena-badge>room <span class="room-id">${this.roomId}</span></arena-badge>
        </div>

        <div class="room">
          <div class="stage">${this._renderStage(snap, gameId)}</div>
          <div class="rail">${this._renderRail(view, gameId)}</div>
        </div>

        ${this._renderJoinRequestBanner(view)}
      </div>
    `;
  }

  private _renderStage(snap: Snapshot | null, gameId: string) {
    if (gameId === 'chess') return this._renderChessStage(snap);
    return this._renderTttStage(snap);
  }

  private _renderChessStage(snap: Snapshot | null) {
    const chess = this._chess(snap);
    const lastSan = chess?.history[chess.history.length - 1] ?? '';
    const result = snap?.result ?? null;
    const nameOf = (seat: string) => snap?.players.find((p) => p.seat === seat)?.name || seat;
    const chessResult: ChessResult | null = result
      ? result.kind === 'win'
        ? { kind: 'win', winner: result.winner ?? '' }
        : { kind: 'draw' }
      : null;
    const winnerName = result?.winner ? nameOf(result.winner) : '';
    return html`
      <div class="felt" style=${`--felt:${FELT.chess}`}>
        <div class="side-label">${nameOf('black')} · Black</div>
        <arena-chess-board
          .fen=${chess?.fen ?? ''}
          .lastMove=${chess?.lastMove ?? null}
          .sanHistory=${chess?.history ?? []}
          ?check=${lastSan.endsWith('+') || lastSan.endsWith('#')}
          .result=${chessResult}
          winnerName=${winnerName}
          resultDetail=${result?.reason ?? ''}
        ></arena-chess-board>
        <div class="side-label bottom">${nameOf('white')} · White</div>
      </div>
      ${this._renderUnderboard(snap)}
    `;
  }

  private _renderTttStage(snap: Snapshot | null) {
    return html`
      <div class="felt ttt" style=${`--felt:${FELT['tic-tac-toe']}`}>
        <ttt-watch-board .cells=${this._cells(snap)} next=${this._next(snap)}></ttt-watch-board>
        <div class="underboard" style="justify-content:center">
          ${this._renderClockOrResult(snap)}
        </div>
      </div>
    `;
  }

  private _renderUnderboard(snap: Snapshot | null) {
    return html`<div class="underboard">${this._renderClockOrResult(snap)}${this._renderHintChip(snap)}</div>`;
  }

  private _renderClockOrResult(snap: Snapshot | null) {
    const result = snap?.result ?? null;
    if (result) {
      if (result.kind === 'draw') {
        return html`<span class="result-banner">🤝 It's a draw.</span>`;
      }
      const winner = result.winner ?? '';
      const winnerName = snap?.players.find((p) => p.seat === winner)?.name || winner;
      return html`<span class="result-banner" style=${`color: color-mix(in srgb, var(--arena-seat-${seatColorIndex(winner)}) 70%, var(--arena-text-bright))`}>🏆 ${winnerName} wins!</span>`;
    }
    const toMove = snap?.toMove;
    if (toMove) {
      const chipCls = toMove === 'white' ? 'white' : toMove === 'black' ? 'black' : 'accent';
      const style =
        chipCls === 'accent' ? `--seat: var(--arena-seat-${seatColorIndex(toMove)})` : '';
      return html`<span class="clock-pill"
        >On the clock<span class="seat-chip ${chipCls}" style=${style}>${toMove}</span></span
      >`;
    }
    return html`<span class="clock-pill">Waiting for the first move…</span>`;
  }

  private _renderRail(view: WatchView, gameId: string) {
    const accent = gameId === 'chess' ? 'var(--arena-gold)' : 'var(--arena-violet)';
    return html`
      <arena-matchup-panel .players=${this._matchupPlayers(view)}></arena-matchup-panel>

      <arena-commentary-feed .items=${this._feedItems(view)}></arena-commentary-feed>

      ${this._renderAgentPanel(view, accent)}

      ${view.report
        ? html`<div class="report-group">
            <div class="panel-eyebrow" style="margin-left:0">Match report</div>
            <arena-match-report .report=${this._reportData(view.report)}></arena-match-report>
          </div>`
        : nothing}
    `;
  }

  private _renderAgentPanel(view: WatchView, accent: string) {
    const base = this._base || serverBase();
    const openSeats = (view.snapshot?.players ?? []).filter((p) => this._seatStatus(p) === 'waiting')
      .length;
    return html`
      <section class="agents" style=${`--accent: ${accent}`} aria-label="Play with your agents">
        <h3>🤖 Bring your agents</h3>
        <p>
          ${openSeats > 0
            ? html`${openSeats === 2 ? 'Both seats are open.' : 'One seat is open.'} Paste these
              instructions into your ${openSeats === 2 ? 'two agents' : 'agent'} — they join and play
              this room over plain HTTP.`
            : html`Both seats are taken — these are the same instructions the agents used.`}
        </p>
        <div class="room-facts">
          <span>server ${base.replace(/^https?:\/\//, '')}</span>
          <span>room ${this.roomId}</span>
        </div>
        <div class="agent-actions">
          <button
            class=${this._copied ? 'btn ok' : 'btn primary'}
            type="button"
            @click=${this._copyInstructions}
          >
            ${this._copied ? '✓ Copied!' : 'Copy agent instructions'}
          </button>
          <a
            class="btn ghost"
            href=${skillUrl(base, this._gameId())}
            target="_blank"
            rel="noopener noreferrer"
            >View skill</a
          >
        </div>
      </section>
    `;
  }

  private _renderHintChip(snap: Snapshot | null) {
    const hints = snap?.hints;
    if (!hints || hints.length === 0) return nothing;
    return html`<div class="hint-chip" title=${hints.join('\n')}>⚡ <span>${hints[0]}</span></div>`;
  }

  private _renderJoinRequestBanner(view: WatchView) {
    const jr = view.joinRequest;
    if (!jr) return nothing;
    return html`
      <div class="join-banner">
        ⟳ <strong>${jr.name}</strong> asks to take the <strong>${jr.seat}</strong> seat — the seated
        player must approve
      </div>
    `;
  }

  private _autoScrollComments(): void {
    if (!this._view) return;
    const count = this._view.comments.length;
    if (count !== this._priorCommentCount) {
      this._priorCommentCount = count;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-watch-page': ArenaWatchPage;
  }
}
