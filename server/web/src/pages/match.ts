import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import { arenaTokens, resetStyles, arenaKeyframes, seatColorIndex } from '@agents-arena/ui';
import type { MatchReportData, ReportMoveView, ReportPlayerView } from '@agents-arena/ui';
import { getMatch, serverBase } from '../server.js';
import type { ArchivedMatch, Comment, MatchReport } from '../types.js';
import { archiveHash } from '../router.js';

/** Map a server MatchReport onto the shared component's view shape. */
function toReportData(r: MatchReport): MatchReportData {
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
    reasoning: r.reasoning,
  };
}

/**
 * Archived match detail on the dark "wood table" system: mono "← HISTORY"
 * breadcrumb header with the room id, the full match report, and the
 * read-only COMMENTS section beneath.
 */
@customElement('arena-match-page')
export class ArenaMatchPage extends LitElement {
  /** Resolved arena-server base URL. */
  @property({ type: String }) server = '';
  /** Archived room id. */
  @property({ type: String }) roomId = '';

  @state() private _data: ArchivedMatch | null = null;
  @state() private _loading = true;
  @state() private _error = '';
  private _fetchedFor: string | null = null;

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--arena-bg-wash);
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
      }

      .page {
        max-width: 980px;
        margin-inline: auto;
        padding: clamp(16px, 3vw, 26px) clamp(14px, 4vw, 40px) 120px;
      }
      @media (prefers-reduced-motion: no-preference) {
        .page {
          animation: aa-rise 0.45s ease both;
        }
      }

      /* Header ------------------------------------------------------------- */
      .header {
        display: flex;
        flex-wrap: wrap;
        row-gap: 10px;
        align-items: center;
        gap: 14px;
        margin-bottom: 26px;
      }
      .back {
        font-family: var(--arena-font-mono);
        font-size: 13px;
        font-weight: 600;
        color: var(--arena-text-label);
        text-decoration: none;
        white-space: nowrap;
      }
      .back:hover {
        color: var(--arena-gold);
      }
      .back:focus-visible {
        outline: none;
        border-radius: 4px;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .title {
        margin: 0;
        font-size: 26px;
        line-height: 1;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: var(--arena-text-strong);
      }
      .room-id {
        font-family: var(--arena-font-mono);
        font-size: 12px;
        font-weight: 600;
        color: var(--arena-text-faint);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Comments ------------------------------------------------------------- */
      .comments {
        margin-top: 22px;
      }
      .comments-label {
        margin: 0 0 8px;
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--arena-text-faint);
      }
      .comments-empty {
        margin: 0;
        font-size: 12.5px;
        font-style: italic;
        color: var(--arena-text-faint);
      }
      .comments-list {
        display: flex;
        flex-direction: column;
        max-height: 420px;
        overflow-y: auto;
        border: 1px solid var(--arena-border);
        border-radius: 16px;
        background: var(--arena-surface);
        scrollbar-width: thin;
      }
      .comment-item {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 8px;
        padding: 11px 16px;
        font-size: 12.5px;
        line-height: 1.45;
      }
      .comment-item + .comment-item {
        border-top: 1px solid rgba(255, 255, 255, 0.045);
      }
      .comment-name {
        font-weight: 700;
        color: var(--arena-text-strong);
      }
      .comment-seat {
        padding: 0 5px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--seat) 20%, transparent);
        color: color-mix(in srgb, var(--seat) 74%, var(--arena-text));
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .comment-time {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        color: var(--arena-text-faint);
        white-space: nowrap;
      }
      .comment-text {
        width: 100%;
        margin-top: 2px;
        color: var(--arena-text-muted);
        word-break: break-word;
      }

      /* Centered states -------------------------------------------------------- */
      .centered {
        display: grid;
        place-items: center;
        min-height: 92vh;
        padding: 40px;
      }
      .state-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        max-width: 520px;
        padding: clamp(24px, 6vw, 44px) clamp(20px, 7vw, 56px);
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 22px;
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-3);
      }
      @media (prefers-reduced-motion: no-preference) {
        .state-card {
          animation: aa-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
        }
      }
      .state-eyebrow {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.22em;
        color: var(--arena-text-label);
      }
      .state-title {
        margin: 0;
        font-size: clamp(1.4rem, 4vw, 1.9rem);
        font-weight: 800;
        letter-spacing: -0.02em;
        color: var(--arena-text-strong);
      }
      .state-body {
        margin: 0;
        color: var(--arena-text-muted);
        font-size: 14px;
        line-height: 1.55;
      }
      .state-id {
        font-family: var(--arena-font-mono);
        color: var(--arena-text);
        text-transform: none;
        letter-spacing: normal;
      }
      .state-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 44px;
        padding: 9px 16px;
        border-radius: 9px;
        border: 1px solid var(--arena-border-strong);
        background: rgba(255, 255, 255, 0.04);
        color: var(--arena-text);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        transition: background 140ms ease;
      }
      .btn:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .btn.primary {
        border-color: transparent;
        background: linear-gradient(180deg, var(--arena-gold-a), var(--arena-gold-b));
        color: var(--arena-brand-ink);
        font-weight: 700;
        box-shadow:
          0 6px 18px rgba(232, 184, 75, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.45);
      }
      .btn.primary:hover {
        filter: brightness(1.05);
      }
    `,
  ];

  private _base(): string {
    return this.server || serverBase();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('roomId') && this._fetchedFor !== null && this._fetchedFor !== this.roomId) {
      this._data = null;
      this._fetchedFor = null;
      this._error = '';
    }
  }

  protected override updated(): void {
    if (this.roomId && this._fetchedFor !== this.roomId) {
      void this._load();
    }
  }

  private async _load(): Promise<void> {
    const id = this.roomId;
    this._fetchedFor = id;
    this._loading = true;
    this._error = '';
    this._data = null;
    try {
      this._data = await getMatch(this._base(), id);
      this._error = '';
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Could not load this match.';
      this._data = null;
    } finally {
      this._loading = false;
    }
  }

  protected override render() {
    if (this._loading) return this._renderLoading();
    if (this._error || !this._data) return this._renderError();
    return this._renderMatch(this._data);
  }

  private _renderLoading() {
    return html`
      <div class="centered">
        <div class="state-card">
          <span class="state-eyebrow">Room <span class="state-id">${this.roomId}</span></span>
          <h1 class="state-title">Loading match…</h1>
          <p class="state-body">Fetching the archived report and comments.</p>
        </div>
      </div>
    `;
  }

  private _renderError() {
    return html`
      <div class="centered">
        <div class="state-card">
          <span class="state-eyebrow">Archived match</span>
          <h1 class="state-title">Match unavailable</h1>
          <p class="state-body">${this._error || 'No report found for this room.'}</p>
          <div class="state-actions">
            <button class="btn primary" type="button" @click=${() => void this._load()}>
              Try again
            </button>
            <a class="btn" href=${archiveHash()}>Back to history</a>
          </div>
        </div>
      </div>
    `;
  }

  private _renderMatch(data: ArchivedMatch) {
    const reportData = toReportData(data.report);
    return html`
      <div class="page">
        <header class="header">
          <a class="back" href=${archiveHash()} aria-label="Back to match history">← HISTORY</a>
          <h1 class="title">Match report</h1>
          <span class="room-id">${this.roomId}</span>
        </header>

        <arena-match-report .report=${reportData}></arena-match-report>

        <section class="comments" aria-label="Comments">
          <h2 class="comments-label">Comments</h2>
          ${this._renderComments(data.comments)}
        </section>
      </div>
    `;
  }

  private _renderComments(comments: Comment[] | null | undefined) {
    const list = comments ?? [];
    if (list.length === 0) {
      return html`<p class="comments-empty">No comments on this match.</p>`;
    }
    return html`
      <div class="comments-list">
        ${list.map((c) => {
          const seatIdx = c.seat ? seatColorIndex(c.seat) : -1;
          const seatVar = seatIdx >= 0 ? `--seat: var(--arena-seat-${seatIdx})` : '';
          return html`
            <div class="comment-item">
              <span class="comment-name">${c.name}</span>
              ${c.seat ? html`<span class="comment-seat" style=${seatVar}>${c.seat}</span>` : nothing}
              <span class="comment-time"
                >${new Date(c.ts).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}</span
              >
              <span class="comment-text">${c.text}</span>
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-match-page': ArenaMatchPage;
  }
}
