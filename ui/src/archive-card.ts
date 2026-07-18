import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, seatColorIndex } from './theme.js';
import './reasoning-badge.js';
import './method-chip.js';
import type { ReasoningMode } from './reasoning-badge.js';

/** One player summary on an archive card. */
export interface MatchSummaryPlayer {
  seat: string;
  name: string;
  model?: string;
  method?: string;
}

/**
 * Compact history-list item for one finished (or archived) match.
 * Field names mirror the Section P / archive JSON where practical.
 */
export interface MatchSummary {
  /** Room id (also used as the select event payload). */
  room: string;
  /** Game kind, e.g. `chess` or `tic-tac-toe`. */
  game: string;
  /**
   * Winner seat/name identifier. `null` / omitted means draw (or unknown);
   * when present, used for the result headline.
   */
  winner?: string | null;
  /** Participating players (typically two). */
  players: MatchSummaryPlayer[];
  /** Declared reasoning mode for the room. */
  reasoning?: ReasoningMode;
  /** Match duration in milliseconds. */
  durationMs?: number;
  /** Match duration in seconds (used when durationMs is absent). */
  durationSec?: number;
  /** Total ply / move count. */
  moveCount: number;
  /** Number of spectator/agent comments. */
  commentCount: number;
  /** When the match ended — ISO-8601 string or epoch milliseconds. */
  endedAt: string | number;
}

function seatVar(seat: string): string {
  return `--seat: var(--arena-seat-${seatColorIndex(seat)})`;
}

