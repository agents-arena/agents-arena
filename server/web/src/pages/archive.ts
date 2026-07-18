import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from '@agents-arena/ui';
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
 * Match history page: lists archived matches with a game filter, pagination,
 * and navigation into a single archived-match view.
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
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--arena-bg);
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
      }

      .page {
        max-width: 1100px;
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
      .header-spacer {
        flex: 1 1 auto;
      }
      .nav-link {
        color: var(--arena-text-muted);
        text-decoration: none;
        font-size: var(--arena-text-sm);
        font-weight: 600;
      }
      .nav-link:hover {
        color: var(--arena-brand);
      }

      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--arena-space-2);
      }
      .filter-btn {
        min-height: 36px;
        padding: 0 var(--arena-space-4);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-pill);
        background: var(--arena-surface);
        color: var(--arena-text-muted);
        font: inherit;
        font-size: var(--arena-text-sm);
        font-weight: 650;
        cursor: pointer;
        transition:
          border-color 140ms ease,
          background 140ms ease,
          color 140ms ease;
      }
      .filter-btn:hover {
        border-color: var(--arena-border-strong);
        color: var(--arena-text);
      }
      .filter-btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .filter-btn.selected {
        border-color: var(--arena-brand);
        background: color-mix(in srgb, var(--arena-brand) 10%, var(--arena-surface));
        color: var(--arena-text);
        box-shadow: inset 0 0 0 1px var(--arena-brand);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
        gap: var(--arena-space-4);
      }

      .load-more {
        display: flex;
        justify-content: center;
        padding-block: var(--arena-space-2);
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--arena-space-2);
        min-height: 44px;
        padding: 0 var(--arena-space-5);
        border-radius: var(--arena-radius-md);
        border: 1px solid var(--arena-border-strong);
        background: var(--arena-surface);
        color: var(--arena-text);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .btn:hover:not([disabled]) {
        border-color: var(--arena-brand);
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .btn[disabled] {
        cursor: progress;
        opacity: 0.65;
      }

      /* Centered states (loading / empty / error) — match watch.ts pattern */
      .centered {
        display: grid;
        place-items: center;
        min-height: 40vh;
        padding: var(--arena-space-5);
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
      .state-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--arena-space-3);
        justify-content: center;
      }
      .btn.primary {
        background: var(--arena-brand);
        color: var(--arena-brand-ink);
        border-color: transparent;
      }
      .btn.primary:hover:not([disabled]) {
        filter: brightness(1.07);
      }
      .btn.ghost {
        background: var(--arena-surface);
        border-color: var(--arena-border-strong);
        color: var(--arena-text);
        text-decoration: none;
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
          <a class="back" href=${landingHash()} aria-label="Back to start">← Arena</a>
          <h1 class="title">Match history</h1>
          <span class="header-spacer"></span>
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
              <a class="btn ghost" href=${landingHash()}>Back to start</a>
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
        ? html`<p class="state-body" role="alert" style="text-align:center">${this._error}</p>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-archive-page': ArenaArchivePage;
  }
}
