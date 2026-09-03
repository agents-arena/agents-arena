import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

const POINTS = 24;

/** Positions of the 24 points on a 100×100 grid, three nested squares. */
const XY: readonly (readonly [number, number])[] = [
  [6, 6], [50, 6], [94, 6],
  [20, 20], [50, 20], [80, 20],
  [34, 34], [50, 34], [66, 34],
  [6, 50], [20, 50], [34, 50],
  [66, 50], [80, 50], [94, 50],
  [34, 66], [50, 66], [66, 66],
  [20, 80], [50, 80], [80, 80],
  [6, 94], [50, 94], [94, 94],
];

/** The sixteen mills, drawn as the board's lines. */
const MILLS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [9, 10, 11], [12, 13, 14],
  [15, 16, 17], [18, 19, 20], [21, 22, 23],
  [0, 9, 21], [3, 10, 18], [6, 11, 15],
  [1, 4, 7], [16, 19, 22],
  [8, 12, 17], [5, 13, 20], [2, 14, 23],
];

/** Does seat own a completed mill through point p? */
function inMill(cells: readonly (string | null)[], p: number, seat: string): boolean {
  return MILLS.some(
    (m) => m.includes(p) && m.every((q) => cells[q] === seat),
  );
}

/**
 * Read-only Nine Men's Morris board for spectators — three nested squares with
 * men on the 24 points, mills highlighted, and the men still in hand shown
 * beside the board. Renders `cells` (24) from a server snapshot's state.
 * There is no move UI — watchers can't click.
 */
@customElement('morris-watch-board')
export class MorrisWatchBoard extends LitElement {
  /** 24 points; each "W", "B", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'W';
  /** Men white still has to place. */
  @property({ type: Number }) handW = 9;
  /** Men black still has to place. */
  @property({ type: Number }) handB = 9;

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
        --wood: #c99a5b;
        --line: rgba(48, 26, 10, 0.75);
        --white: #f2ece0;
        --black: #23262e;
      }

      .frame {
        width: 100%;
        padding: clamp(10px, 2.4cqw, 16px);
        border-radius: clamp(10px, 2.6cqw, 16px);
        background: linear-gradient(160deg, #d8ac6c 0%, var(--wood) 50%, #a87c42 100%);
        border: 1px solid rgba(0, 0, 0, 0.3);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.28),
          0 18px 40px rgba(0, 0, 0, 0.45);
      }

      svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
      }

      .line {
        stroke: var(--line);
        stroke-width: 1.4;
        stroke-linecap: round;
      }
      .spot {
        fill: var(--line);
      }

      .man.w {
        fill: var(--white);
        stroke: rgba(0, 0, 0, 0.35);
        stroke-width: 0.8;
      }
      .man.b {
        fill: var(--black);
        stroke: rgba(255, 255, 255, 0.25);
        stroke-width: 0.8;
      }
      .man.mill {
        stroke: #ffd666;
        stroke-width: 1.8;
      }

      .hands {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 18px;
        margin-top: 10px;
        font-size: 13px;
        color: var(--arena-text-dim, #9aa3b2);
        font-variant-numeric: tabular-nums;
      }
      .side {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .pip {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.35);
      }
      .pip.w {
        background: var(--white);
      }
      .pip.b {
        background: var(--black);
      }

      @media (prefers-reduced-motion: no-preference) {
        .man {
          animation: aa-pop 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
        }
      }
    `,
  ];

  protected override render() {
    const cells =
      this.cells.length === POINTS ? this.cells : new Array<string | null>(POINTS).fill(null);
    const label = `Nine Men's Morris board, ${this.next} to move`;
    const onBoard = (seat: string) => cells.filter((c) => c === seat).length;

    return html`
      <div class="frame">
        <svg viewBox="0 0 100 100" role="group" aria-label=${label}>
          ${MILLS.map(([a, , c]) => {
            const [x1, y1] = XY[a]!;
            const [x2, y2] = XY[c]!;
            return html`<line class="line" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>`;
          })}
          ${cells.map((seat, i) => {
            const [x, y] = XY[i]!;
            if (!seat) {
              return html`<circle
                class="spot"
                cx=${x}
                cy=${y}
                r="1.6"
                role="img"
                aria-label=${`Point ${i}: empty`}
              ></circle>`;
            }
            const cls = [
              'man',
              seat === 'W' ? 'w' : 'b',
              inMill(cells, i, seat) ? 'mill' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return html`<circle
              class=${cls}
              cx=${x}
              cy=${y}
              r="4.6"
              role="img"
              aria-label=${`Point ${i}: ${seat === 'W' ? 'white' : 'black'}`}
            ></circle>`;
          })}
        </svg>
      </div>
      <div class="hands">
        <span class="side"
          ><span class="pip w"></span>W ${onBoard('W')} on board · ${this.handW} in hand</span
        >
        <span class="side"
          ><span class="pip b"></span>B ${onBoard('B')} on board · ${this.handB} in hand</span
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'morris-watch-board': MorrisWatchBoard;
  }
}
