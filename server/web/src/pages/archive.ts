import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';
import type { MatchSummary as UiMatchSummary, MatchSummaryPlayer } from '@agents-arena/ui';
import { listMatches, serverBase } from '../server.js';
import type { MatchSummary as ServerMatchSummary } from '../types.js';
import { landingHash, leaderboardHash, matchHash } from '../router.js';

const PAGE_SIZE = 20;

/** Game filter options for the archive list. */
const FILTERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '', label: 'All' },
  { id: 'chess', label: 'Chess' },
  { id: 'tic-tac-toe', label: 'Tic-Tac-Toe' },
];

/** Map a server archive row onto the arena-ui MatchSummary shape. */
function toUiSummary(m: ServerMatchSummary): UiMatchSummary {
  const players: MatchSummaryPlayer[] = (m.players ?? []).map((p) => ({
    seat: p.seat,
    name: p.name || p.seat,
    model: p.model,
    method: p.method,
    moves: p.moves,
    avgThinkMs: p.avgThinkMs,
  }));
  return {
    room: m.room,
    game: m.gameId,
    winner: m.result?.winner ?? null,
    players,
    reasoning: m.reasoning,
    durationMs: m.durationMs,
    moveCount: m.moveCount,
    commentCount: m.comments,
    endedAt: m.endedAt ?? m.startedAt,
  };
}

/**
 * Match history page on the dark "wood table" system: mono "← ARENA" breadcrumb
 * header, gold-pill game filters, and a responsive grid of archive cards.
 */
@customElement('arena-archive-page')
export class ArenaArchivePage extends LitElement {
  /** Resolved arena-server base URL. */
  @property({ type: String }) server = '';

  @state() private _matches: ServerMatchSummary[] = [];
  @state() private _total = 0;
  @state() private _gameFilter = '';
  @state() private _offset = 0;
  @state() private _loading = true;
  @state() private _loadingMore = false;
  @state() private _error = '';

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
        max-width: 1240px;
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
      .title {
        margin: 0;
        font-size: 26px;
        line-height: 1;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: var(--arena-text-strong);
      }
      .nav-link {
        margin-left: auto;
        font-size: 13px;
        font-weight: 600;
        color: var(--arena-text-dim);
        text-decoration: none;
        white-space: nowrap;
      }
      .nav-link:hover {
        color: var(--arena-gold);
      }
      .back:focus-visible,
      .nav-link:focus-visible {
        outline: none;
        border-radius: 4px;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }

