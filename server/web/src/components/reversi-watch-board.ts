import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

const COLS = 8;
const ROWS = 8;
const SIZE = COLS * ROWS;

/** File letters for the accessible per-square labels (a1 = bottom-left). */
const FILES = 'abcdefgh';

/** Algebraic name of a cell index (row 0 = top, so row 0 is rank 8). */
function squareName(i: number): string {
  return `${FILES[i % COLS]}${ROWS - Math.floor(i / COLS)}`;
}

/** Count the discs each seat owns. */
function tally(cells: readonly (string | null)[]): { b: number; w: number } {
  let b = 0;
  let w = 0;
  for (const c of cells) {
    if (c === 'B') b++;
    else if (c === 'W') w++;
  }
  return { b, w };
}

/**
 * Read-only Reversi board for spectators — a green felt 8×8 grid with black and
 * white discs and a running disc count. Renders `cells` from a server
 * snapshot's `state.board` (64 cells, row-major, row 0 = top). There is no move
 * UI — watchers can't click.
 */
@customElement('reversi-watch-board')
export class ReversiWatchBoard extends LitElement {
  /** 64 cells, row-major (row 0 = top); each "B", "W", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'B';

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
        --felt-a: #1e6a45;
        --line: rgba(0, 0, 0, 0.45);
        --frame: #123024;
      }

      .frame {
        width: 100%;
        padding: clamp(8px, 2cqw, 12px);
        border-radius: clamp(10px, 2.6cqw, 16px);
        background: linear-gradient(160deg, #1b4433 0%, var(--frame) 70%, #0d2018 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.14),
          0 18px 40px rgba(0, 0, 0, 0.45);
        container-type: inline-size;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 4px;
        overflow: hidden;
      }

      /* One flat felt with hairline grid lines — a Reversi board is not a
         checkerboard, and alternating squares would read as chess. */
      .cell {
        position: relative;
        aspect-ratio: 1;
        background: var(--felt-a);
        box-shadow: inset -1px -1px 0 var(--line);
      }

      .disc {
        position: absolute;
        inset: 9%;
        border-radius: 50%;
        box-shadow:
          0 2px 5px rgba(0, 0, 0, 0.45),
          inset 0 -3px 6px rgba(0, 0, 0, 0.3);
      }
      .cell.b .disc {
        background: radial-gradient(circle at 34% 28%, #4a4f5c 0%, #1b1d24 60%, #0a0b0f 100%);
      }
      .cell.w .disc {
        background: radial-gradient(circle at 34% 28%, #ffffff 0%, #e6e3dc 55%, #b9b4a8 100%);
      }

      .score {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        margin-top: 10px;
        font-size: 13px;
        color: var(--arena-text-dim, #9aa3b2);
      }
      .side {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-variant-numeric: tabular-nums;
      }
      .pip {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.35);
      }
      .pip.b {
        background: radial-gradient(circle at 34% 28%, #4a4f5c 0%, #14161c 70%);
      }
      .pip.w {
        background: radial-gradient(circle at 34% 28%, #ffffff 0%, #cfcabd 70%);
      }
      .side.lead {
        color: var(--arena-text-bright, #f2f5f9);
        font-weight: 600;
      }

      @media (prefers-reduced-motion: no-preference) {
        .disc {
          animation: aa-pop 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
        }
      }
    `,
  ];

  protected override render() {
    const cells =
      this.cells.length === SIZE ? this.cells : new Array<string | null>(SIZE).fill(null);
    const { b, w } = tally(cells);
    const done = cells.every((c) => c !== null);
    const boardLabel = done ? 'Reversi board' : `Reversi board, ${this.next} to move`;

    return html`
      <div class="frame">
        <div class="grid" role="group" aria-label=${boardLabel}>
          ${cells.map((mark, i) => {
            const seatClass = mark === 'B' ? 'b' : mark === 'W' ? 'w' : '';
            const cls = seatClass ? `cell ${seatClass}` : 'cell';
            const label = mark === 'B' ? 'black' : mark === 'W' ? 'white' : 'empty';
            return html`
              <div class=${cls} role="img" aria-label=${`${squareName(i)}: ${label}`}>
                ${mark ? html`<span class="disc"></span>` : nothing}
              </div>
            `;
          })}
        </div>
      </div>
      <div class="score" aria-label=${`Disc count: black ${b}, white ${w}`}>
        <span class="side ${b > w ? 'lead' : ''}"><span class="pip b"></span>${b}</span>
        <span class="side ${w > b ? 'lead' : ''}"><span class="pip w"></span>${w}</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'reversi-watch-board': ReversiWatchBoard;
  }
}
