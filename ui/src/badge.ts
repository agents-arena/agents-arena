import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from './theme.js';

/** Visual tone of a badge. */
export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'danger';

/**
 * Small pill for status labels and counts. Content goes in the default slot.
 */
@customElement('arena-badge')
export class ArenaBadge extends LitElement {
  /** Color tone of the badge. */
  @property({ type: String, reflect: true }) variant: BadgeVariant = 'neutral';

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
        font-family: var(--arena-font-sans);
      }

      .badge {
        --tone: var(--arena-text-muted);
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 9px;
        border: 1px solid color-mix(in srgb, var(--tone) 32%, var(--arena-border));
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--tone) 12%, var(--arena-surface));
        color: color-mix(in srgb, var(--tone) 70%, var(--arena-text));
        font-size: var(--arena-text-xs);
        font-weight: 700;
        line-height: 1.4;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
      }
      .badge.accent {
        --tone: var(--arena-brand);
      }
      .badge.success {
        --tone: var(--arena-success);
      }
      .badge.danger {
        --tone: var(--arena-danger);
      }
    `,
  ];

  protected override render() {
    return html`<span class="badge ${this.variant}"><slot></slot></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-badge': ArenaBadge;
  }
}
