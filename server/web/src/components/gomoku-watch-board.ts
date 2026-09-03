import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

const COLS = 15;
const ROWS = 15;
const SIZE = COLS * ROWS;

/** The four line orientations a five can run along: E, S, SE, SW. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Star points (hoshi) of a 15x15 board, drawn as small dots on the grid. */
const STAR_POINTS = new Set([3 * COLS + 3, 3 * COLS + 11, 7 * COLS + 7, 11 * COLS + 3, 11 * COLS + 11]);

/** Indices of a completed line of five (or more), or null if there is none. */
function winningLine(cells: readonly (string | null)[]): readonly number[] | null {
  if (cells.length !== SIZE) return null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const mark = cells[r * COLS + c];
      if (!mark) continue;
      for (const [dr, dc] of DIRS) {
        const line: number[] = [r * COLS + c];
        for (let k = 1; k < 5; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || cells[rr * COLS + cc] !== mark) break;
          line.push(rr * COLS + cc);
        }
        if (line.length >= 5) return line;
      }
    }
  }
  return null;
}

/**
 * Read-only Gomoku board for spectators — a warm goban with hairline grid,
 * star points, black and white stones, and a marker on the last stone played.
 * Renders `cells` from a server snapshot's `state.board` (225 points,
 * row-major, row 0 = top). There is no move UI — watchers can't click.
 */
@customElement('gomoku-watch-board')
export class GomokuWatchBoard extends LitElement {
  /** 225 points, row-major (row 0 = top); each "B", "W", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'B';
  /** Index of the most recent stone, or null before the first move. */
  @property({ attribute: false }) last: number | null = null;

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 460px;
        font-family: var(--arena-font-sans);
        --wood: #d9a441;
        --wood-dark: #b9812c;
        --line: rgba(60, 32, 8, 0.55);
      }

      .frame {
        width: 100%;
        padding: clamp(10px, 2.4cqw, 16px);
        border-radius: clamp(10px, 2.6cqw, 16px);
        background: linear-gradient(160deg, #e6b45a 0%, var(--wood) 45%, var(--wood-dark) 100%);
        border: 1px solid rgba(0, 0, 0, 0.25);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.3),
          0 18px 40px rgba(0, 0, 0, 0.45);
        container-type: inline-size;
      }

      /* Stones sit ON the intersections, so the grid is drawn as a background
         and each cell centres its stone over a crossing. */
      .grid {
        display: grid;
        grid-template-columns: repeat(15, 1fr);
        width: 100%;
        aspect-ratio: 1;
      }

      .cell {
        position: relative;
        aspect-ratio: 1;
      }
      /* Half-lines from the centre of each cell, clipped at the board edge. */
      .cell::before,
      .cell::after {
        content: '';
        position: absolute;
        background: var(--line);
      }
      .cell::before {
        left: 0;
        right: 0;
        top: 50%;
        height: 1px;
        transform: translateY(-0.5px);
      }
      .cell::after {
        top: 0;
        bottom: 0;
        left: 50%;
        width: 1px;
        transform: translateX(-0.5px);
      }
      .cell.edge-l::before {
        left: 50%;
      }
      .cell.edge-r::before {
        right: 50%;
      }
      .cell.edge-t::after {
        top: 50%;
      }
      .cell.edge-b::after {
        bottom: 50%;
      }

      .star {
        position: absolute;
        inset: 42%;
        border-radius: 50%;
        background: var(--line);
      }

      .stone {
        position: absolute;
        inset: 8%;
        border-radius: 50%;
        z-index: 1;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.45),
          inset 0 -2px 5px rgba(0, 0, 0, 0.3);
      }
      .cell.b .stone {
        background: radial-gradient(circle at 34% 28%, #565b68 0%, #1b1d24 62%, #08090c 100%);
      }
      .cell.w .stone {
        background: radial-gradient(circle at 34% 28%, #ffffff 0%, #ece8e0 55%, #b8b2a6 100%);
      }
      .cell.win .stone {
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.45),
          0 0 14px rgba(255, 214, 102, 0.85),
          0 0 28px rgba(255, 214, 102, 0.6);
      }

      /* A ring on the last stone, so the move that just landed is obvious. */
      .cell.last .stone::after {
        content: '';
        position: absolute;
        inset: 26%;
        border-radius: 50%;
        border: 2px solid rgba(255, 90, 90, 0.9);
      }

      @media (prefers-reduced-motion: no-preference) {
        .stone {
          animation: aa-pop 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
        }
      }
    `,
  ];

  protected override render() {
    const cells =
      this.cells.length === SIZE ? this.cells : new Array<string | null>(SIZE).fill(null);
    const win = winningLine(cells);
    const full = cells.every((c) => c !== null);
    const label = win || full ? 'Gomoku board' : `Gomoku board, ${this.next} to move`;

    return html`
      <div class="frame">
        <div class="grid" role="group" aria-label=${label}>
          ${cells.map((mark, i) => {
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            const cls = [
              'cell',
              mark === 'B' ? 'b' : mark === 'W' ? 'w' : '',
              win?.includes(i) ? 'win' : '',
              this.last === i ? 'last' : '',
              col === 0 ? 'edge-l' : '',
              col === COLS - 1 ? 'edge-r' : '',
              row === 0 ? 'edge-t' : '',
              row === ROWS - 1 ? 'edge-b' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const stone = mark === 'B' ? 'black' : mark === 'W' ? 'white' : 'empty';
            return html`
              <div
                class=${cls}
                role="img"
                aria-label=${`Row ${row + 1}, column ${col + 1}: ${stone}`}
              >
                ${STAR_POINTS.has(i) && !mark ? html`<span class="star"></span>` : nothing}
                ${mark ? html`<span class="stone"></span>` : nothing}
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
    'gomoku-watch-board': GomokuWatchBoard;
  }
}
