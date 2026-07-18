import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import { arenaTokens, resetStyles, seatColorIndex } from './theme.js';
import './method-chip.js';

/** A single entry in the move log. */
export interface MoveLogEntry {
  /** Optional move number (rendered in a tabular column). */
  n?: number;
  /** Optional seat identifier; colors the entry's tag. */
  seat?: string;
  /** Human-readable description of the move. */
  text: string;
  /** Optional self-reported method of choosing this move. */
  method?: string;
}

/**
 * Scrollable, monospaced history of moves. Announces new entries politely and
 * auto-scrolls to the newest on update. Shows an empty state before play.
 */
@customElement('arena-move-log')
export class ArenaMoveLog extends LitElement {
  /** Ordered list of moves, oldest first. */
  @property({ attribute: false }) moves: MoveLogEntry[] = [];

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
      }

      .log {
        max-height: 260px;
        overflow-y: auto;
        padding: var(--arena-space-2);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
        scrollbar-width: thin;
      }
      .log:focus-visible {
        outline: none;
        border-color: var(--arena-brand);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }

      .entries {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }

      .entry {
        display: grid;
        grid-template-columns: auto auto 1fr auto;
        align-items: baseline;
        gap: var(--arena-space-2);
        padding: 6px var(--arena-space-2);
        border-radius: var(--arena-radius-sm);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-sm);
      }
      .entry + .entry {
        border-top: 1px solid var(--arena-border);
      }
      .entry:last-child {
        background: color-mix(in srgb, var(--arena-brand) 7%, transparent);
      }

      .n {
        color: var(--arena-text-faint);
        font-variant-numeric: tabular-nums;
        text-align: right;
        min-width: 2ch;
      }

      .seat {
        justify-self: start;
        padding: 0 6px;
        border-radius: var(--arena-radius-sm);
        background: color-mix(in srgb, var(--seat) 16%, transparent);
        color: color-mix(in srgb, var(--seat) 74%, var(--arena-text));
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        font-size: var(--arena-text-xs);
      }

      .text {
        color: var(--arena-text);
        word-break: break-word;
      }

      .method {
        justify-self: end;
      }

      .empty {
        margin: 0;
        padding: var(--arena-space-5) var(--arena-space-3);
        text-align: center;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
      }
    `,
  ];

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('moves')) {
      const log = this.renderRoot.querySelector<HTMLElement>('.log');
      if (log) log.scrollTop = log.scrollHeight;
    }
  }

  protected override render() {
    return html`
      <div class="log" role="log" aria-live="polite" aria-label="Move history" tabindex="0">
        ${this.moves.length === 0
          ? html`<p class="empty">No moves yet. The board is set.</p>`
          : html`<ol class="entries">
              ${this.moves.map(
                (m) => html`<li
                  class="entry"
                  style=${m.seat != null
                    ? `--seat: var(--arena-seat-${seatColorIndex(m.seat)})`
                    : nothing}
                >
                  ${m.n != null ? html`<span class="n">${m.n}</span>` : html`<span class="n"></span>`}
                  ${m.seat != null ? html`<span class="seat">${m.seat}</span>` : html`<span></span>`}
                  <span class="text">${m.text}</span>
                  ${m.method
                    ? html`<span class="method"
                        ><arena-method-chip method=${m.method}></arena-method-chip
                      ></span>`
                    : html`<span class="method"></span>`}
                </li>`,
              )}
            </ol>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-move-log': ArenaMoveLog;
  }
}