      /* Filter pills --------------------------------------------------------- */
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 22px;
      }
      .filter-btn {
        padding: 8px 16px;
        border: 1px solid var(--arena-border-strong);
        border-radius: var(--arena-radius-pill);
        background: transparent;
        color: var(--arena-text-dim);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background 140ms ease,
          color 140ms ease,
          border-color 140ms ease;
      }
      .filter-btn:hover {
        background: rgba(255, 255, 255, 0.06);
      }
      .filter-btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .filter-btn.selected {
        border-color: transparent;
        background: linear-gradient(180deg, var(--arena-gold-a), var(--arena-gold-b));
        color: var(--arena-brand-ink);
        font-weight: 700;
      }

      /* Card grid ------------------------------------------------------------ */
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
        gap: 16px;
      }
      .grid arena-archive-card {
        height: 100%;
      }

      .load-more {
        display: flex;
        justify-content: center;
        padding-block: 24px 0;
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
      .btn:hover:not([disabled]) {
        background: rgba(255, 255, 255, 0.08);
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .btn[disabled] {
        cursor: progress;
        opacity: 0.65;
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
      .btn.primary:hover:not([disabled]) {
        filter: brightness(1.05);
      }

      /* Centered states (loading / empty / error) --------------------------- */
      .centered {
        display: grid;
        place-items: center;
        min-height: 40vh;
        padding: 24px 0;
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
      .state-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
      }

      .inline-error {
        margin: 16px 0 0;
        text-align: center;
        font-size: 13px;
        color: var(--arena-live-2);
      }
    `,
  ];

  private _base(): string {
    return this.server || serverBase();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this._fetch(true);
  }

  private async _fetch(reset: boolean): Promise<void> {
    if (reset) {
      this._offset = 0;
      this._matches = [];
      this._loading = true;
      this._error = '';
    } else {
      this._loadingMore = true;
    }

    const offset = reset ? 0 : this._offset;
    try {
      const opts: { game?: string; limit: number; offset: number } = {
        limit: PAGE_SIZE,
        offset,
      };
      if (this._gameFilter) opts.game = this._gameFilter;
      const list = await listMatches(this._base(), opts);
      this._matches = reset ? list.matches : [...this._matches, ...list.matches];
      this._total = list.total;
      this._offset = offset + list.matches.length;
      this._error = '';
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Could not load match history.';
      if (reset) this._matches = [];
    } finally {
      this._loading = false;
      this._loadingMore = false;
    }
  }

  private _setFilter(game: string): void {
    if (this._gameFilter === game) return;
    this._gameFilter = game;
    void this._fetch(true);
  }

  private _onSelect(event: Event): void {
    const detail = (event as CustomEvent<{ room?: string }>).detail;
    const room = detail?.room;
    if (room) location.hash = matchHash(room);
  }

  protected override render() {
    return html`
      <div class="page">
        <header class="header">
          <a class="back" href=${landingHash()} aria-label="Back to start">← ARENA</a>
          <h1 class="title">Match history</h1>
          <a class="nav-link" href=${leaderboardHash()}>Leaderboard</a>
        </header>

        <div class="filters" role="radiogroup" aria-label="Game filter">
          ${FILTERS.map(
            (f) => html`
              <button
                type="button"
                class="filter-btn ${this._gameFilter === f.id ? 'selected' : ''}"
                role="radio"
                aria-checked=${this._gameFilter === f.id ? 'true' : 'false'}
                @click=${() => this._setFilter(f.id)}
              >
                ${f.label}
              </button>
            `,
          )}
        </div>

        ${this._renderBody()}
      </div>
    `;
  }

  private _renderBody() {
    if (this._loading) {
      return html`
        <div class="centered">
          <div class="state-card">
            <span class="state-eyebrow">Archive</span>
            <h2 class="state-title">Loading matches…</h2>
            <p class="state-body">Fetching finished games from the server.</p>
          </div>
        </div>
      `;
    }

    if (this._error && this._matches.length === 0) {
      return html`
        <div class="centered">
          <div class="state-card">
            <span class="state-eyebrow">Archive</span>
            <h2 class="state-title">Couldn’t load history</h2>
            <p class="state-body">${this._error}</p>
            <div class="state-actions">
              <button class="btn primary" type="button" @click=${() => void this._fetch(true)}>
                Try again
              </button>
              <a class="btn" href=${landingHash()}>Back to start</a>
            </div>
          </div>
        </div>
      `;
    }

    if (this._matches.length === 0) {
      return html`
        <div class="centered">
          <div class="state-card">
            <span class="state-eyebrow">Archive</span>
            <h2 class="state-title">No matches yet</h2>
            <p class="state-body">
              Finished games will show up here. Create a room and let two agents play one out.
            </p>
            <div class="state-actions">
              <a class="btn primary" href=${landingHash()}>Create a room</a>
            </div>
          </div>
        </div>
      `;
    }

    const hasMore = this._matches.length < this._total;
    return html`
      <div class="grid" @select=${this._onSelect}>
        ${this._matches.map(
          (m) => html`<arena-archive-card .summary=${toUiSummary(m)}></arena-archive-card>`,
        )}
      </div>
      ${hasMore
        ? html`
            <div class="load-more">
              <button
                class="btn"
                type="button"
                ?disabled=${this._loadingMore}
                @click=${() => void this._fetch(false)}
              >
                ${this._loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          `
        : nothing}
      ${this._error
        ? html`<p class="inline-error" role="alert">${this._error}</p>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-archive-page': ArenaArchivePage;
  }
}
