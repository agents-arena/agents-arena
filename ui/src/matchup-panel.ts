// <arena-matchup-panel> — the right-rail "MATCHUP" card of a live match.
//
// Two (or more) competitor cards stacked with a "VS" divider between them.
// Each card: the robot avatar, name + model chip, the seat chip (wood chips
// for chess white/black, solid accent chips for X/O, a tinted chip for any
// other seat), the animated THINKING dots while that seat is on the move, a
// WINNER badge with a gold ring at the end, and a right-aligned mono clock.
// Open seats render the italic "Open seat" variant with a pulsing dot.
//
// Purely presentational — everything comes in through `players`; the parent
// owns the stopwatch that feeds `clockMs`/`clockLabel`.
import { LitElement, html, css, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes, seatColorIndex } from './theme.js';
import type { AvatarMood } from './agent-avatar.js';
import './agent-avatar.js';

/** One seat in the matchup, in display order (top → bottom). */
export interface MatchupPlayer {
  /** Seat id ('white' | 'black' | 'X' | 'O' | ...) — drives color + chip style. */
  seat: string;
  /** Display name; '' or 'Open seat' renders the open/waiting variant. */
  name: string;
  /** Model id chip, e.g. 'grok-4.5'. */
  model?: string;
  status: 'open' | 'connecting' | 'connected' | 'lost';
  /** It's this seat's turn — highlight the card + show THINKING. */
  active: boolean;
  /** Show the WINNER badge + gold ring. */
  winner: boolean;
  /** Milliseconds shown in the clock slot (hidden when undefined). */
  clockMs?: number;
  /** Small label under the clock, e.g. 'THINKING' | 'TOTAL' | 'TIME'. */
  clockLabel?: string;
}

/** Below this remaining time an active clock turns red and pulses. */
const LOW_CLOCK_MS = 20_000;

