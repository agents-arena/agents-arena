import { LitElement, html, svg, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

const COLS = 11;
const ROWS = 11;
const SIZE = COLS * ROWS;

/** Flat-top hexagon geometry, in SVG user units. */
const R = 22; // circumradius
const DX = Math.sqrt(3) * R; // horizontal step between cell centres
const DY = 1.5 * R; // vertical step between rows
/** Padding has to clear the goal bands, which sit outside the playing grid. */
const PAD = 48;

/** Centre of the cell at (row, col); each row is shifted half a step right. */
function centre(r: number, c: number): { x: number; y: number } {
  return { x: PAD + DX * (c + r / 2), y: PAD + DY * r };
}

/** The six corners of a pointy-top hexagon around (x, y). */
function hexPoints(x: number, y: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(x + R * Math.cos(a)).toFixed(2)},${(y + R * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Extents including the goal bands at -0.62 and (count - 0.38). */
const WIDTH = PAD + DX * (COLS - 0.38 + (ROWS - 1) / 2) + R;
const HEIGHT = PAD + DY * (ROWS - 0.38) + R;

/**
 * Read-only Hex board for spectators — an 11×11 rhombus of hexagons with red's
 * left/right edges and blue's top/bottom edges banded in their colours, and a
 * ring on the last stone. Renders `cells` from a server snapshot's
 * `state.board` (121 cells, row-major). There is no move UI.
 */
@customElement('hex-watch-board')
export class HexWatchBoard extends LitElement {
  /** 121 cells, row-major (row 0 = top); each "R", "B", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'R';
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
        max-width: 520px;
        font-family: var(--arena-font-sans);
        --red: #e0524a;
        --blue: #4aa3e0;
        --empty: #2a3040;
        --edge: #171c26;
      }

      .frame {
        width: 100%;
        padding: clamp(6px, 1.6cqw, 10px);
        border-radius: clamp(10px, 2.6cqw, 16px);
        background: linear-gradient(160deg, #1d2432 0%, #151a25 60%, #0e121a 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.12),
          0 18px 40px rgba(0, 0, 0, 0.45);
      }

      svg {
        display: block;
        width: 100%;
        height: auto;
      }

      .cell {
        fill: var(--empty);
        stroke: var(--edge);
        stroke-width: 2;
      }
      .cell.r {
        fill: var(--red);
      }
      .cell.b {
        fill: var(--blue);
      }
      .cell.last {
        stroke: rgba(255, 226, 150, 0.95);
        stroke-width: 3.5;
      }

      /* The bands that say which edges each side is trying to join. */
      .band.r {
        fill: color-mix(in srgb, var(--red) 55%, transparent);
      }
      .band.b {
        fill: color-mix(in srgb, var(--blue) 55%, transparent);
      }

      .legend {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        margin-top: 10px;
        font-size: 12px;
        color: var(--arena-text-dim, #9aa3b2);
      }
      .side {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .pip {
        width: 12px;
        height: 12px;
        border-radius: 3px;
      }
      .pip.r {
        background: var(--red);
      }
      .pip.b {
        background: var(--blue);
      }

      @media (prefers-reduced-motion: no-preference) {
        .cell.r,
        .cell.b {
          animation: aa-pop 0.3s ease both;
        }
      }
    `,
  ];

  protected override render() {
    const cells =
      this.cells.length === SIZE ? this.cells : new Array<string | null>(SIZE).fill(null);
    const label = `Hex board, ${this.next} to move`;

    return html`
      <div class="frame">
        <svg viewBox=${`0 0 ${WIDTH.toFixed(1)} ${HEIGHT.toFixed(1)}`} role="group" aria-label=${label}>
          ${this._bands()}
          ${cells.map((mark, i) => {
            const r = Math.floor(i / COLS);
            const c = i % COLS;
            const { x, y } = centre(r, c);
            const cls = [
              'cell',
              mark === 'R' ? 'r' : mark === 'B' ? 'b' : '',
              this.last === i ? 'last' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const who = mark === 'R' ? 'red' : mark === 'B' ? 'blue' : 'empty';
            // Fragments nested inside <svg> must use lit's `svg` tag, or they
            // are built in the HTML namespace and never paint.
            return svg`<polygon
              class=${cls}
              points=${hexPoints(x, y)}
              role="img"
              aria-label=${`Row ${r + 1}, column ${c + 1}: ${who}`}
            ></polygon>`;
          })}
        </svg>
      </div>
      <div class="legend">
        <span class="side"><span class="pip r"></span>R joins left ↔ right</span>
        <span class="side"><span class="pip b"></span>B joins top ↕ bottom</span>
      </div>
    `;
  }

  /** Thin wedges along the four edges, coloured by whose goal they are. */
  private _bands() {
    const bands = [];
    for (let r = 0; r < ROWS; r++) {
      for (const [c, side] of [
        [-0.62, 'r'],
        [COLS - 0.38, 'r'],
      ] as const) {
        const { x, y } = centre(r, c);
        bands.push(
          svg`<polygon class=${`band ${side}`} points=${hexPoints(x, y)}></polygon>`,
        );
      }
    }
    for (let c = 0; c < COLS; c++) {
      for (const [r, side] of [
        [-0.62, 'b'],
        [ROWS - 0.38, 'b'],
      ] as const) {
        const { x, y } = centre(r, c);
        bands.push(
          svg`<polygon class=${`band ${side}`} points=${hexPoints(x, y)}></polygon>`,
        );
      }
    }
    return bands;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hex-watch-board': HexWatchBoard;
  }
}
