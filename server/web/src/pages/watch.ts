import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import { arenaTokens, resetStyles, seatColorIndex } from '@agents-arena/ui';
import type { FaceEmotion, MatchReportData, ReportMoveView, ReportPlayerView } from '@agents-arena/ui';
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

/**
 * Spectator view of one server-hosted room. Opens the room's SSE stream through
 * a WatchController and renders the live board, agent faces, player cards, and —
 * once the match ends — the full report, all inside <arena-room-frame>.
 */
@customElement('arena-watch-page')
export class ArenaWatchPage extends LitElement {
  /** Room id to watch. */
  @property({ type: String }) roomId = '';
  /** Resolved arena-server base URL. */
  @property({ type: String }) server = '';

  @state() private _view: WatchView | null = null;
  @state() private _copied = false;
  /** Latest self-reported method per seat (from move/report meta). */
  @state() private _methodsBySeat: Map<string, string> = new Map();

  private _controller: WatchController | null = null;
  private _startedFor: string | null = null;
  private _base = '';
  private _copyTimer: ReturnType<typeof setTimeout> | undefined;
  private _priorCommentCount = 0;

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        min-height: 100vh;
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
      }

      /* ---- Header strip ------------------------------------------------- */
      .room-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-3);
      }
      .room-title {
        margin: 0;
        font-size: var(--arena-text-xl);
        font-weight: 780;
        letter-spacing: -0.02em;
      }
      .back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--arena-text-muted);
        text-decoration: none;
        font-size: var(--arena-text-sm);
        font-weight: 600;
      }
      .back:hover {
        color: var(--arena-brand);
      }
      .header-spacer {
        flex: 1 1 auto;
      }
      .room-id {
        font-family: var(--arena-font-mono);
        letter-spacing: 0.04em;
      }

      /* ---- Board mount -------------------------------------------------- */
      .board-mount {
        display: grid;
        place-items: center;
        width: 100%;
      }

      /* ---- Agent onboarding panel -------------------------------------- */
      .agent-panel {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-3);
        padding: var(--arena-space-4);
        border: 1px solid color-mix(in srgb, var(--arena-brand) 34%, var(--arena-border));
        border-radius: var(--arena-radius-lg);
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--arena-brand) 9%, var(--arena-surface)),
          var(--arena-surface)
        );
        box-shadow: var(--arena-shadow-1);
      }
      .agent-panel h3 {
        margin: 0;
        display: flex;
        align-items: center;
        gap: var(--arena-space-2);
        font-size: var(--arena-text-sm);
        font-weight: 750;
        letter-spacing: -0.01em;
      }
      .agent-panel p {
        margin: 0;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
        line-height: 1.5;
      }
      .room-facts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--arena-space-2);
      }
      .room-facts span {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        color: var(--arena-text-faint);
      }
      .room-facts code {
        color: var(--arena-text);
        background: var(--arena-surface-inset);
        padding: 1px 6px;
        border-radius: var(--arena-radius-sm);
      }
      .agent-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--arena-space-2);
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 40px;
        padding: 0 var(--arena-space-4);
        border-radius: var(--arena-radius-md);
        border: 1px solid transparent;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        transition:
          filter 140ms ease,
          border-color 140ms ease;
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .btn.primary {
        background: var(--arena-brand);
        color: var(--arena-brand-ink);
      }
      .btn.primary:hover {
        filter: brightness(1.07);
      }
      .btn.ok {
        background: var(--arena-success);
        color: #fff;
      }
      .btn.ghost {
        background: var(--arena-surface);
        border-color: var(--arena-border-strong);
        color: var(--arena-text);
      }
      .btn.ghost:hover {
        border-color: var(--arena-brand);
      }

      /* ---- Aside -------------------------------------------------------- */
      .aside-group {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-2);
      }
      .aside-label {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--arena-text-faint);
      }
      .cards {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-3);
      }
      .player {
        display: flex;
        align-items: center;
        gap: var(--arena-space-3);
      }
      .player arena-agent-face {
        flex: 0 0 auto;
      }
      .player-body {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
      .player arena-player-card {
        width: 100%;
        min-width: 0;
      }
      .player-method {
        /* Keep the method chip small and secondary to the player card. */
        font-size: var(--arena-text-xs);
        opacity: 0.92;
      }

      /* ---- Footer ------------------------------------------------------- */
      .turn-indicator {
        display: inline-flex;
        align-items: center;
        gap: var(--arena-space-2);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-sm);
        color: var(--arena-text-muted);
      }
      .turn-indicator .seat-tag {
        padding: 1px 8px;
        border-radius: var(--arena-radius-sm);
        background: color-mix(in srgb, var(--seat) 18%, transparent);
        color: color-mix(in srgb, var(--seat) 74%, var(--arena-text));
        font-weight: 700;
      }
      .banner {
        display: flex;
        align-items: center;
        gap: var(--arena-space-3);
        padding: var(--arena-space-4) var(--arena-space-5);
        border-radius: var(--arena-radius-md);
        border: 1px solid var(--seat, var(--arena-border-strong));
        background: color-mix(in srgb, var(--seat, var(--arena-brand)) 12%, var(--arena-surface));
        font-weight: 700;
      }
      .banner .medal {
        font-size: var(--arena-text-xl);
      }

      /* ---- Centered states (connecting / error) ------------------------ */
      .centered {
        display: grid;
        place-items: center;
        min-height: 100vh;
        padding: var(--arena-space-5);
        background: var(--arena-bg);
      }
      .state-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--arena-space-4);
        max-width: 480px;
        padding: clamp(var(--arena-space-5), 5vw, var(--arena-space-7));
        text-align: center;
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-2);
      }
      .state-eyebrow {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--arena-text-muted);
      }
      .state-title {
        margin: 0;
        font-size: clamp(1.5rem, 4vw, 2rem);
        font-weight: 780;
        letter-spacing: -0.02em;
      }
      .state-body {
        margin: 0;
        color: var(--arena-text-muted);
        line-height: 1.55;
      }
      .state-id {
        font-family: var(--arena-font-mono);
        color: var(--arena-text);
      }
      .state-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--arena-space-3);
        justify-content: center;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: var(--arena-space-2);
        min-height: 44px;
        padding: 0 var(--arena-space-4);
        border-radius: var(--arena-radius-md);
        border: 1px solid transparent;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .btn.primary {
        background: var(--arena-brand);
        color: var(--arena-brand-ink);
      }
      .btn.primary:hover {
        filter: brightness(1.07);
      }
      .btn.ghost {
        background: var(--arena-surface);
        border-color: var(--arena-border-strong);
        color: var(--arena-text);
      }
      .btn.ghost:hover {
        border-color: var(--arena-brand);
      }

      /* ---- Hint chip ----------------------------------------------------- */
      .hint-chip {
        display: inline-flex;
        align-items: flex-start;
        gap: var(--arena-space-2);
        margin-top: var(--arena-space-2);
        padding: 4px var(--arena-space-3);
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--arena-warning) 16%, var(--arena-surface));
        color: color-mix(in srgb, var(--arena-warning) 72%, var(--arena-text));
        border: 1px solid color-mix(in srgb, var(--arena-warning) 38%, transparent);
        font-size: var(--arena-text-xs);
        font-weight: 600;
        line-height: 1.4;
        max-width: 100%;
      }
      .hint-icon {
        font-size: 0.9em;
        flex-shrink: 0;
      }

      /* ---- Join-request banner ------------------------------------------- */
      .join-banner {
        display: flex;
        align-items: center;
        gap: var(--arena-space-2);
        padding: var(--arena-space-2) var(--arena-space-3);
        margin-bottom: var(--arena-space-2);
        border-radius: var(--arena-radius-md);
        border: 1px solid color-mix(in srgb, var(--arena-brand) 38%, var(--arena-border));
        background: color-mix(in srgb, var(--arena-brand) 8%, var(--arena-surface));
        font-size: var(--arena-text-sm);
        font-weight: 600;
        color: var(--arena-text);
      }

      /* ---- Comments panel ------------------------------------------------ */
      .comments-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 400px;
        overflow-y: auto;
      }
      .comment-item {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px;
        padding: 2px 0;
        font-size: var(--arena-text-xs);
        line-height: 1.45;
        border-bottom: 1px solid var(--arena-border);
        padding-bottom: 6px;
      }
      .comment-item:last-child {
        border-bottom: none;
      }
      .comment-name {
        font-weight: 700;
        color: var(--arena-text);
      }
      .comment-seat {
        padding: 0 4px;
        border-radius: 2px;
        background: color-mix(in srgb, var(--seat) 20%, transparent);
        color: color-mix(in srgb, var(--seat) 74%, var(--arena-text));
        font-family: var(--arena-font-mono);
        font-size: 0.82em;
        font-weight: 700;
      }
      .comment-time {
        font-family: var(--arena-font-mono);
        font-size: 0.82em;
        color: var(--arena-text-faint);
        white-space: nowrap;
      }
      .comment-text {
        color: var(--arena-text-muted);
        word-break: break-word;
        width: 100%;
        margin-top: 2px;
      }
      .comments-empty {
        font-size: var(--arena-text-xs);
        color: var(--arena-text-faint);
        font-style: italic;
        padding: var(--arena-space-2) 0;
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Switched to a different room — tear down and let updated() restart.
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
    this._teardown();
  }

  /** Copy the join+play instructions for this room to the clipboard. */
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

  /**
   * The "hand this to your agents" panel: the copy-paste block that teaches an
   * agent to join this room and play it over HTTP. Shown while seats are open
   * (both agents can still join); collapses to a quieter state once full.
   */
  private _renderAgentPanel(view: WatchView) {
    const base = this._base || serverBase();
    const openSeats = (view.snapshot?.players ?? []).filter((p) => !p.connected).length;
    return html`
      <section class="agent-panel" aria-label="Play with your agents">
        <h3>🤖 Bring your agents</h3>
        <p>
          ${openSeats > 0
            ? html`${openSeats === 2
                ? 'Both seats are open.'
                : 'One seat is open.'}
              Paste these instructions into your ${openSeats === 2 ? 'two agents' : 'agent'} — they
              join and play this room over plain HTTP. First to join is X, the other O.`
            : html`Both seats are taken. These are the same instructions the agents used.`}
        </p>
        <div class="room-facts">
          <span>server <code>${base.replace(/^https?:\/\//, '')}</code></span>
          <span>room <code>${this.roomId}</code></span>
        </div>
        <div class="agent-actions">
          <button
            class=${this._copied ? 'btn ok' : 'btn primary'}
            type="button"
            @click=${this._copyInstructions}
          >
            ${this._copied ? '✓ Copied!' : 'Copy agent instructions'}
          </button>
          <a class="btn ghost" href=${skillUrl(base, this._gameId())} target="_blank" rel="noopener noreferrer">
            View skill
          </a>
        </div>
      </section>
    `;
  }

  private _start(): void {
    this._startedFor = this.roomId;
    this._methodsBySeat = new Map();
    const base = this.server || serverBase();
    this._base = base;
    this._controller = new WatchController(base, this.roomId, (view) => {
      this._ingestMethods(view);
      this._view = view;
    });
    this._view = this._controller.getView();
    this._controller.start();
  }

  private _teardown(): void {
    this._controller?.destroy();
    this._controller = null;
  }

  /**
   * Track the latest self-reported method per seat from the match report's
   * move list (and player-level method as a fallback). Snapshots alone do not
   * carry move meta, so chips appear once a report (or late fetch) arrives.
   */
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

  /** Narrow a snapshot's opaque `state` to tic-tac-toe board cells. */
  private _cells(snap: Snapshot | null): (string | null)[] {
    const state = snap?.state as Partial<TttState> | undefined;
    if (state && Array.isArray(state.board) && state.board.length === 9) {
      return state.board;
    }
    return new Array<string | null>(9).fill(null);
  }

  private _next(snap: Snapshot | null): string {
    const state = snap?.state as Partial<TttState> | undefined;
    return typeof state?.next === 'string' ? state.next : 'X';
  }

  /** The seats to show — real players if both seated, else the game's defaults. */
  private _seats(snap: Snapshot): string[] {
    if (snap.players.length >= 2) return snap.players.map((p) => p.seat);
    return DEFAULT_SEATS[snap.gameId] ?? ['X', 'O'];
  }

  /** Narrow a snapshot's opaque `state` to the chess wire shape. */
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

  /** The board for the room's game — every game renders its own component. */
  private _renderBoard(snap: Snapshot | null) {
    if (snap?.gameId === 'chess') {
      const chess = this._chess(snap);
      const lastSan = chess?.history[chess.history.length - 1] ?? '';
      return html`
        <arena-chess-board
          .fen=${chess?.fen ?? ''}
          .lastMove=${chess?.lastMove ?? null}
          .sanHistory=${chess?.history ?? []}
          ?check=${lastSan.endsWith('+') || lastSan.endsWith('#')}
        ></arena-chess-board>
      `;
    }
    return html`
      <ttt-watch-board .cells=${this._cells(snap)} next=${this._next(snap)}></ttt-watch-board>
    `;
  }

  /**
   * Which expression a seat's face wears. An explicitly emoted feeling wins
   * while the game is live; at the end the result takes over (winner celebrates,
   * loser slumps) so it stays expressive even if the agent went quiet. Mirrors
   * the P2P room's `_faceEmotion`.
   */
  private _faceEmotion(view: WatchView, seat: string): FaceEmotion {
    const result = view.snapshot?.result ?? null;
    if (result) {
      if (result.kind === 'win') return result.winner === seat ? 'celebrating' : 'defeated';
      return view.emotes[seat]?.emotion ?? 'worried';
    }
    const sent = view.emotes[seat]?.emotion;
    if (sent) return sent;
    const toMove = view.snapshot?.toMove ?? null;
    return toMove === seat ? 'thinking' : 'neutral';
  }

  /** Map the server MatchReport onto the shared component's view shape. */
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

  // ---- Render -------------------------------------------------------------

  private _renderComments(view: WatchView) {
    const comments = view.comments;
    return html`
      <div class="aside-group">
        <span class="aside-label">Comments</span>
        ${comments.length === 0
          ? html`<p class="comments-empty">No comments yet — agents and named viewers can comment.</p>`
          : html`<div class="comments-list" id="comments-list">
              ${comments.map((c) => {
                const seatIdx = c.seat ? seatColorIndex(c.seat) : -1;
                const seatVar = seatIdx >= 0 ? `--seat: var(--arena-seat-${seatIdx})` : '';
                return html`
                  <div class="comment-item">
                    <span class="comment-name">${c.name}</span>
                    ${c.seat
                      ? html`<span class="comment-seat" style=${seatVar}>${c.seat}</span>`
                      : nothing}
                    <span class="comment-time">${new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span class="comment-text">${c.text}</span>
                  </div>
                `;
              })}
          </div>`}
      </div>
    `;
  }

  private _renderHintChip(snap: Snapshot | null) {
    const hints = snap?.hints;
    if (!hints || hints.length === 0) return nothing;
    return html`
      <div class="hint-chip" title=${hints.join('\n')}>
        <span class="hint-icon">⚡</span>
        <span>${hints[0]}</span>
      </div>
    `;
  }

  private _renderJoinRequestBanner(view: WatchView) {
    const jr = view.joinRequest;
    if (!jr) return nothing;
    return html`
      <div class="join-banner">
        ⟳ <strong>${jr.name}</strong> asks to take the <strong>${jr.seat}</strong> seat — the seated player must approve
      </div>
    `;
  }

  private _autoScrollComments(): void {
    if (!this._view) return;
    const count = this._view.comments.length;
    if (count !== this._priorCommentCount) {
      this._priorCommentCount = count;
      if (count === 0) return;
      requestAnimationFrame(() => {
        const el = this.renderRoot.querySelector('#comments-list') as HTMLElement | null;
        if (el) {
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (atBottom || this._priorCommentCount === 0) {
            el.scrollTop = el.scrollHeight;
          }
        }
      });
    }
  }

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
          <span class="state-eyebrow">Can't watch this room</span>
          <h1 class="state-title">Room unavailable</h1>
          <p class="state-body">${view.error ?? 'Something went wrong while connecting.'}</p>
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
    const gameName = (snap && GAME_NAMES[snap.gameId]) || snap?.gameId || 'Match';
    const live = snap?.result == null && view.connection !== 'closed';
    return html`
      <arena-room-frame>
        <div class="room-header" slot="header">
          <a class="back" href=${landingHash()} aria-label="Back to start">← Arena</a>
          <h1 class="room-title">${gameName}</h1>
          <arena-badge variant="neutral">Spectating</arena-badge>
          ${live
            ? html`<arena-badge variant="danger">Live</arena-badge>`
            : snap?.result != null
              ? html`<arena-badge>Final</arena-badge>`
              : nothing}
          ${view.snapshot?.reasoning
            ? html`<arena-reasoning-badge mode=${view.snapshot.reasoning}></arena-reasoning-badge>`
            : nothing}
          <arena-connection-status phase=${view.connection}></arena-connection-status>
          <span class="header-spacer"></span>
          <arena-badge>room <span class="room-id">${this.roomId}</span></arena-badge>
        </div>

        <div class="board-mount" slot="board">
          ${this._renderBoard(snap)}
          ${this._renderHintChip(snap)}
        </div>

        <div slot="aside">
          ${this._renderAgentPanel(view)}

          <div class="aside-group">
            <span class="aside-label">Players</span>
            <div class="cards">${snap ? this._renderPlayers(view, snap) : nothing}</div>
          </div>

          ${this._renderComments(view)}

          ${view.report
            ? html`<div class="aside-group">
                <span class="aside-label">Match report</span>
                <arena-match-report .report=${this._reportData(view.report)}></arena-match-report>
              </div>`
            : nothing}
        </div>

        <div slot="footer">
          ${this._renderJoinRequestBanner(view)}
          ${this._renderFooter(view)}
        </div>
      </arena-room-frame>
    `;
  }

  private _renderPlayers(view: WatchView, snap: Snapshot) {
    const seats = this._seats(snap);
    const toMove = snap.toMove ?? null;
    const hasResult = snap.result != null;
    return seats.map((seat) => {
      const player = snap.players.find((p) => p.seat === seat);
      const status = this._seatStatus(player);
      const name = status === 'waiting' ? 'Open seat' : player?.name || 'Agent';
      const emote = view.emotes[seat];
      const method = this._methodsBySeat.get(seat);
      return html`
        <div class="player">
          <arena-agent-face
            emotion=${this._faceEmotion(view, seat)}
            seat=${seat}
            note=${emote?.note ?? ''}
            .size=${84}
          ></arena-agent-face>
          <div class="player-body">
            <arena-player-card
              name=${name}
              seat=${seat}
              status=${status}
              ?active=${!hasResult && toMove === seat}
            ></arena-player-card>
            ${method
              ? html`<span class="player-method"
                  ><arena-method-chip method=${method}></arena-method-chip
                ></span>`
              : nothing}
          </div>
        </div>
      `;
    });
  }

  /**
   * Map the server's seat status to the player-card's dot state. Falls back to
   * the `connected` flag for older servers that don't send `status`.
   */
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

  private _renderFooter(view: WatchView) {
    const snap = view.snapshot;
    const result = snap?.result ?? null;
    if (result) {
      if (result.kind === 'draw') {
        return html`<div class="banner"><span class="medal">🤝</span> It's a draw.</div>`;
      }
      const winner = result.winner ?? '';
      const seatVar = `--arena-seat-${seatColorIndex(winner)}`;
      const winnerName = snap?.players.find((p) => p.seat === winner)?.name || winner;
      return html`<div class="banner" style=${`--seat: var(${seatVar})`}>
        <span class="medal">🏆</span> ${winnerName} wins!
      </div>`;
    }

    const toMove = snap?.toMove;
    if (toMove) {
      const seatVar = `--arena-seat-${seatColorIndex(toMove)}`;
      return html`<span class="turn-indicator" style=${`--seat: var(${seatVar})`}>
        on the clock <span class="seat-tag">${toMove}</span>
      </span>`;
    }
    return html`<span class="turn-indicator">Waiting for the first move…</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-watch-page': ArenaWatchPage;
  }
}
