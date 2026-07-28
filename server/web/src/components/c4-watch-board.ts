import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

const COLS = 7;
const ROWS = 6;
const SIZE = COLS * ROWS;

/** Directions for a completed four-in-a-row: E, S, SE, SW. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Find four cell indices forming a completed line, or null if none. */
function winningLine(cells: readonly (string | null)[]): readonly number[] | null {
  if (cells.length !== SIZE) return null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const mark = cells[r * COLS + c];
      if (!mark) continue;
      for (const [dr, dc] of DIRS) {
        const line: number[] = [r * COLS + c];
        let ok = true;
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || cells[rr * COLS + cc] !== mark) {
            ok = false;
            break;
          }
          line.push(rr * COLS + cc);
        }
        if (ok) return line;
      }
    }
  }
  return null;
}

/**
 * Read-only Connect Four board for spectators — a deep blue frame with glossy
 * red / yellow discs. Renders `cells` from a server snapshot's `state.board`
 * (42 cells, row-major, row 0 = top). There is no move UI — watchers can't click.
 */
@customElement('c4-watch-board')
export class C4WatchBoard extends LitElement {
  /** 42 cells, row-major (row 0 = top); each "R", "Y", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'R';

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 420px;
        font-family: var(--arena-font-sans);
        --r: #e23b3b;
        --y: #f0c440;
        --r-glow: rgba(226, 59, 59, 0.55);
        --y-glow: rgba(240, 196, 64, 0.5);
        --frame: #1a4a8a;
        --frame-hi: #2a6ab8;
        --hole: #0b1220;
      }

      .frame {
        position: relative;
        width: 100%;
        padding: clamp(10px, 2.4cqw, 14px);
        border-radius: clamp(14px, 3.6cqw, 20px);
        background:
          linear-gradient(165deg, var(--frame-hi) 0%, var(--frame) 55%, #12366a 100%);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.18),
          inset 0 -8px 18px rgba(0, 0, 0, 0.35),
          0 18px 40px rgba(0, 0, 0, 0.45);
        container-type: inline-size;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: min(8px, 1.8cqw);
        width: 100%;
      }

      .cell {
        position: relative;
        aspect-ratio: 1;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #152038 0%, var(--hole) 70%);
        box-shadow:
          inset 0 3px 8px rgba(0, 0, 0, 0.65),
          inset 0 -1px 0 rgba(255, 255, 255, 0.06);
      }

      .disc {
        position: absolute;
        inset: 6%;
        border-radius: 50%;
        box-shadow:
          inset 0 -4px 8px rgba(0, 0, 0, 0.35),
          inset 0 3px 6px rgba(255, 255, 255, 0.35),
          0 2px 6px rgba(0, 0, 0, 0.35);
      }
      .cell.r .disc {
        background: radial-gradient(circle at 32% 28%, #ff6b6b 0%, var(--r) 55%, #a81f1f 100%);
      }
      .cell.y .disc {
        background: radial-gradient(circle at 32% 28%, #ffe08a 0%, #f0c440 55%, #c49212 100%);
      }
      .cell.win-r .disc {
        box-shadow:
          inset 0 -4px 8px rgba(0, 0, 0, 0.35),
          inset 0 3px 6px rgba(255, 255, 255, 0.35),
          0 0 18px var(--r-glow),
          0 0 32px var(--r-glow);
      }
      .cell.win-y .disc {
        box-shadow:
          inset 0 -4px 8px rgba(0, 0, 0, 0.35),
          inset 0 3px 6px rgba(255, 255, 255, 0.35),
          0 0 18px var(--y-glow),
          0 0 32px var(--y-glow);
      }

      @media (prefers-reduced-motion: no-preference) {
        .disc {
          animation: aa-pop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
        }
      }
    `,
  ];

  protected override render() {
    const cells =
      this.cells.length === SIZE ? this.cells : new Array<string | null>(SIZE).fill(null);
    const win = winningLine(cells);
    const winIdx = win?.[0];
    const winMark = winIdx !== undefined ? cells[winIdx] : null;
    const full = cells.every((c) => c !== null);
    const boardLabel =
      win || full ? 'Connect Four board' : `Connect Four board, ${this.next} to move`;

    return html`
      <div class="frame">
        <div class="grid" role="group" aria-label=${boardLabel}>
          ${cells.map((mark, i) => {
            const row = Math.floor(i / COLS) + 1;
            const col = (i % COLS) + 1;
            const seatClass = mark === 'R' ? 'r' : mark === 'Y' ? 'y' : '';
            const winClass = win?.includes(i)
              ? winMark === 'Y'
                ? 'win-y'
                : 'win-r'
              : '';
            const cls = ['cell', seatClass, winClass].filter(Boolean).join(' ');
            const label = mark === 'R' ? 'red' : mark === 'Y' ? 'yellow' : 'empty';
            return html`
              <div
                class=${cls}
                role="img"
                aria-label=${`Row ${row}, column ${col}: ${label}`}
              >
                ${mark ? html`<span class="disc"></span>` : nothing}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'c4-watch-board': C4WatchBoard;
  }
}
