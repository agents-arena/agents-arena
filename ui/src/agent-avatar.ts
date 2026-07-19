// <arena-agent-avatar> — the Arena's little robot competitor mascot.
//
// A compact, friendly robot head: rounded body in the seat's hue, a dark visor,
// eyes, a mouth, and an antenna. It's the figure that stands in for a model
// everywhere — matchup panel, commentary feed, leaderboard, history, the hero,
// and the error page (where it's knocked out cold). One inline SVG; the seat
// (or an explicit color) tints the whole thing.
import { LitElement, html, svg, css } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes, seatColorIndex } from './theme.js';

/** Expression the avatar wears. */
export type AvatarMood = 'neutral' | 'thinking' | 'winner' | 'ko';

// Concrete hex per seat index (mirrors --arena-seat-N in theme.ts). SVG gradient
// stops need a real color, not a CSS custom property.
const SEAT_HEX: Record<number, string> = {
  1: '#ff7847',
  2: '#3fd8d4',
  3: '#e8b84b',
  4: '#3ddc85',
  5: '#a78bfa',
  6: '#ff7a9e',
};

// Recognisable models keep a signature hue regardless of seat.
const NAME_HEX: Record<string, string> = {
  grok1: '#ff7847',
  grok2: '#a78bfa',
  'deepseek-flash': '#3fd8d4',
  deepseek: '#3fd8d4',
};

/** Resolve the avatar's base color from an explicit color, a known name, or the seat. */
function resolveColor(color: string, name: string, seat: string): string {
  if (color) return color;
  const key = name.trim().toLowerCase();
  if (key && NAME_HEX[key]) return NAME_HEX[key];
  if (seat) return SEAT_HEX[seatColorIndex(seat)] ?? '#8b93a3';
  if (key) {
    // Deterministic hue for any other name.
    let h = 0;
    for (let i = 0; i < key.length; i++) h += key.charCodeAt(i);
    return `hsl(${(h * 47) % 360}, 70%, 64%)`;
  }
  return '#8b93a3';
}

/** Small string hash for per-identity feature variety (eye shape/size). */
function idHash(s: string): number {
  let h = 3;
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i) * 7;
  return h;
}

/**
 * An expressive robot-head avatar for an AI competitor.
 *
 * @example
 * html`<arena-agent-avatar seat="white" name="Grok1" .size=${44} mood="thinking"></arena-agent-avatar>`
 */
@customElement('arena-agent-avatar')
export class ArenaAgentAvatar extends LitElement {
  /** Seat id — drives the hue when no explicit color/known name is given. */
  @property({ type: String }) seat = '';
  /** Model / competitor name; a known name keeps its signature hue and varies features. */
  @property({ type: String }) name = '';
  /** Explicit override color (hex). Wins over name/seat. */
  @property({ type: String }) color = '';
  /** Rendered pixel size (square). */
  @property({ type: Number }) size = 40;
  /** Expression. */
  @property({ type: String, reflect: true }) mood: AvatarMood = 'neutral';

  static override styles: CSSResultGroup = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: inline-flex;
        line-height: 0;
      }
      svg {
        display: block;
      }
      @media (prefers-reduced-motion: no-preference) {
        :host([mood='thinking']) .bulb {
          animation: aa-pulse 1.1s ease-in-out infinite;
        }
        :host([mood='winner']) .av {
          animation: aa-float 3.4s ease-in-out infinite;
          transform-origin: center;
        }
      }
    `,
  ];

  private _eyes(): TemplateResult {
    if (this.mood === 'ko') {
      return svg`
        <path d="M20 29 l7 7 M27 29 l-7 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" />
        <path d="M37 29 l7 7 M44 29 l-7 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" />`;
    }
    if (this.mood === 'winner') {
      // Happy upward-arc eyes.
      return svg`
        <path d="M20 34 q4 -6 8 0" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" />
        <path d="M36 34 q4 -6 8 0" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" />`;
    }
    const h = idHash(this.name || this.seat || 'a');
    const r = 4 + (h % 3);
    if (h % 2) {
      return svg`
        <circle cx="24" cy="33" r=${r} fill="#fff" />
        <circle cx="40" cy="33" r=${r} fill="#fff" />`;
    }
    return svg`
      <rect x="19.5" y="28.5" width="8.5" height="9" rx="2.6" fill="#fff" />
      <rect x="36" y="28.5" width="8.5" height="9" rx="2.6" fill="#fff" />`;
  }

  private _mouth(): TemplateResult {
    const d =
      this.mood === 'ko'
        ? 'M26 45 q6 -4 12 0' // woozy
        : 'M26 43 q6 5 12 0'; // smile
    return svg`<path d=${d} stroke="rgba(255,255,255,.75)" stroke-width="2.2" fill="none" stroke-linecap="round" />`;
  }

  protected override render() {
    const color = resolveColor(this.color, this.name, this.seat);
    const gid = `avg-${Math.abs(idHash(color + this.size + this.mood))}`;
    const label = this.name ? `${this.name} avatar` : 'agent avatar';
    return html`
      <svg
        class="av"
        width=${this.size}
        height=${this.size}
        viewBox="0 0 64 64"
        role="img"
        aria-label=${label}
      >
        <defs>
          <linearGradient id=${gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color=${color} />
            <stop offset="100%" stop-color=${color} stop-opacity="0.68" />
          </linearGradient>
        </defs>
        <rect class="stalk" x="30" y="5" width="4" height="10" rx="2" fill=${color} opacity="0.85" />
        <circle class="bulb" cx="32" cy="6" r="3.4" fill=${color} />
        <rect
          x="8"
          y="13"
          width="48"
          height="44"
          rx="15"
          fill=${`url(#${gid})`}
          stroke="rgba(0,0,0,.35)"
          stroke-width="1.5"
        />
        <rect x="14" y="22" width="36" height="27" rx="10" fill="rgba(10,12,16,.5)" />
        ${this._eyes()} ${this._mouth()}
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-agent-avatar': ArenaAgentAvatar;
  }
}