/** Format a duration from ms: "4m 12s", "45s", "1h 02m". */
function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Parse endedAt into epoch ms, or null if unparseable. */
function endedAtMs(endedAt: string | number): number | null {
  if (typeof endedAt === 'number' && Number.isFinite(endedAt)) return endedAt;
  if (typeof endedAt === 'string' && endedAt.trim()) {
    const t = Date.parse(endedAt);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Relative "ended 5m ago" string from an absolute timestamp. */
function relativeEnded(endedAt: string | number, now = Date.now()): string {
  const t = endedAtMs(endedAt);
  if (t === null) return '';
  const diffSec = Math.max(0, Math.round((now - t) / 1000));
  if (diffSec < 60) return `ended ${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `ended ${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 48) return `ended ${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `ended ${diffD}d ago`;
}

/** Simple glyph for a known game kind. */
function gameGlyph(game: string): string {
  const g = game.toLowerCase();
  if (g.includes('chess')) return '♟';
  if (g.includes('tic')) return '✕';
  return '◈';
}

/**
 * Presentational card for one match-history summary. Whole card is a button;
 * click / Enter / Space dispatches `select` with `{ room }`.
 */
@customElement('arena-archive-card')
export class ArenaArchiveCard extends LitElement {
  /** Summary to render. */
  @property({ attribute: false }) summary: MatchSummary | null = null;

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
        color: var(--arena-text);
      }

      .card {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-3);
        width: 100%;
        padding: var(--arena-space-3) var(--arena-space-4);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          border-color 140ms ease,
          box-shadow 140ms ease,
          filter 140ms ease;
      }
      .card:hover {
        border-color: var(--arena-border-strong);
        filter: brightness(1.02);
      }
      .card:focus-visible {
        outline: none;
        border-color: var(--arena-brand);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .card:active {
        filter: brightness(0.98);
      }

      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-2);
      }
      .row.between {
        justify-content: space-between;
      }

      .game-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--arena-radius-sm);
        background: var(--arena-surface-2);
        border: 1px solid var(--arena-border);
        font-size: 14px;
        line-height: 1;
      }

      .room {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-sm);
        color: var(--arena-text-muted);
      }

      .headline {
        margin: 0;
        font-size: var(--arena-text-lg);
        font-weight: 800;
        letter-spacing: -0.01em;
      }
      .headline .who {
        color: color-mix(in srgb, var(--seat) 78%, var(--arena-text));
      }
      .headline.draw {
        color: var(--arena-text-muted);
      }

      .players {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-2);
      }
      .player {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-2);
        min-width: 0;
      }
      .seat {
        display: inline-block;
        padding: 1px 7px;
        border-radius: var(--arena-radius-sm);
        background: color-mix(in srgb, var(--seat) 16%, transparent);
        color: color-mix(in srgb, var(--seat) 74%, var(--arena-text));
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        font-size: var(--arena-text-xs);
        white-space: nowrap;
      }
      .pname {
        font-weight: 600;
        font-size: var(--arena-text-sm);
      }
      .pmodel {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        color: var(--arena-text-muted);
      }

      .stats {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-1) var(--arena-space-3);
        font-size: var(--arena-text-sm);
        color: var(--arena-text-muted);
      }
      .stats .num {
        font-variant-numeric: tabular-nums;
        font-family: var(--arena-font-mono);
        color: var(--arena-text);
        font-weight: 600;
      }
      .rel {
        color: var(--arena-text-faint);
        font-size: var(--arena-text-xs);
      }

      .empty {
        margin: 0;
        padding: var(--arena-space-4);
        text-align: center;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
      }

      @media (prefers-reduced-motion: reduce) {
        .card {
          transition: none;
        }
      }
    `,
  ];

  private _onSelect(): void {
    const room = this.summary?.room;
    if (!room) return;
    this.dispatchEvent(
      new CustomEvent('select', {
        detail: { room },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _headline(summary: MatchSummary) {
    const winner = summary.winner;
    if (winner == null || winner === '') {
      return html`<h3 class="headline draw">Draw</h3>`;
    }
    // Prefer player name if winner matches a seat; otherwise show raw winner.
    const bySeat = summary.players.find((p) => p.seat === winner);
    const byName = summary.players.find((p) => p.name === winner);
    const player = bySeat ?? byName;
    const label = player?.name ?? winner;
    const seat = player?.seat ?? winner;
    return html`<h3 class="headline" style=${seatVar(seat)}>
      <span class="who">${label}</span>&nbsp;wins
    </h3>`;
  }

  protected override render() {
    const summary = this.summary;
    if (!summary) {
      return html`<p class="empty">No match summary.</p>`;
    }

    const durationMs =
      summary.durationMs ??
      (summary.durationSec !== undefined ? summary.durationSec * 1000 : undefined);
    const duration =
      durationMs !== undefined ? formatDurationMs(durationMs) : '—';
    const rel = relativeEnded(summary.endedAt);
    const reasoning =
      summary.reasoning === 'self' || summary.reasoning === 'open'
        ? summary.reasoning
        : null;

    return html`
      <button
        type="button"
        class="card"
        aria-label=${`Open match ${summary.room}`}
        @click=${this._onSelect}
      >
        <div class="row between">
          <div class="row">
            <span class="game-glyph" aria-hidden="true">${gameGlyph(summary.game)}</span>
            <span class="room">${summary.room}</span>
            ${reasoning
              ? html`<arena-reasoning-badge mode=${reasoning}></arena-reasoning-badge>`
              : nothing}
          </div>
          ${rel ? html`<span class="rel">${rel}</span>` : nothing}
        </div>

        ${this._headline(summary)}

        <div class="players">
          ${summary.players.map(
            (p) => html`
              <div class="player">
                <span class="seat" style=${seatVar(p.seat)}>${p.seat}</span>
                <span class="pname">${p.name}</span>
                ${p.model ? html`<span class="pmodel">${p.model}</span>` : nothing}
                ${p.method
                  ? html`<arena-method-chip method=${p.method}></arena-method-chip>`
                  : nothing}
              </div>
            `,
          )}
        </div>

        <div class="stats">
          <span><span class="num">${duration}</span></span>
          <span><span class="num">${summary.moveCount}</span> moves</span>
          <span><span class="num">${summary.commentCount}</span> comments</span>
        </div>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-archive-card': ArenaArchiveCard;
  }
}
