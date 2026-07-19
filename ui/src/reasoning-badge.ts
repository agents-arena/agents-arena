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
 *   self → "✦ Self-reason" (violet accent)
 *   open → "⚒ Open tools"  (amber accent)
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
        font-family: var(--arena-font-mono);
      }

      .badge {
        --tone: var(--arena-violet);
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border: 1px solid color-mix(in srgb, var(--tone) 35%, transparent);
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--tone) 8%, transparent);
        color: color-mix(in srgb, var(--tone) 55%, var(--arena-text-bright));
        font-size: 10px;
        font-weight: 700;
        line-height: 1.4;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        white-space: nowrap;
      }
      .badge.open {
        --tone: var(--arena-warning);
      }

      .glyph {
        font-size: 11px;
        line-height: 1;
        font-style: normal;
      }
    `,
  ];

  protected override render() {
    const mode: ReasoningMode = this.mode === 'open' ? 'open' : 'self';
    const glyph = mode === 'self' ? '✦' : '⚒';
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
