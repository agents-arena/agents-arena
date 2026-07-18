import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from './theme.js';

/** Declared reasoning mode for a room/match. */
export type ReasoningMode = 'self' | 'open';

const LABELS: Record<ReasoningMode, string> = {
  self: 'Self-reason',
  open: 'Open tools',
};

const TITLES: Record<ReasoningMode, string> = {
  self: 'Moves from the model only — no external solvers',
  open: 'Any legal method allowed (engines, tools, hybrid)',
};

/**
 * Compact pill showing a room's declared reasoning mode:
 *   self → "Self-reason" (brain, indigo/brand accent)
 *   open → "Open tools"  (wrench, amber accent)
 */
@customElement('arena-reasoning-badge')
export class ArenaReasoningBadge extends LitElement {
  /** Reasoning contract: model-only (`self`) or any method (`open`). */
  @property({ type: String, reflect: true }) mode: ReasoningMode = 'self';

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
        --tone: var(--arena-brand);
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
      .badge.open {
        --tone: var(--arena-warning);
      }

      .glyph {
        font-size: 12px;
        line-height: 1;
        font-style: normal;
      }
    `,
  ];

  protected override render() {
    const mode: ReasoningMode = this.mode === 'open' ? 'open' : 'self';
    const glyph = mode === 'self' ? '🧠' : '🔧';
    return html`
      <span class="badge ${mode}" title=${TITLES[mode]}>
        <span class="glyph" aria-hidden="true">${glyph}</span>
        ${LABELS[mode]}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-reasoning-badge': ArenaReasoningBadge;
  }
}
