import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes } from '@agents-arena/ui';

const DOTS = 5;
const BOX_COLS = DOTS - 1;
const BOX_ROWS = DOTS - 1;
const NUM_BOXES = BOX_ROWS * BOX_COLS;
const NUM_H = DOTS * BOX_COLS;
const NUM_EDGES = NUM_H + BOX_ROWS * DOTS;

/** Geometry of the drawing: dot pitch and margins, in SVG user units. */
const PITCH = 60;
const MARGIN = 24;
const SPAN = MARGIN * 2 + PITCH * BOX_COLS;

/** Pixel position of dot (row, col). */
function dot(r: number, c: number): { x: number; y: number } {
  return { x: MARGIN + c * PITCH, y: MARGIN + r * PITCH };
}

/**
 * Read-only Dots and Boxes board for spectators — dots, the edges each side has
 * drawn in their own colour, and captured boxes tinted and initialled. Renders
 * `edges` (40) and `boxes` (16) from a server snapshot's state. There is no
 * move UI — watchers can't click.
 */
@customElement('dab-watch-board')
export class DabWatchBoard extends LitElement {
  /** 40 edges: 20 horizontal then 20 vertical; each "A", "B", or null. */
  @property({ attribute: false }) edges: (string | null)[] = [];
  /** 16 boxes, row-major; each "A", "B", or null. */
  @property({ attribute: false }) boxes: (string | null)[] = [];
  /** Side to move next (read out in the board's accessible label). */
  @property({ type: String }) next = 'A';

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
        --a: #ff7847;
        --b: #3fd8d4;
        --paper: #1a1f2b;
        --dot: #cdd6e6;
        --idle: rgba(205, 214, 230, 0.12);
      }

      .frame {
        width: 100%;
        padding: clamp(8px, 2cqw, 12px);
        border-radius: clamp(10px, 2.6cqw, 16px);
        background: linear-gradient(160deg, #212836 0%, var(--paper) 60%, #141924 100%);
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

      .edge {
        stroke-width: 7;
        stroke-linecap: round;
      }
      .edge.idle {
        stroke: var(--idle);
      }
      .edge.a {
        stroke: var(--a);
      }
      .edge.b {
        stroke: var(--b);
      }

      .box.a {
        fill: color-mix(in srgb, var(--a) 22%, transparent);
      }
      .box.b {
        fill: color-mix(in srgb, var(--b) 22%, transparent);
      }

      .owner {
        font-family: var(--arena-font-mono, monospace);
        font-size: 20px;
        font-weight: 700;
        text-anchor: middle;
        dominant-baseline: central;
      }
      .owner.a {
        fill: var(--a);
      }
      .owner.b {
        fill: var(--b);
      }

      .dot {
        fill: var(--dot);
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
        border-radius: 3px;
      }
      .pip.a {
        background: var(--a);
      }
      .pip.b {
        background: var(--b);
      }
      .side.lead {
        color: var(--arena-text-bright, #f2f5f9);
        font-weight: 600;
      }

      @media (prefers-reduced-motion: no-preference) {
        .box.a,
        .box.b {
          animation: aa-pop 0.35s ease both;
        }
      }
    `,
  ];

  private _edge(i: number): string | null {
    return this.edges.length === NUM_EDGES ? (this.edges[i] ?? null) : null;
  }

  private _box(i: number): string | null {
    return this.boxes.length === NUM_BOXES ? (this.boxes[i] ?? null) : null;
  }

  protected override render() {
    const owned = this.boxes.length === NUM_BOXES ? this.boxes : [];
    const a = owned.filter((o) => o === 'A').length;
    const b = owned.filter((o) => o === 'B').length;
    const done = this.edges.length === NUM_EDGES && this.edges.every((e) => e !== null);
    const label = done ? 'Dots and Boxes grid' : `Dots and Boxes grid, ${this.next} to move`;

    const lines = [];
    for (let r = 0; r < DOTS; r++) {
      for (let c = 0; c < BOX_COLS; c++) {
        const owner = this._edge(r * BOX_COLS + c);
        const from = dot(r, c);
        const to = dot(r, c + 1);
        lines.push(this._line(from, to, owner, `horizontal edge row ${r + 1}, column ${c + 1}`));
      }
    }
    for (let r = 0; r < BOX_ROWS; r++) {
      for (let c = 0; c < DOTS; c++) {
        const owner = this._edge(NUM_H + r * DOTS + c);
        const from = dot(r, c);
        const to = dot(r + 1, c);
        lines.push(this._line(from, to, owner, `vertical edge row ${r + 1}, column ${c + 1}`));
      }
    }

    return html`
      <div class="frame">
        <svg viewBox=${`0 0 ${SPAN} ${SPAN}`} role="group" aria-label=${label}>
          ${Array.from({ length: NUM_BOXES }, (_, i) => {
            const owner = this._box(i);
            if (!owner) return nothing;
            const r = Math.floor(i / BOX_COLS);
            const c = i % BOX_COLS;
            const p = dot(r, c);
            const cls = `box ${owner === 'A' ? 'a' : 'b'}`;
            return html`
              <rect class=${cls} x=${p.x} y=${p.y} width=${PITCH} height=${PITCH} rx="4"></rect>
              <text
                class=${`owner ${owner === 'A' ? 'a' : 'b'}`}
                x=${p.x + PITCH / 2}
                y=${p.y + PITCH / 2}
              >
                ${owner}
              </text>
            `;
          })}
          ${lines}
          ${Array.from({ length: DOTS * DOTS }, (_, i) => {
            const p = dot(Math.floor(i / DOTS), i % DOTS);
            return html`<circle class="dot" cx=${p.x} cy=${p.y} r="5"></circle>`;
          })}
        </svg>
      </div>
      <div class="score" aria-label=${`Boxes: A ${a}, B ${b}`}>
        <span class="side ${a > b ? 'lead' : ''}"><span class="pip a"></span>A ${a}</span>
        <span class="side ${b > a ? 'lead' : ''}"><span class="pip b"></span>B ${b}</span>
      </div>
    `;
  }

  private _line(
    from: { x: number; y: number },
    to: { x: number; y: number },
    owner: string | null,
    label: string,
  ) {
    const cls = `edge ${owner === 'A' ? 'a' : owner === 'B' ? 'b' : 'idle'}`;
    return html`<line
      class=${cls}
      x1=${from.x}
      y1=${from.y}
      x2=${to.x}
      y2=${to.y}
      aria-label=${`${label}: ${owner ?? 'undrawn'}`}
    ></line>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dab-watch-board': DabWatchBoard;
  }
}
