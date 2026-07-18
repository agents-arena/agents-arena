import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from './theme.js';
import './method-chip.js';

/** One row in the standings / leaderboard table. */
export interface LeaderRow {
  /** 1-based rank. */
  rank: number;
  /** Competitor display name. */
  name: string;
  /** Model id / label. */
  model: string;
  /** Games played. */
  games: number;
  /** Wins. */
  wins: number;
  /** Losses. */
  losses: number;
  /** Draws. */
  draws: number;
  /** Win percentage in [0, 100] (or 0–1 — values ≤ 1 are treated as fractions). */
  winPct: number;
  /** Average think time in milliseconds. */
  avgThink: number;
  /** Most-used self-reported method, if known. */
  topMethod?: string;
}

/** Format avg think time: "850ms", "1.2s", "1m 03s". */
function formatThink(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

/** Format win% — accepts 0–1 fractions or 0–100 percentages. */
function formatWinPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

/**
 * Clean standings table: rank, competitor, games, W-L-D, win%, avg think,
 * top-method chip. Sticky header + horizontal scroll on narrow viewports.
 */
@customElement('arena-leaderboard-table')
export class ArenaLeaderboardTable extends LitElement {
  /** Ordered standings rows. */
  @property({ attribute: false }) rows: LeaderRow[] = [];

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
        color: var(--arena-text);
      }

      .scroll {
        overflow-x: auto;
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
        scrollbar-width: thin;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--arena-text-sm);
        min-width: 640px;
      }

      thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: var(--arena-space-2) var(--arena-space-3);
        text-align: right;
        font-size: var(--arena-text-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--arena-text-faint);
        background: var(--arena-surface-2);
        border-bottom: 1px solid var(--arena-border);
        white-space: nowrap;
      }
      thead th.rank,
      thead th.competitor,
      thead th.method {
        text-align: left;
      }

      tbody td {
        padding: var(--arena-space-2) var(--arena-space-3);
        text-align: right;
        vertical-align: middle;
        border-top: 1px solid var(--arena-border);
        font-variant-numeric: tabular-nums;
        font-family: var(--arena-font-mono);
        color: var(--arena-text);
        white-space: nowrap;
      }
      tbody tr:first-child td {
        border-top: none;
      }
      tbody tr:hover td {
        background: color-mix(in srgb, var(--arena-brand) 5%, transparent);
      }

      td.rank {
        text-align: left;
        font-weight: 700;
        color: var(--arena-text-muted);
        width: 3ch;
      }
      td.competitor {
        text-align: left;
        font-family: var(--arena-font-sans);
      }
      td.method {
        text-align: left;
      }

      .who {
        display: flex;
        flex-direction: column;
        line-height: 1.25;
        min-width: 0;
        gap: 1px;
      }
      .who .n {
        font-weight: 600;
        color: var(--arena-text);
      }
      .who .m {
        font-size: var(--arena-text-xs);
        color: var(--arena-text-muted);
        font-family: var(--arena-font-mono);
      }

      .wld {
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
      }
      .wld .w {
        color: var(--arena-success);
        font-weight: 700;
      }
      .wld .l {
        color: var(--arena-danger);
        font-weight: 700;
      }
      .wld .d {
        color: var(--arena-text-muted);
        font-weight: 600;
      }
      .wld .sep {
        color: var(--arena-text-faint);
        margin: 0 1px;
      }

      .empty {
        margin: 0;
        padding: var(--arena-space-6) var(--arena-space-3);
        text-align: center;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
      }
    `,
  ];

  protected override render() {
    if (this.rows.length === 0) {
      return html`<p class="empty">No standings yet.</p>`;
    }
    return html`
      <div class="scroll" role="region" aria-label="Leaderboard">
        <table>
          <thead>
            <tr>
              <th class="rank" scope="col">#</th>
              <th class="competitor" scope="col">Competitor</th>
              <th scope="col">Games</th>
              <th scope="col">W-L-D</th>
              <th scope="col">Win%</th>
              <th scope="col">Avg think</th>
              <th class="method" scope="col">Top method</th>
            </tr>
          </thead>
          <tbody>
            ${this.rows.map(
              (r) => html`
                <tr>
                  <td class="rank">${r.rank}</td>
                  <td class="competitor">
                    <div class="who">
                      <span class="n">${r.name}</span>
                      <span class="m">${r.model}</span>
                    </div>
                  </td>
                  <td>${r.games}</td>
                  <td class="wld">
                    <span class="w">${r.wins}</span><span class="sep">-</span
                    ><span class="l">${r.losses}</span><span class="sep">-</span
                    ><span class="d">${r.draws}</span>
                  </td>
                  <td>${formatWinPct(r.winPct)}</td>
                  <td>${formatThink(r.avgThink)}</td>
                  <td class="method">
                    ${r.topMethod
                      ? html`<arena-method-chip method=${r.topMethod}></arena-method-chip>`
                      : nothing}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-leaderboard-table': ArenaLeaderboardTable;
  }
}
