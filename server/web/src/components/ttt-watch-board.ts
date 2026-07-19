import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

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

// Strike-line geometry. The board wrapper is square, so `%` lengths on the
// absolutely-positioned strike resolve identically on both axes. The gap is the
// same expression the grid uses, so cell centers are exact at every size.
const GAP = 'min(14px, 3.2cqw)';
const CELL = `((100% - 2 * ${GAP}) / 3)`;
/** Center of row/column `i` as a CSS calc() length. */
const mid = (i: number) => `calc(${i} * (${CELL} + ${GAP}) + ${CELL} / 2)`;
/** Straight strikes run edge-inset-to-edge-inset, like the design's column line. */
const SPAN = 'calc(100% - 20px)';
/** Diagonal length: sqrt(2) × the straight span. */
const DIAG = 'calc(141.42% - 28.28px)';

/**
 * Position + orientation for the strike over a winning triple. The `.arm`
 * wrapper carries the rotation (about its top-center, placed on the line's
 * start point); the inner `.bar` grows along it via the shared aa-strike
 * scaleY animation.
 */
function strikeGeometry(win: readonly [number, number, number]): string {
  const [a, b] = win;
  if (b - a === 1) {
    // Row: start at the left edge inset, rotated to extend rightward.
    const row = Math.floor(a / 3);
    return `left:5px;top:${mid(row)};height:${SPAN};transform:rotate(-90deg)`;
  }
  if (b - a === 3) {
    // Column: the design's vertical line, growing downward.
    const col = a % 3;
    return `left:calc(${mid(col)} - 5px);top:10px;height:${SPAN}`;
  }
  if (a === 0) {
    // Diagonal from top-left, growing toward bottom-right.
    return `left:5px;top:10px;height:${DIAG};transform:rotate(-45deg)`;
  }
  // Diagonal from top-right, growing toward bottom-left.
  return `left:calc(100% - 15px);top:10px;height:${DIAG};transform:rotate(45deg)`;
}

/**
 * Read-only tic-tac-toe board for spectators — the arena's dark "arcade" tiles:
 * rounded near-black cells, big glowing Archivo marks (X violet, O rose), and an
 * animated strike line across a completed triple. Renders `cells` from a server
 * snapshot's `state.board`; there is no move UI — watchers can't click.
 */
@customElement('ttt-watch-board')
export class TttWatchBoard extends LitElement {
  /** 9 cells, row-major; each "X", "O", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'X';

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 472px; /* 3 × 148px cells + 2 × 14px gaps */
        font-family: var(--arena-font-sans);
        --x: var(--arena-violet);
        --o: var(--arena-rose);
        --x-glow: rgba(167, 139, 250, 0.55);
        --o-glow: rgba(255, 122, 158, 0.55);
      }

      /* Square wrapper: the strike overlay measures itself against it (cqw). */
      .boardwrap {
        position: relative;
        width: 100%;
        container-type: inline-size;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: min(14px, 3.2cqw);
        width: 100%;
      }

      .cell {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 1;
        border-radius: clamp(10px, 3.9cqw, 18px);
        background: linear-gradient(180deg, #181524, #100e1a);
        border: 1px solid rgba(255, 255, 255, 0.09);
        box-shadow:
          inset 0 2px 10px rgba(0, 0, 0, 0.5),
          0 8px 20px rgba(0, 0, 0, 0.3);
        transition: box-shadow 0.4s;
      }
      /* Winning cells glow in the winner's color. */
      .cell.win-x {
        box-shadow:
          0 0 30px rgba(167, 139, 250, 0.35),
          inset 0 2px 10px rgba(0, 0, 0, 0.5);
      }
      .cell.win-o {
        box-shadow:
          0 0 30px rgba(255, 122, 158, 0.35),
          inset 0 2px 10px rgba(0, 0, 0, 0.5);
      }

      .mark {
        font-family: var(--arena-font-display);
        font-weight: 900;
        font-size: min(74px, 15.6cqw);
        line-height: 1;
        user-select: none;
      }
      .cell.x .mark {
        color: var(--x);
        text-shadow: 0 0 26px var(--x-glow);
      }
      .cell.o .mark {
        color: var(--o);
        text-shadow: 0 0 26px var(--o-glow);
      }

      /* ---- Strike line across the winning triple -------------------------- */
      .strike {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 3;
      }
      .strike .arm {
        position: absolute;
        width: 10px;
        transform-origin: 50% 0;
      }
      .strike .bar {
        width: 100%;
        height: 100%;
        border-radius: 5px;
        transform-origin: top;
      }
      .strike.x .bar {
        background: linear-gradient(180deg, #bfa8ff, #8f6ef0);
        box-shadow: 0 0 24px rgba(167, 139, 250, 0.6);
      }
      .strike.o .bar {
        background: linear-gradient(180deg, #ffb1c6, #f0608e);
        box-shadow: 0 0 24px rgba(255, 122, 158, 0.6);
      }

      @media (prefers-reduced-motion: no-preference) {
        .mark {
          animation: aa-pop 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
        }
        .strike .bar {
          animation: aa-strike 0.5s cubic-bezier(0.3, 0.8, 0.3, 1) both;
        }
      }
    `,
  ];

  protected override render() {
    const cells = this.cells.length === 9 ? this.cells : new Array<string | null>(9).fill(null);
    const win = winningLine(cells);
    const winMark = win ? cells[win[0]] : null;
    const full = cells.every((c) => c !== null);
    const boardLabel =
      win || full ? 'Tic-tac-toe board' : `Tic-tac-toe board, ${this.next} to move`;

    return html`
      <div class="boardwrap">
        <div class="grid" role="group" aria-label=${boardLabel}>
          ${cells.map((mark, i) => {
            const row = Math.floor(i / 3) + 1;
            const col = (i % 3) + 1;
            const seatClass = mark === 'X' ? 'x' : mark === 'O' ? 'o' : '';
            const winClass = win?.includes(i) ? (winMark === 'O' ? 'win-o' : 'win-x') : '';
            const cls = ['cell', seatClass, winClass].filter(Boolean).join(' ');
            return html`
              <div class=${cls} role="img" aria-label=${`Row ${row}, column ${col}: ${mark ?? 'empty'}`}>
                ${mark ? html`<span class="mark">${mark}</span>` : nothing}
              </div>
            `;
          })}
        </div>
        ${win
          ? html`
              <div class="strike ${winMark === 'O' ? 'o' : 'x'}" aria-hidden="true">
                <div class="arm" style=${strikeGeometry(win)}>
                  <div class="bar"></div>
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ttt-watch-board': TttWatchBoard;
  }
}
