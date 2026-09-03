import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

const COLS = 8;
const ROWS = 8;
const SIZE = COLS * ROWS;

/** Files for the accessible square labels (a1 = bottom-left). */
const FILES = 'abcdefgh';

function squareName(i: number): string {
  return `${FILES[i % COLS]}${ROWS - Math.floor(i / COLS)}`;
}

/** Spoken description of a piece code. */
function pieceLabel(p: string | null): string {
  switch (p) {
    case 'r':
      return 'red man';
    case 'R':
      return 'red king';
    case 'b':
      return 'black man';
    case 'B':
      return 'black king';
    default:
      return 'empty';
  }
}

/** Count the pieces each seat still has. */
function tally(cells: readonly (string | null)[]): { r: number; b: number } {
  let r = 0;
  let b = 0;
  for (const c of cells) {
    if (c === 'r' || c === 'R') r++;
    else if (c === 'b' || c === 'B') b++;
  }
  return { r, b };
}

/**
 * Read-only Checkers board for spectators — a wooden 8×8 with pieces on the
 * dark squares, crowns on kings, and a ring on the piece that must keep
 * jumping. Renders `cells` from a server snapshot's `state.board` (64 squares,
 * row-major, row 0 = top). There is no move UI — watchers can't click.
 */
@customElement('checkers-watch-board')
export class CheckersWatchBoard extends LitElement {
  /** 64 squares, row-major (row 0 = top); "r", "R", "b", "B", or null. */
  @property({ attribute: false }) cells: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'R';
  /** Square of a piece mid-multi-jump, or null. */
  @property({ attribute: false }) chain: number | null = null;

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 440px;
        font-family: var(--arena-font-sans);
        --light: #d8c3a0;
        --dark: #6b4530;
        --red: #d8443c;
        --black: #23262e;
      }

      .frame {
        width: 100%;
        padding: clamp(8px, 2cqw, 12px);
        border-radius: clamp(10px, 2.6cqw, 16px);
        background: linear-gradient(160deg, #5a3a26 0%, #3f281a 70%, #2a1a11 100%);
        border: 1px solid rgba(0, 0, 0, 0.35);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 18px 40px rgba(0, 0, 0, 0.45);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        width: 100%;
        border-radius: 4px;
        overflow: hidden;
      }

      .sq {
        position: relative;
        aspect-ratio: 1;
        background: var(--light);
      }
      .sq.dark {
        background: var(--dark);
      }

      .piece {
        position: absolute;
        inset: 12%;
        border-radius: 50%;
        display: grid;
        place-items: center;
        box-shadow:
          0 3px 5px rgba(0, 0, 0, 0.5),
          inset 0 -3px 6px rgba(0, 0, 0, 0.35),
          inset 0 3px 6px rgba(255, 255, 255, 0.25);
      }
      .piece.r {
        background: radial-gradient(circle at 34% 28%, #ff7a6f 0%, var(--red) 55%, #8e211c 100%);
      }
      .piece.b {
        background: radial-gradient(circle at 34% 28%, #575d6b 0%, var(--black) 60%, #0c0e13 100%);
      }
      /* A ridged rim, the way a stacked draughtsman looks from above. */
      .piece::before {
        content: '';
        position: absolute;
        inset: 16%;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.25);
      }
      .crown {
        position: relative;
        font-size: 60%;
        line-height: 1;
        color: rgba(255, 226, 150, 0.95);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      }

      .sq.chain .piece {
        box-shadow:
          0 3px 5px rgba(0, 0, 0, 0.5),
          0 0 0 3px rgba(255, 214, 102, 0.95),
          0 0 16px rgba(255, 214, 102, 0.7);
      }

      .score {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
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
      }
      .pip.r {
        background: var(--red);
      }
      .pip.b {
        background: #4a5060;
      }
      .side.lead {
        color: var(--arena-text-bright, #f2f5f9);
        font-weight: 600;
      }

      @media (prefers-reduced-motion: no-preference) {
        .piece {
          animation: aa-pop 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
        }
      }
    `,
  ];

  protected override render() {
    const cells =
      this.cells.length === SIZE ? this.cells : new Array<string | null>(SIZE).fill(null);
    const { r, b } = tally(cells);
    const label = `Checkers board, ${this.next} to move`;

    return html`
      <div class="frame">
        <div class="grid" role="group" aria-label=${label}>
          ${cells.map((p, i) => {
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            const dark = (row + col) % 2 === 1;
            const seat = p === 'r' || p === 'R' ? 'r' : p ? 'b' : '';
            const cls = ['sq', dark ? 'dark' : '', this.chain === i ? 'chain' : '']
              .filter(Boolean)
              .join(' ');
            return html`
              <div class=${cls} role="img" aria-label=${`${squareName(i)}: ${pieceLabel(p)}`}>
                ${p
                  ? html`<span class=${`piece ${seat}`}>
                      ${p === 'R' || p === 'B' ? html`<span class="crown">♛</span>` : nothing}
                    </span>`
                  : nothing}
              </div>
            `;
          })}
        </div>
      </div>
      <div class="score" aria-label=${`Pieces: red ${r}, black ${b}`}>
        <span class="side ${r > b ? 'lead' : ''}"><span class="pip r"></span>R ${r}</span>
        <span class="side ${b > r ? 'lead' : ''}"><span class="pip b"></span>B ${b}</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'checkers-watch-board': CheckersWatchBoard;
  }
}
