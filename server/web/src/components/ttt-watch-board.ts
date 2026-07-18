import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from '@agents-arena/ui';

/** Winning-line triples, row-major. */
const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Find the three cells forming a completed line, or null if none. */
function winningLine(cells: readonly (string | null)[]): readonly [number, number, number] | null {
  for (const [a, b, c] of LINES) {
    const mark = cells[a];
    if (mark && mark === cells[b] && mark === cells[c]) return [a, b, c];
  }
  return null;
}

/**
 * Read-only tic-tac-toe board for spectators. Renders `cells` from a server
 * snapshot's `state.board`; there is no move UI — watchers can't click. Uses the
 * shared arena tokens and seat accent colors so it matches the rest of the shell.
 */
@customElement('ttt-watch-board')
export class TttWatchBoard extends LitElement {
  /** 9 cells, row-major; each "X", "O", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (drives the empty-cell ghost hint). */
  @property({ type: String }) next = 'X';

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 380px;
        aspect-ratio: 1;
        font-family: var(--arena-font-sans);
        --x: var(--arena-seat-1);
        --o: var(--arena-seat-2);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(3, 1fr);
        gap: var(--arena-space-2);
        width: 100%;
        height: 100%;
        padding: var(--arena-space-2);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface-inset);
      }

      .cell {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
        font-size: clamp(28px, 12vw, 64px);
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.03em;
        color: var(--arena-text);
      }

      .cell.x {
        color: var(--x);
      }
      .cell.o {
        color: var(--o);
      }

      .mark {
        display: inline-block;
        transform-origin: center;
      }
      @media (prefers-reduced-motion: no-preference) {
        .mark {
          animation: mark-pop 0.22s cubic-bezier(0.2, 1.5, 0.4, 1) both;
        }
      }

      /* Winning line: seat-tinted wash + ring on the three cells. */
      .cell.win {
        background: color-mix(in srgb, var(--win) 18%, var(--arena-surface));
        box-shadow:
          inset 0 0 0 2px var(--win),
          0 0 22px -8px color-mix(in srgb, var(--win) 70%, transparent);
      }

      @keyframes mark-pop {
        0% {
          opacity: 0;
          transform: scale(0.4);
        }
        100% {
          opacity: 1;
          transform: scale(1);
        }
      }
    `,
  ];

  protected override render() {
    const cells = this.cells.length === 9 ? this.cells : new Array<string | null>(9).fill(null);
    const win = winningLine(cells);
    const winVar = win ? (cells[win[0]] === 'O' ? 'var(--o)' : 'var(--x)') : '';

    return html`
      <div class="grid" role="group" aria-label="Tic-tac-toe board">
        ${cells.map((mark, i) => {
          const row = Math.floor(i / 3) + 1;
          const col = (i % 3) + 1;
          const seatClass = mark === 'X' ? 'x' : mark === 'O' ? 'o' : '';
          const isWin = win?.includes(i) ?? false;
          const cls = ['cell', seatClass, isWin ? 'win' : ''].filter(Boolean).join(' ');
          return html`
            <div
              class=${cls}
              style=${isWin ? `--win: ${winVar}` : ''}
              role="img"
              aria-label=${`Row ${row}, column ${col}: ${mark ?? 'empty'}`}
            >
              ${mark ? html`<span class="mark">${mark}</span>` : ''}
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ttt-watch-board': TttWatchBoard;
  }
}
