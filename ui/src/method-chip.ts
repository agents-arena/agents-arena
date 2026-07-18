import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from './theme.js';

/** Known self-reported methods of choosing a move. */
export type MethodKind = 'engine' | 'model' | 'human' | 'hybrid';

interface MethodStyle {
  label: string;
  glyph: string;
  /** CSS color used as the chip accent. */
  tone: string;
}

const KNOWN: Record<MethodKind, MethodStyle> = {
  engine: {
    label: 'Engine',
    glyph: '⚙',
    tone: 'color-mix(in srgb, #0e7490 70%, #64748b)',
  },
  model: {
    label: 'Model',
    glyph: '🧠',
    tone: 'var(--arena-brand)',
  },
  human: {
    label: 'Human',
    glyph: '🙂',
    tone: 'var(--arena-success)',
  },
  hybrid: {
    label: 'Hybrid',
    glyph: '⚗',
    tone: 'var(--arena-seat-5)',
  },
};

/**
 * Small icon + label chip for a self-reported method-of-play.
 * Known values (`engine` / `model` / `human` / `hybrid`) get distinct colors;
 * anything else renders muted with the raw string as the label.
 */
@customElement('arena-method-chip')
export class ArenaMethodChip extends LitElement {
  /** Method key — expected `engine`|`model`|`human`|`hybrid`, but any string is accepted. */
  @property({ type: String, reflect: true }) method = '';

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
        font-family: var(--arena-font-sans);
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        border: 1px solid color-mix(in srgb, var(--tone) 30%, var(--arena-border));
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--tone) 12%, var(--arena-surface));
        color: color-mix(in srgb, var(--tone) 68%, var(--arena-text));
        font-size: var(--arena-text-xs);
        font-weight: 700;
        line-height: 1.4;
        letter-spacing: 0.03em;
        text-transform: capitalize;
        white-space: nowrap;
      }

      .glyph {
        font-size: 11px;
        line-height: 1;
        font-style: normal;
      }
    `,
  ];

  private _style(): MethodStyle {
    const key = this.method.trim().toLowerCase();
    if (key in KNOWN) return KNOWN[key as MethodKind];
    const raw = this.method.trim() || 'unknown';
    return {
      label: raw,
      glyph: '?',
      tone: 'var(--arena-text-faint)',
    };
  }

  protected override render() {
    const s = this._style();
    return html`
      <span class="chip" style=${`--tone: ${s.tone}`} title=${`Method: ${s.label}`}>
        <span class="glyph" aria-hidden="true">${s.glyph}</span>
        ${s.label}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-method-chip': ArenaMethodChip;
  }
}
