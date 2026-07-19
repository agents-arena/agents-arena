import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from './theme.js';
import './method-chip.js';
import './agent-avatar.js';

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

/** Normalise win% to a 0–100 number — accepts 0–1 fractions or 0–100 percentages. */
function winPct100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

/** Format win% — accepts 0–1 fractions or 0–100 percentages. */
function formatWinPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${winPct100(n).toFixed(1)}%`;
}

/**
 * The dark standings grid: # / competitor (robot avatar + name) / games /
 * W-L-D (green·red·grey) / win% progress bar / avg think / top-method chip.
 * Rank 1 gets a gold left-wash and a gold win% bar; everyone else's bar is
 * teal. Scrolls horizontally inside its own container on narrow viewports.
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
        border-radius: 18px;
        background: var(--arena-surface);
        scrollbar-width: thin;
      }
      .scroll:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }

      .grid-row {
        display: grid;
        min-width: 780px;
        grid-template-columns: 52px minmax(180px, 1fr) 90px 120px 170px 110px 120px;
        align-items: center;
        padding: 14px 20px;
      }

      .head {
        padding: 13px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.18em;
        color: var(--arena-text-faint);
      }

      .row {
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        transition: background 140ms ease;
      }
      .row:last-child {
        border-bottom: none;
      }
      .row:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      /* Rank-1 gold left-wash. */
      .row.first {
        background: linear-gradient(90deg, rgba(232, 184, 75, 0.07), transparent 40%);
      }
      .row.first:hover {
        background:
          linear-gradient(90deg, rgba(232, 184, 75, 0.07), transparent 40%),
          rgba(255, 255, 255, 0.03);
      }

      .right {
        text-align: right;
      }

      .rank {
        font-family: var(--arena-font-mono);
        font-size: 14px;
        font-weight: 800;
        color: var(--arena-text-dim);
      }
      .row.first .rank {
        color: var(--arena-gold);
      }

      .who {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .who arena-agent-avatar {
        flex: none;
      }
      .who .n {
        font-size: 14px;
        font-weight: 700;
        color: #f2ecdf;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .games {
        font-family: var(--arena-font-mono);
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: #d9d2c4;
      }

      .wld {
        font-family: var(--arena-font-mono);
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .wld .w {
        color: var(--arena-success-hi);
      }
      .wld .l {
        color: var(--arena-live-2);
      }
      .wld .d {
        color: var(--arena-text-label);
      }
      .wld .sep {
        color: var(--arena-text-faint);
      }

      .pct-head,
      .pct {
        padding-left: 26px;
      }
      .pct {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .bar {
        display: block;
        flex: 1;
        height: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.07);
        overflow: hidden;
      }
      .fill {
        display: block;
        height: 100%;
        border-radius: 3px;
        background: linear-gradient(90deg, var(--arena-teal), var(--arena-teal-hi));
      }
      .row.first .fill {
        background: linear-gradient(90deg, var(--arena-gold), var(--arena-gold-hi));
      }
      .pct-num {
        min-width: 48px;
        text-align: right;
        font-family: var(--arena-font-mono);
        font-size: 12px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: #f2ecdf;
      }
      @media (prefers-reduced-motion: no-preference) {
        .fill {
          transition: width 1s ease;
        }
      }

      .think {
        font-family: var(--arena-font-mono);
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--arena-text-dim);
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
      <div class="scroll" role="region" aria-label="Leaderboard" tabindex="0">
        <div role="table" aria-label="Leaderboard standings" aria-rowcount=${this.rows.length + 1}>
          <div class="grid-row head" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Competitor</span>
            <span role="columnheader" class="right">Games</span>
            <span role="columnheader" class="right">W-L-D</span>
            <span role="columnheader" class="pct-head">Win%</span>
            <span role="columnheader" class="right">Avg think</span>
            <span role="columnheader" class="right">Top method</span>
          </div>
          ${this.rows.map((r) => this._row(r))}
        </div>
      </div>
    `;
  }

  private _row(r: LeaderRow) {
    const pct = winPct100(r.winPct);
    return html`
      <div class="grid-row row ${r.rank === 1 ? 'first' : ''}" role="row">
        <span class="rank" role="cell">${r.rank}</span>
        <span class="who" role="cell">
          <arena-agent-avatar name=${r.name} .size=${28}></arena-agent-avatar>
          <span class="n" title=${r.model || r.name}>${r.name}</span>
        </span>
        <span class="games right" role="cell">${r.games}</span>
        <span class="wld right" role="cell">
          <span class="w">${r.wins}</span><span class="sep">-</span><span class="l">${r.losses}</span
          ><span class="sep">-</span><span class="d">${r.draws}</span>
        </span>
        <span class="pct" role="cell">
          <span
            class="bar"
            role="img"
            aria-label=${`Win rate ${formatWinPct(r.winPct)}`}
          >
            <span class="fill" style=${`width:${pct}%`}></span>
          </span>
          <span class="pct-num" aria-hidden="true">${formatWinPct(r.winPct)}</span>
        </span>
        <span class="think right" role="cell">${formatThink(r.avgThink)}</span>
        <span class="right" role="cell">
          ${r.topMethod
            ? html`<arena-method-chip method=${r.topMethod}></arena-method-chip>`
            : nothing}
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-leaderboard-table': ArenaLeaderboardTable;
  }
}
