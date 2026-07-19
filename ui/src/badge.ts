import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from './theme.js';

/** Visual tone of a badge. */
export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'danger';

/**
 * Small mono pill for status labels and counts (SPECTATING, LIVE, FINAL, room
 * ids…). Content goes in the default slot. Set `dot` for a leading status dot;
 * the `danger` dot pulses (live indicator).
 */
@customElement('arena-badge')
export class ArenaBadge extends LitElement {
  /** Color tone of the badge. */
  @property({ type: String, reflect: true }) variant: BadgeVariant = 'neutral';
  /** Show a leading status dot. */
  @property({ type: Boolean, reflect: true }) dot = false;

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
        font-family: var(--arena-font-mono);
      }

      .badge {
        --tone: var(--arena-text-label);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border: 1px solid color-mix(in srgb, var(--tone) 34%, var(--arena-border));
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--tone) 8%, transparent);
        color: color-mix(in srgb, var(--tone) 78%, var(--arena-text));
        font-size: 10px;
        font-weight: 700;
        line-height: 1.4;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        white-space: nowrap;
      }
      .badge.neutral {
        --tone: var(--arena-text-label);
        color: var(--arena-text-label);
        background: rgba(255, 255, 255, 0.03);
        border-color: var(--arena-border-strong);
      }
      .badge.accent {
        --tone: var(--arena-gold);
      }
      .badge.success {
        --tone: var(--arena-success);
      }
      .badge.danger {
        --tone: var(--arena-live);
        color: var(--arena-live-2);
      }

      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--tone);
        flex: 0 0 auto;
      }
      @media (prefers-reduced-motion: no-preference) {
        .badge.danger .dot {
          animation: aa-pulse 1.4s ease-in-out infinite;
        }
      }
    `,
  ];

  protected override render() {
    return html`<span class="badge ${this.variant}"
      >${this.dot ? html`<span class="dot" aria-hidden="true"></span>` : nothing}<slot></slot
    ></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-badge': ArenaBadge;
  }
}
