import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from './theme.js';

/**
 * Responsive room layout for a match. Named slots:
 *   - `header` — title bar / status strip
 *   - `board`  — the game surface (centered, square-friendly main area)
 *   - `aside`  — players, move log, share panel
 *   - `footer` — controls / meta
 *
 * Two columns on desktop (board + aside); stacked on mobile with the board first.
 */
@customElement('arena-room-frame')
export class ArenaRoomFrame extends LitElement {
  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        min-height: 100%;
        background: var(--arena-bg);
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
        font-size: var(--arena-text-base);
        line-height: 1.45;
        -webkit-font-smoothing: antialiased;
      }

      .frame {
        display: grid;
        gap: var(--arena-space-5);
        grid-template-columns: minmax(0, 1fr) clamp(280px, 24vw, 360px);
        grid-template-rows: auto minmax(0, 1fr) auto;
        grid-template-areas:
          'header header'
          'board  aside'
          'footer footer';
        min-height: 100%;
        max-width: 1200px;
        margin-inline: auto;
        padding: clamp(var(--arena-space-3), 3vw, var(--arena-space-6));
      }

      .header {
        grid-area: header;
      }
      .footer {
        grid-area: footer;
      }

      .board {
        grid-area: board;
        position: relative;
        display: grid;
        place-items: center;
        min-width: 0;
        padding: var(--arena-space-4);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
      }

      /* Signature: a faint spotlight behind the field of play. */
      .board::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(
          circle at 50% 34%,
          color-mix(in srgb, var(--arena-brand) 14%, transparent),
          transparent 62%
        );
        pointer-events: none;
        z-index: 0;
      }

      .board-inner {
        position: relative;
        z-index: 1;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: min(100%, 640px);
      }

      .aside {
        grid-area: aside;
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-4);
        min-width: 0;
      }

      @media (max-width: 880px) {
        .frame {
          grid-template-columns: minmax(0, 1fr);
          grid-template-areas:
            'header'
            'board'
            'aside'
            'footer';
          gap: var(--arena-space-4);
        }
      }
    `,
  ];

  protected override render() {
    return html`
      <div class="frame">
        <header class="header"><slot name="header"></slot></header>
        <main class="board">
          <div class="board-inner"><slot name="board"></slot></div>
        </main>
        <aside class="aside"><slot name="aside"></slot></aside>
        <footer class="footer"><slot name="footer"></slot></footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-room-frame': ArenaRoomFrame;
  }
}
