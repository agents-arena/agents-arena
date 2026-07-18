import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import { arenaTokens, resetStyles, seatColorIndex } from '@agents-arena/ui';
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
 * Archived match detail: full match report plus a read-only comments list.
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
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--arena-bg);
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
      }

      .page {
        max-width: 900px;
        margin-inline: auto;
        padding: clamp(var(--arena-space-4), 4vw, var(--arena-space-7));
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-5);
      }

      .header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-3);
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
      .title {
        margin: 0;
        font-size: var(--arena-text-xl);
        font-weight: 780;
        letter-spacing: -0.02em;
      }
      .room-id {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-sm);
        color: var(--arena-text-faint);
      }

      .section {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-3);
      }
      .section-label {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--arena-text-faint);
      }

      /* Comments — reused from watch.ts */
      .comments-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 400px;
        overflow-y: auto;
        padding: var(--arena-space-3);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
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

      /* Centered states — match watch.ts pattern */
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
            <a class="btn ghost" href=${archiveHash()}>Back to history</a>
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
          <a class="back" href=${archiveHash()} aria-label="Back to match history">← History</a>
          <h1 class="title">Match report</h1>
          <span class="room-id">${this.roomId}</span>
        </header>

        <section class="section">
          <arena-match-report .report=${reportData}></arena-match-report>
        </section>

        <section class="section" aria-label="Comments">
          <span class="section-label">Comments</span>
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
