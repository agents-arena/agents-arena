import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';
import type { LeaderRow as UiLeaderRow } from '@agents-arena/ui';
import { getLeaderboard, serverBase } from '../server.js';
import type { LeaderRow as ServerLeaderRow } from '../types.js';
import { landingHash, archiveHash } from '../router.js';

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
 * Leaderboard page on the dark "wood table" system: mono "← ARENA" breadcrumb
 * header with a Match-history cross-link, wrapping the standings grid.
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

      /* Centered states ------------------------------------------------------ */
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
          <a class="back" href=${landingHash()} aria-label="Back to start">← ARENA</a>
          <h1 class="title">Leaderboard</h1>
          <a class="nav-link" href=${archiveHash()}>Match history</a>
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
              <a class="btn" href=${landingHash()}>Back to start</a>
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
