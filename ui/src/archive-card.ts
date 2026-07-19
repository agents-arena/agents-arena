import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes, seatColorIndex } from './theme.js';
import './reasoning-badge.js';
import './method-chip.js';
import './agent-avatar.js';
import type { ReasoningMode } from './reasoning-badge.js';

/** One player summary on an archive card. */
export interface MatchSummaryPlayer {
  seat: string;
  name: string;
  model?: string;
  method?: string;
  /** Moves this player made (shown as "6 moves" on the row when present). */
  moves?: number;
  /** Average think time in ms (shown as "51.4s avg" on the row when present). */
  avgThinkMs?: number;
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

/** Physical WHITE/BLACK chips for chess seats; any other seat gets its accent hue. */
function seatChipClass(seat: string): string {
  const k = seat.trim().toLowerCase();
  if (k === 'white' || k === 'w') return 'chip white';
  if (k === 'black' || k === 'b') return 'chip black';
  return 'chip accent';
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

/** Format a per-player avg think time compactly: "850ms", "51.4s", "1m 03s". */
function formatThink(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatDurationMs(ms);
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
  if (g.includes('chess')) return '♞';
  if (g.includes('tic')) return '✕';
  return '◈';
}

/**
 * Presentational card for one match-history summary — the dark "wood table"
 * history card: game glyph + room id + badge header, winner/draw headline,
 * per-player rows (seat chip, robot avatar, name, per-player stats), and a
 * mono stats footer. Whole card is a button; click / Enter / Space dispatches
 * `select` with `{ room }`. Set `live` for the animated gold glow-ring +
 * LIVE badge variant.
 */
@customElement('arena-archive-card')
export class ArenaArchiveCard extends LitElement {
  /** Summary to render. */
  @property({ attribute: false }) summary: MatchSummary | null = null;
  /** Live-match visual variant: animated gold glow ring + LIVE badge. */
  @property({ type: Boolean, reflect: true }) live = false;

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
        color: var(--arena-text);
      }

      .card {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        padding: 18px;
        border: 1px solid var(--arena-border);
        border-radius: 16px;
        background: var(--arena-surface);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          transform 0.2s ease,
          border-color 0.2s ease;
      }
      .card:hover {
        border-color: rgba(232, 184, 75, 0.35);
      }
      .card:focus-visible {
        outline: none;
        border-color: var(--arena-gold);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .card:active {
        filter: brightness(0.98);
      }

      /* Live variant: ember border + gold glow ring (static when motion is reduced). */
      .card.live {
        border-color: rgba(255, 90, 82, 0.4);
        box-shadow:
          0 0 0 2px rgba(232, 184, 75, 0.4),
          0 0 18px rgba(232, 184, 75, 0.2);
      }
      @media (prefers-reduced-motion: no-preference) {
        .card:hover {
          transform: translateY(-3px);
        }
        .card.live {
          animation: aa-glowring 2.2s ease infinite;
        }
      }

      /* Header: glyph, room id, badge pinned right ------------------------- */
      .top {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        min-width: 0;
      }
      .game-glyph {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 15px;
        line-height: 1;
        color: #f2e7d3;
      }
      .game-glyph.ttt {
        font-family: var(--arena-font-mono);
        font-size: 12px;
        font-weight: 800;
        color: var(--arena-violet);
      }
      .room {
        font-family: var(--arena-font-mono);
        font-size: 12px;
        font-weight: 600;
        color: var(--arena-text-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .badge-slot {
        margin-left: auto;
        flex: none;
        display: inline-flex;
      }
      .live-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        border: 1px solid rgba(255, 107, 96, 0.4);
        border-radius: var(--arena-radius-pill);
        color: var(--arena-live-2);
        font-family: var(--arena-font-mono);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.14em;
        white-space: nowrap;
      }
      .live-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--arena-live);
      }
      @media (prefers-reduced-motion: no-preference) {
        .live-dot {
          animation: aa-pulse 1.4s ease infinite;
        }
      }

      /* Headline ------------------------------------------------------------ */
      .headline {
        margin: 0 0 10px;
        font-size: 19px;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: var(--arena-text-strong);
      }
      .headline .who {
        color: var(--seat, var(--arena-text-strong));
      }

      /* Player rows ----------------------------------------------------------
       * Seat chips: physical WHITE/BLACK for chess; solid seat accent for
       * everything else (X violet, O rose, …).
       */
      .players {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-bottom: 14px;
      }
      .player {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .chip {
        flex: none;
        display: inline-flex;
        padding: 2px 7px;
        border: 1px solid transparent;
        border-radius: 5px;
        font-family: var(--arena-font-mono);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .chip.white {
        background: var(--arena-chip-white-bg);
        color: var(--arena-chip-white-ink);
      }
      .chip.black {
        background: var(--arena-chip-black-bg);
        color: var(--arena-chip-black-ink);
        border-color: var(--arena-border-strong);
      }
      .chip.accent {
        background: var(--seat, var(--arena-text-faint));
        color: #0e0d17;
      }
      .avatar {
        flex: none;
        line-height: 0;
      }
      .pname {
        font-size: 12.5px;
        font-weight: 600;
        color: #d9d2c4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pstat {
        flex: none;
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 500;
        color: var(--arena-text-faint);
        white-space: nowrap;
      }

      /* Stats footer ---------------------------------------------------------- */
      .stats {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        margin-top: auto;
        font-family: var(--arena-font-mono);
        font-size: 11px;
        font-weight: 600;
        color: var(--arena-text-label);
      }
      .stats .rel {
        margin-left: auto;
        color: var(--arena-text-faint);
      }

      .empty {
        margin: 0;
        padding: var(--arena-space-4);
        text-align: center;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
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
      return html`<h3 class="headline">Draw</h3>`;
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

  private _playerRow(p: MatchSummaryPlayer) {
    const bits: string[] = [];
    if (p.moves !== undefined) bits.push(`${p.moves} moves`);
    if (p.avgThinkMs !== undefined) bits.push(`${formatThink(p.avgThinkMs)} avg`);
    const stat = bits.join(' · ');
    return html`
      <div class="player">
        <span class="${seatChipClass(p.seat)}" style=${seatVar(p.seat)}>${p.seat}</span>
        <span class="avatar">
          <arena-agent-avatar seat=${p.seat} name=${p.name} .size=${22}></arena-agent-avatar>
        </span>
        <span class="pname" title=${p.model ?? ''}>${p.name}</span>
        ${stat ? html`<span class="pstat">${stat}</span>` : nothing}
      </div>
    `;
  }

  protected override render() {
    const summary = this.summary;
    if (!summary) {
      return html`<p class="empty">No match summary.</p>`;
    }

    const durationMs =
      summary.durationMs ??
      (summary.durationSec !== undefined ? summary.durationSec * 1000 : undefined);
    const duration = durationMs !== undefined ? formatDurationMs(durationMs) : '—';
    const rel = relativeEnded(summary.endedAt);
    const reasoning =
      summary.reasoning === 'self' || summary.reasoning === 'open' ? summary.reasoning : null;
    const glyphClass = summary.game.toLowerCase().includes('tic') ? 'game-glyph ttt' : 'game-glyph';

    return html`
      <button
        type="button"
        class="card ${this.live ? 'live' : ''}"
        aria-label=${`Open match ${summary.room}`}
        @click=${this._onSelect}
      >
        <div class="top">
          <span class=${glyphClass} aria-hidden="true">${gameGlyph(summary.game)}</span>
          <span class="room">${summary.room}</span>
          <span class="badge-slot">
            ${this.live
              ? html`<span class="live-badge"><span class="live-dot"></span>LIVE</span>`
              : reasoning
                ? html`<arena-reasoning-badge mode=${reasoning}></arena-reasoning-badge>`
                : nothing}
          </span>
        </div>

        ${this._headline(summary)}

        <div class="players">${summary.players.map((p) => this._playerRow(p))}</div>

        <div class="stats">
          <span>${duration}</span>
          <span>${summary.moveCount} moves</span>
          <span>${summary.commentCount} comments</span>
          ${rel ? html`<span class="rel">${rel}</span>` : nothing}
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
