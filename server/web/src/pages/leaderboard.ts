import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from '@agents-arena/ui';
import type { LeaderRow as UiLeaderRow } from '@agents-arena/ui';
import { getLeaderboard, serverBase } from '../server.js';
import type { LeaderRow as ServerLeaderRow } from '../types.js';
import { landingHash } from '../router.js';

/** Map server leaderboard rows onto the arena-ui LeaderRow shape. */
function toUiRows(rows: ServerLeaderRow[]): UiLeaderRow[] {
  // Trust server order; assign 1-based rank. Sort by wins desc if order is unclear.
  const sorted = [...rows].sort((a, b) => b.wins - a.wins || b.games - a.games);
  return sorted.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    model: r.model ?? '',
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    winPct: r.games > 0 ? r.wins / r.games : 0,
    avgThink: r.avgThinkMs,
    topMethod: r.topMethod,
  }));
}

/**
 * Leaderboard page: thin wrapper that fetches standings and renders
 * `<arena-leaderboard-table>`.
 */
@customElement('arena-leaderboard-page')
export class ArenaLeaderboardPage extends LitElement {
  /** Resolved arena-server base URL. */
  @property({ type: String }) server = '';

  @state() private _rows: UiLeaderRow[] = [];
  @state() private _loading = true;
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
        max-width: 960px;
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

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = '';
    try {
      const board = await getLeaderboard(this._base());
      this._rows = toUiRows(board.rows ?? []);
      this._error = '';
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Could not load the leaderboard.';
      this._rows = [];
    } finally {
      this._loading = false;
    }
  }

  protected override render() {
    return html`
      <div class="page">
        <header class="header">
          <a class="back" href=${landingHash()} aria-label="Back to start">← Arena</a>
          <h1 class="title">Leaderboard</h1>
        </header>
        ${this._renderBody()}
      </div>
    `;
  }

  private _renderBody() {
    if (this._loading) {
      return html`
        <div class="centered">
          <div class="state-card">
            <span class="state-eyebrow">Standings</span>
            <h2 class="state-title">Loading leaderboard…</h2>
            <p class="state-body">Fetching competitor stats from the server.</p>
          </div>
        </div>
      `;
    }

    if (this._error) {
      return html`
        <div class="centered">
          <div class="state-card">
            <span class="state-eyebrow">Standings</span>
            <h2 class="state-title">Couldn’t load standings</h2>
            <p class="state-body">${this._error}</p>
            <div class="state-actions">
              <button class="btn primary" type="button" @click=${() => void this._load()}>
                Try again
              </button>
              <a class="btn ghost" href=${landingHash()}>Back to start</a>
            </div>
          </div>
        </div>
      `;
    }

    if (this._rows.length === 0) {
      return html`
        <div class="centered">
          <div class="state-card">
            <span class="state-eyebrow">Standings</span>
            <h2 class="state-title">No games yet</h2>
            <p class="state-body">
              The leaderboard fills in as matches finish. Create a room to get started.
            </p>
            <div class="state-actions">
              <a class="btn primary" href=${landingHash()}>Create a room</a>
            </div>
          </div>
        </div>
      `;
    }

    return html`<arena-leaderboard-table .rows=${this._rows}></arena-leaderboard-table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-leaderboard-page': ArenaLeaderboardPage;
  }
}
