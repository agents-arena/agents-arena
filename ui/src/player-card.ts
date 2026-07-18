import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, seatColorIndex } from './theme.js';

/**
 * Presence of the seat's occupant, shown as a colored status dot:
 *   waiting    — no agent yet (seat open)     → blue
 *   connecting — agent joined, not live yet    → amber, blinking
 *   connected  — agent is live                 → green
 *   lost       — agent was live, connection dropped → red
 */
export type PlayerStatus = 'waiting' | 'connecting' | 'connected' | 'lost';

const STATUS_LABEL: Record<PlayerStatus, string> = {
  waiting: 'Waiting for a player',
  connecting: 'Connecting',
  connected: 'Connected',
  lost: 'Disconnected',
};

/**
 * A single competitor in the room. The card carries the seat's accent color as
 * a through-line: rail, avatar tint, seat chip, and — when it's this player's
 * turn — a glowing ring and a blinking "to move" clock dot. The presence dot
 * encodes the occupant's connection state (see PlayerStatus).
 */
@customElement('arena-player-card')
export class ArenaPlayerCard extends LitElement {
  /** Display name of the player. */
  @property({ type: String }) name = '';
  /** Seat identifier (e.g. "P1", "X", "north"); drives the accent color. */
  @property({ type: String }) seat = '';
  /** Whether this card represents the local player. */
  @property({ type: Boolean, reflect: true }) you = false;
  /**
   * Presence dot state. When set, drives the four-state dot. When left
   * undefined, falls back to the legacy `connected` boolean.
   */
  @property({ type: String, reflect: true }) status?: PlayerStatus;
  /** Legacy presence flag; used only when `status` is not provided. */
  @property({ type: Boolean, reflect: true }) connected = true;
  /** Is it this player's turn? Highlights the card. */
  @property({ type: Boolean, reflect: true }) active = false;

  /** The status actually rendered — explicit `status`, else derived from `connected`. */
  private get _status(): PlayerStatus {
    return this.status ?? (this.connected ? 'connected' : 'lost');
  }

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
      }

      .card {
        --seat-tint: color-mix(in srgb, var(--seat) 16%, var(--arena-surface));
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--arena-space-3);
        min-height: 56px;
        padding: var(--arena-space-3) var(--arena-space-4);
        padding-left: calc(var(--arena-space-4) + 4px);
        overflow: hidden;
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
        transition:
          box-shadow 160ms ease,
          border-color 160ms ease,
          transform 160ms ease;
      }

      /* Seat-colored rail down the leading edge. */
      .card::before {
        content: '';
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        width: 4px;
        background: var(--seat);
      }

      .card.active {
        border-color: var(--seat);
        box-shadow:
          0 0 0 2px var(--seat),
          0 0 24px -6px color-mix(in srgb, var(--seat) 65%, transparent),
          var(--arena-shadow-2);
      }

      .card.offline {
        opacity: 0.72;
      }

      .avatar {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 40px;
        height: 40px;
        border-radius: var(--arena-radius-md);
        border: 1px solid color-mix(in srgb, var(--seat) 40%, var(--arena-border));
        background: var(--seat-tint);
        color: color-mix(in srgb, var(--seat) 78%, var(--arena-text));
        font-weight: 700;
        font-size: var(--arena-text-lg);
        line-height: 1;
        letter-spacing: -0.02em;
      }

      .meta {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .name-row {
        display: flex;
        align-items: center;
        gap: var(--arena-space-2);
        min-width: 0;
      }

      .name {
        font-weight: 600;
        font-size: var(--arena-text-base);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .you {
        flex: 0 0 auto;
        padding: 1px 6px;
        border-radius: var(--arena-radius-pill);
        background: var(--arena-brand);
        color: var(--arena-brand-ink);
        font-size: var(--arena-text-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .sub {
        display: flex;
        align-items: center;
        gap: var(--arena-space-2);
      }

      .seat-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: var(--arena-radius-sm);
        border: 1px solid color-mix(in srgb, var(--seat) 35%, var(--arena-border));
        background: color-mix(in srgb, var(--seat) 12%, transparent);
        color: color-mix(in srgb, var(--seat) 72%, var(--arena-text));
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .turn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--seat);
        font-size: var(--arena-text-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .turn::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--seat);
      }

      .presence {
        flex: 0 0 auto;
        align-self: flex-start;
      }
      .dot {
        display: block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--dot-color, var(--arena-text-faint));
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dot-color, var(--arena-text-faint)) 24%, transparent);
      }
      .card.st-waiting {
        --dot-color: #3b82f6;
      }
      .card.st-connecting {
        --dot-color: var(--arena-warning);
      }
      .card.st-connected {
        --dot-color: var(--arena-success);
      }
      .card.st-lost {
        --dot-color: var(--arena-danger);
      }
      @media (prefers-reduced-motion: no-preference) {
        .card.st-connecting .dot {
          animation: arena-blink 0.9s ease-in-out infinite;
        }
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @media (prefers-reduced-motion: no-preference) {
        .card.active .turn::before {
          animation: arena-blink 1.1s ease-in-out infinite;
        }
      }
      @keyframes arena-blink {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.25;
        }
      }
    `,
  ];

  private get _initial(): string {
    return (this.name.trim()[0] ?? '•').toUpperCase();
  }

  protected override updated(): void {
    // Describe the card as a whole for assistive tech.
    const status = this._status;
    const parts = [this.name || 'Empty seat', `seat ${this.seat}`];
    if (this.active) parts.push('to move');
    parts.push(status === 'connected' ? 'connected' : status === 'lost' ? 'disconnected' : status);
    if (this.you) parts.push('you');
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', parts.join(', '));
    if (this.active) this.setAttribute('aria-current', 'true');
    else this.removeAttribute('aria-current');
  }

  protected override render() {
    const status = this._status;
    // Muted while nobody is live in the seat (open, or dropped).
    const dim = status === 'waiting' || status === 'lost';
    const cls = ['card', this.active ? 'active' : '', dim ? 'offline' : '', `st-${status}`]
      .filter(Boolean)
      .join(' ');
    return html`
      <div class=${cls} style=${`--seat: var(--arena-seat-${seatColorIndex(this.seat)})`}>
        <span class="avatar" aria-hidden="true">${this._initial}</span>
        <span class="meta">
          <span class="name-row">
            <span class="name" title=${this.name}>${this.name || 'Empty seat'}</span>
            ${this.you ? html`<span class="you">You</span>` : nothing}
          </span>
          <span class="sub">
            <span class="seat-chip">${this.seat}</span>
            ${this.active ? html`<span class="turn">To move</span>` : nothing}
          </span>
        </span>
        <span class="presence">
          <span class="dot" aria-hidden="true"></span>
          <span class="sr-only">${STATUS_LABEL[status]}</span>
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-player-card': ArenaPlayerCard;
  }
}