/** Format milliseconds as m:ss (design's clock format). */
function formatClock(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

type ChipVariant = 'wood-white' | 'wood-black' | 'accent' | 'tinted';

/** Which chip treatment a seat gets: wood for chess, solid accent for X/O. */
function chipVariant(seat: string): ChipVariant {
  const key = seat.trim().toLowerCase();
  if (key === 'white' || key === 'w') return 'wood-white';
  if (key === 'black' || key === 'b') return 'wood-black';
  if (key === 'x' || key === 'o') return 'accent';
  return 'tinted';
}

/**
 * The matchup panel shown in a match's right rail.
 *
 * @example
 * html`<arena-matchup-panel .players=${[blackPlayer, whitePlayer]}></arena-matchup-panel>`
 */
@customElement('arena-matchup-panel')
export class ArenaMatchupPanel extends LitElement {
  /** Players in display order (usually 2, top → bottom). */
  @property({ attribute: false }) players: MatchupPlayer[] = [];
  /** Mono section eyebrow. */
  @property({ type: String }) override title = 'MATCHUP';
  /** Show the "VS" divider between cards. */
  @property({ type: Boolean, attribute: false }) showVs = true;

  static override styles: CSSResultGroup = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        min-width: 0;
        font-family: var(--arena-font-sans);
      }

      .panel {
        position: relative;
        background: var(--arena-surface);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 16px;
        padding: 16px;
      }

      .eyebrow {
        font: 700 10px var(--arena-font-mono);
        letter-spacing: 0.22em;
        color: var(--arena-text-label);
        margin: 2px 2px 12px;
        text-transform: uppercase;
      }

      /* --- Competitor card (design cardStyle) ------------------------------ */
      .card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 13px;
        background: rgba(255, 255, 255, 0.015);
        border: 1px solid var(--arena-border);
        transition:
          border-color 0.3s,
          box-shadow 0.3s,
          background 0.3s;
      }
      .card + .card {
        margin-top: 10px;
      }
      .card.active {
        background: rgba(255, 255, 255, 0.045);
        border-color: var(--seat);
        box-shadow: 0 0 22px color-mix(in srgb, var(--seat) 18%, transparent);
      }
      .card.winner {
        border-color: rgba(232, 184, 75, 0.65);
        box-shadow: var(--arena-glow-gold);
      }
      .card.lost {
        opacity: 0.75;
      }

      .meta {
        flex: 1 1 auto;
        min-width: 0;
      }

      .name-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }
      .name {
        font: 700 15px var(--arena-font-sans);
        color: var(--arena-text-strong);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .name.open {
        font-style: italic;
        color: var(--arena-text-label);
      }
      .model {
        font: 600 9px var(--arena-font-mono);
        color: color-mix(in srgb, var(--seat) 62%, white);
        border: 1px solid color-mix(in srgb, var(--seat) 38%, transparent);
        padding: 2px 6px;
        border-radius: var(--arena-radius-pill);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .sub {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 6px;
      }

      /* --- Seat chips ------------------------------------------------------ */
      .chip {
        font: 700 9px var(--arena-font-mono);
        letter-spacing: 0.1em;
        padding: 3px 8px;
        border-radius: 6px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .chip.wood-white {
        color: var(--arena-chip-white-ink);
        background: var(--arena-chip-white-bg);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      .chip.wood-black {
        color: var(--arena-chip-black-ink);
        background: var(--arena-chip-black-bg);
        border: 1px solid var(--arena-border-strong);
      }
      .chip.accent {
        font: 800 10px var(--arena-font-mono);
        letter-spacing: normal;
        color: #0e0d17;
        background: var(--seat);
        padding: 3px 9px;
      }
      .chip.tinted {
        color: color-mix(in srgb, var(--seat) 72%, var(--arena-text));
        background: color-mix(in srgb, var(--seat) 14%, transparent);
        border: 1px solid color-mix(in srgb, var(--seat) 35%, var(--arena-border));
      }

      /* --- THINKING dots ---------------------------------------------------- */
      .thinking {
        display: flex;
        align-items: center;
        gap: 5px;
        font: 600 10px var(--arena-font-mono);
        color: var(--seat);
        letter-spacing: 0.08em;
      }
      .thinking i {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--seat);
      }

      .badge-winner {
        font: 700 9px var(--arena-font-mono);
        letter-spacing: 0.12em;
        color: var(--arena-gold);
        border: 1px solid rgba(232, 184, 75, 0.5);
        background: rgba(232, 184, 75, 0.1);
        padding: 3px 8px;
        border-radius: 6px;
        white-space: nowrap;
      }

      /* --- Open seat -------------------------------------------------------- */
      .pulse-dot {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--seat);
      }
      .waiting {
        font: 500 10px var(--arena-font-mono);
        color: var(--arena-text-faint);
        letter-spacing: 0.06em;
      }

      /* --- Clock (design clockStyle) ---------------------------------------- */
      .clock {
        flex: 0 0 auto;
        text-align: right;
      }
      .clock-time {
        font: 800 21px var(--arena-font-mono);
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        color: var(--arena-text-faint);
        transition: color 0.3s;
      }
      .clock-time.on {
        color: var(--arena-gold-hi);
      }
      .clock-time.low {
        color: var(--arena-live);
      }
      .clock-label {
        font: 500 9px var(--arena-font-mono);
        color: var(--arena-text-faint);
        letter-spacing: 0.1em;
        margin-top: 3px;
        text-transform: uppercase;
      }

      /* --- VS divider -------------------------------------------------------- */
      .vs {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 10px 0;
      }
      .vs i {
        flex: 1;
        height: 1px;
        background: var(--arena-border);
      }
      .vs span {
        font: 900 11px var(--arena-font-sans);
        color: var(--arena-text-faint);
        letter-spacing: 0.14em;
      }

      /* Tight rails / small phones: shave the card so nothing crowds. */
      @media (max-width: 400px) {
        .card {
          padding: 10px 12px;
          gap: 10px;
        }
        .clock-time {
          font-size: 18px;
        }
      }

      @media (prefers-reduced-motion: no-preference) {
        .thinking i {
          animation: aa-bounce 1.1s ease infinite;
        }
        .thinking i:nth-child(2) {
          animation-delay: 0.15s;
        }
        .thinking i:nth-child(3) {
          animation-delay: 0.3s;
        }
        .clock-time.low {
          animation: aa-pulse 1s ease infinite;
        }
        .pulse-dot {
          animation: aa-pulse 1.2s ease infinite;
        }
      }
    `,
  ];

  /** Open/waiting variant: seat has no occupant yet. */
  private _isOpen(p: MatchupPlayer): boolean {
    const name = p.name.trim();
    return p.status === 'open' || name === '' || name.toLowerCase() === 'open seat';
  }

  private _mood(p: MatchupPlayer): AvatarMood {
    if (p.winner) return 'winner';
    if (p.status === 'lost') return 'ko';
    if (p.active) return 'thinking';
    return 'neutral';
  }

  private _clock(p: MatchupPlayer): TemplateResult | typeof nothing {
    if (p.clockMs === undefined) return nothing;
    const low = p.active && p.clockMs < LOW_CLOCK_MS;
    const cls = ['clock-time', low ? 'low' : p.active ? 'on' : ''].filter(Boolean).join(' ');
    return html`
      <div class="clock">
        <div class=${cls}>${formatClock(p.clockMs)}</div>
        ${p.clockLabel ? html`<div class="clock-label">${p.clockLabel}</div>` : nothing}
      </div>
    `;
  }

  private _card(p: MatchupPlayer): TemplateResult {
    const open = this._isOpen(p);
    const cls = [
      'card',
      p.active ? 'active' : '',
      p.winner ? 'winner' : '',
      p.status === 'lost' ? 'lost' : '',
      open ? 'open' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const label = open
      ? `Open seat, seat ${p.seat}, waiting for a challenger`
      : [
          p.name,
          `seat ${p.seat}`,
          p.model ?? '',
          p.active ? 'thinking' : '',
          p.winner ? 'winner' : '',
          p.status === 'lost' ? 'disconnected' : '',
        ]
          .filter(Boolean)
          .join(', ');
    return html`
      <div
        class=${cls}
        style=${`--seat: var(--arena-seat-${seatColorIndex(p.seat)})`}
        role="group"
        aria-label=${label}
      >
        <arena-agent-avatar
          seat=${p.seat}
          name=${open ? '' : p.name}
          .size=${44}
          mood=${this._mood(p)}
        ></arena-agent-avatar>
        <div class="meta">
          ${open
            ? html`
                <div class="name-row">
                  <span class="name open">Open seat</span>
                  <span class="pulse-dot" aria-hidden="true"></span>
                </div>
                <div class="sub">
                  <span class="chip ${chipVariant(p.seat)}">${p.seat}</span>
                  <span class="waiting">waiting for a challenger…</span>
                </div>
              `
            : html`
                <div class="name-row">
                  <span class="name" title=${p.name}>${p.name}</span>
                  ${p.model ? html`<span class="model">${p.model}</span>` : nothing}
                </div>
                <div class="sub">
                  <span class="chip ${chipVariant(p.seat)}">${p.seat}</span>
                  ${p.active
                    ? html`<span class="thinking"><i></i><i></i><i></i>THINKING</span>`
                    : nothing}
                  ${p.winner ? html`<span class="badge-winner">WINNER</span>` : nothing}
                </div>
              `}
        </div>
        ${open ? nothing : this._clock(p)}
      </div>
    `;
  }

  protected override render(): TemplateResult {
    // Cards with VS dividers interleaved. Flattened into one list (rather than
    // a nested binding-only template) so every mapped template is rooted in a
    // real element — binding-only templates trip up some DOM shims.
    const rows: TemplateResult[] = [];
    this.players.forEach((p, i) => {
      if (i > 0 && this.showVs) {
        rows.push(
          html`<div class="vs" aria-hidden="true"><i></i><span>VS</span><i></i></div>`,
        );
      }
      rows.push(this._card(p));
    });
    return html`
      <div class="panel">
        <div class="eyebrow">${this.title}</div>
        ${rows}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-matchup-panel': ArenaMatchupPanel;
  }
}
