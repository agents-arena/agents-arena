import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { arenaTokens, resetStyles } from './theme.js';
import { pieceSvg } from './chess-pieces.js';
import type { PieceKey } from './chess-pieces.js';

declare global {
  interface HTMLElementTagNameMap {
    'arena-chess-board': ArenaChessBoard;
  }
}

interface BoardPiece {
  color: 'w' | 'b';
  type: PieceKey;
}

/** Per-side piece counts (excluding kings for capture math). */
type PieceCounts = Record<PieceKey, number>;

const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const PIECE_NAME: Record<PieceKey, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** Standard starting material per side (kings never "captured" for trays). */
const STARTING: PieceCounts = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

/** Standard chess piece values (king excluded from material calc). */
const PIECE_VALUE: Record<PieceKey, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

/** Display order for captured-piece icons (most valuable first). */
const CAPTURE_ORDER: PieceKey[] = ['q', 'r', 'b', 'n', 'p'];

/** Parse only the placement field of a FEN into a square → piece map. */
function parsePlacement(fen: string): Map<string, BoardPiece> {
  const placement = fen.split(' ')[0] ?? '';
  const map = new Map<string, BoardPiece>();
  const ranks = placement.split('/');
  for (let r = 0; r < Math.min(ranks.length, 8); r++) {
    const rank = 8 - r;
    let file = 0;
    for (const ch of ranks[r] ?? '') {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const lower = ch.toLowerCase();
        if (file < 8 && 'pnbrqk'.includes(lower)) {
          map.set(`${FILES[file]}${rank}`, {
            color: ch === lower ? 'b' : 'w',
            type: lower as PieceKey,
          });
        }
        file++;
      }
    }
  }
  return map;
}

/** Side to move from FEN field 2 ('w'/'b'); defaults to white. */
function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

function emptyCounts(): PieceCounts {
  return { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
}

/** Count pieces remaining on the board for one color. */
function countPieces(pieces: Map<string, BoardPiece>, color: 'w' | 'b'): PieceCounts {
  const c = emptyCounts();
  for (const p of pieces.values()) {
    if (p.color === color) c[p.type]++;
  }
  return c;
}

/**
 * Pieces that have been captured from a side (starting material minus still on board).
 * Pass that side's remaining counts. Kings are never listed as captured.
 */
function capturedOf(remaining: PieceCounts): PieceKey[] {
  const out: PieceKey[] = [];
  for (const type of CAPTURE_ORDER) {
    const missing = Math.max(0, STARTING[type] - remaining[type]);
    for (let i = 0; i < missing; i++) out.push(type);
  }
  return out;
}

/** Material value of a list of captured piece types. */
function materialValue(captured: PieceKey[]): number {
  return captured.reduce((sum, t) => sum + PIECE_VALUE[t], 0);
}

/**
 * Spectator chess board for Agent Arena — cool porcelain-and-slate squares
 * derived from the arena palette, the custom Arena piece set, last-move wash,
 * check glow, slide-in move animation, captured-piece trays with material
 * advantage, and an optional SAN move strip. Purely presentational: it renders
 * a FEN from a server snapshot; watchers can't move.
 */
@customElement('arena-chess-board')
export class ArenaChessBoard extends LitElement {
  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 560px;
        font-family: var(--arena-font-sans, system-ui, sans-serif);

        /* Board + piece palette — arena-native, theme-aware. */
        --board-light: #e8eef8;
        --board-dark: #8fa3c4;
        --board-coord-on-light: color-mix(in srgb, #5a6f96 82%, transparent);
        --board-coord-on-dark: color-mix(in srgb, #f0f4fc 88%, transparent);
        --piece-w-fill: #f7f3ea;
        --piece-w-stroke: #2c3448;
        --piece-b-fill: #343c52;
        --piece-b-stroke: #121722;
        --piece-shadow: drop-shadow(0 1.5px 1.5px rgba(16, 23, 38, 0.28));
        --last-wash: color-mix(in srgb, var(--arena-seat-3) 42%, transparent);
        --last-ring: color-mix(in srgb, var(--arena-seat-3) 72%, var(--arena-text));
        --check-glow: color-mix(in srgb, var(--arena-danger) 72%, transparent);
        --check-ring: color-mix(in srgb, var(--arena-danger) 55%, transparent);
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --board-light: #4a5776;
          --board-dark: #1f283f;
          --board-coord-on-light: color-mix(in srgb, #162033 78%, transparent);
          --board-coord-on-dark: color-mix(in srgb, #a8b6d4 85%, transparent);
          --piece-w-fill: #ece5d5;
          --piece-w-stroke: #1a2032;
          --piece-b-fill: #171d2c;
          --piece-b-stroke: #7a859e;
          --piece-shadow: drop-shadow(0 2px 2.5px rgba(0, 0, 0, 0.55));
          --last-wash: color-mix(in srgb, var(--arena-seat-3) 34%, transparent);
          --last-ring: color-mix(in srgb, var(--arena-seat-3) 80%, #fff);
        }
      }
      :host-context([data-theme='light']) {
        --board-light: #e8eef8;
        --board-dark: #8fa3c4;
        --board-coord-on-light: color-mix(in srgb, #5a6f96 82%, transparent);
        --board-coord-on-dark: color-mix(in srgb, #f0f4fc 88%, transparent);
        --piece-w-fill: #f7f3ea;
        --piece-w-stroke: #2c3448;
        --piece-b-fill: #343c52;
        --piece-b-stroke: #121722;
        --piece-shadow: drop-shadow(0 1.5px 1.5px rgba(16, 23, 38, 0.28));
        --last-wash: color-mix(in srgb, var(--arena-seat-3) 42%, transparent);
        --last-ring: color-mix(in srgb, var(--arena-seat-3) 72%, var(--arena-text));
      }
      :host-context([data-theme='dark']) {
        --board-light: #4a5776;
        --board-dark: #1f283f;
        --board-coord-on-light: color-mix(in srgb, #162033 78%, transparent);
        --board-coord-on-dark: color-mix(in srgb, #a8b6d4 85%, transparent);
        --piece-w-fill: #ece5d5;
        --piece-w-stroke: #1a2032;
        --piece-b-fill: #171d2c;
        --piece-b-stroke: #7a859e;
        --piece-shadow: drop-shadow(0 2px 2.5px rgba(0, 0, 0, 0.55));
        --last-wash: color-mix(in srgb, var(--arena-seat-3) 34%, transparent);
        --last-ring: color-mix(in srgb, var(--arena-seat-3) 80%, #fff);
      }

      .wrap {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-2);
        width: 100%;
        min-width: 0;
      }

      /* Captured-piece trays above / below the board. */
      .tray {
        display: flex;
        align-items: center;
        gap: 2px;
        min-height: 22px;
        padding: 0 2px;
        flex-wrap: wrap;
      }
      .tray .cap {
        display: inline-flex;
        width: 18px;
        height: 18px;
        opacity: 0.88;
      }
      .tray .cap svg {
        width: 100%;
        height: 100%;
        display: block;
        filter: drop-shadow(0 0.5px 0.5px rgba(16, 23, 38, 0.2));
      }
      .tray .cap.w {
        --piece-fill: var(--piece-w-fill);
        --piece-stroke: var(--piece-w-stroke);
      }
      .tray .cap.b {
        --piece-fill: var(--piece-b-fill);
        --piece-stroke: var(--piece-b-stroke);
      }
      .tray .adv {
        margin-left: var(--arena-space-1);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--arena-text-muted);
        letter-spacing: 0.02em;
      }

      .board {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        grid-template-rows: repeat(8, 1fr);
        aspect-ratio: 1;
        width: 100%;
        max-width: 100%;
        border-radius: var(--arena-radius-md);
        overflow: hidden;
        border: 1px solid var(--arena-border-strong);
        box-shadow: var(--arena-shadow-1);
        background: var(--board-dark);
      }

      .sq {
        position: relative;
        background: var(--board-light);
      }
      .sq.dark {
        background: var(--board-dark);
      }
      .sq.last {
        background-image: linear-gradient(var(--last-wash), var(--last-wash));
      }
      /* Origin square of the last move — subtle ring so direction is clear. */
      .sq.last-from::after {
        content: '';
        position: absolute;
        inset: 6%;
        border-radius: 3px;
        border: 1.5px solid var(--last-ring);
        opacity: 0.7;
        pointer-events: none;
        z-index: 1;
      }
      .sq.check {
        background-image:
          radial-gradient(circle at 50% 50%, var(--check-glow) 0%, transparent 68%),
          linear-gradient(var(--check-ring), var(--check-ring));
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--arena-danger) 45%, transparent);
      }

      .piece {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
      }
      .piece svg {
        width: 88%;
        height: 88%;
        display: block;
        filter: var(--piece-shadow);
      }
      .piece.w {
        --piece-fill: var(--piece-w-fill);
        --piece-stroke: var(--piece-w-stroke);
      }
      .piece.b {
        --piece-fill: var(--piece-b-fill);
        --piece-stroke: var(--piece-b-stroke);
      }
      .piece.slide {
        animation: slide 0.18s cubic-bezier(0.2, 0.8, 0.3, 1);
      }
      @keyframes slide {
        from {
          transform: translate(var(--dx, 0%), var(--dy, 0%));
        }
        to {
          transform: translate(0, 0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .piece.slide {
          animation: none;
        }
      }

      /* In-square coordinates — high-contrast, tucked into corners. */
      .coord {
        position: absolute;
        font-size: clamp(8px, 1.5vw, 10px);
        line-height: 1;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
        pointer-events: none;
        user-select: none;
        opacity: 0.92;
        z-index: 1;
      }
      .coord.file {
        right: 5%;
        bottom: 5%;
      }
      .coord.rank {
        left: 5%;
        top: 5%;
      }
      .sq .coord {
        color: var(--board-coord-on-light);
      }
      .sq.dark .coord {
        color: var(--board-coord-on-dark);
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      /* SAN strip — the last few moves, newest emphasized. */
      .san {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 6px;
        flex-wrap: nowrap;
        overflow: hidden;
        margin-top: 0;
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-sm);
        color: var(--arena-text-muted);
        white-space: nowrap;
      }
      .san .n {
        color: var(--arena-text-faint);
        font-size: var(--arena-text-xs);
      }
      .san .mv:last-of-type {
        color: var(--arena-text);
        font-weight: 700;
      }
      .san[hidden] {
        display: none;
      }

      @media (max-width: 360px) {
        .tray .cap {
          width: 14px;
          height: 14px;
        }
      }
    `,
  ];

  /** Full FEN of the position to render (fields 1–2 are used). */
  @property({ type: String }) fen = DEFAULT_FEN;

  /** Last move played, for the amber square wash + slide animation. */
  @property({ attribute: false }) lastMove: { from: string; to: string } | null = null;

  /** When true, the side-to-move's king square glows red. */
  @property({ type: Boolean }) check = false;

  /** SAN move history; when non-empty the last few moves render under the board. */
  @property({ attribute: false }) sanHistory: string[] = [];

  /** 'black' flips the board; anything else renders from white's side. */
  @property({ type: String }) perspective: string | null = null;

  /** When true (default), show captured-piece trays and material advantage. */
  @property({ type: Boolean }) showCaptured = true;

  /** Slide animation for the piece that just landed (per fen change). */
  private anim: { to: string; dx: number; dy: number } | null = null;

  private prevFen = '';

  protected override willUpdate(): void {
    if (this.fen !== this.prevFen) {
      this.anim = null;
      if (this.prevFen && this.lastMove) {
        const flip = this.perspective === 'black' ? -1 : 1;
        const from = this.lastMove.from;
        const to = this.lastMove.to;
        const dCol = (from.charCodeAt(0) - to.charCodeAt(0)) * flip;
        const dRow = (Number(to[1]) - Number(from[1])) * flip;
        this.anim = { to, dx: dCol * 100, dy: dRow * 100 };
      }
      this.prevFen = this.fen;
    }
  }

  /** Render a tray of captured pieces for one side, with optional advantage. */
  private _tray(captured: PieceKey[], color: 'w' | 'b', advantage: number) {
    if (captured.length === 0 && advantage <= 0) {
      return html`<div class="tray" aria-hidden=${advantage <= 0 ? 'true' : 'false'}></div>`;
    }
    return html`
      <div
        class="tray"
        aria-label=${`${color === 'w' ? 'White' : 'Black'} captured pieces${
          advantage > 0 ? `, material advantage +${advantage}` : ''
        }`}
      >
        ${captured.map(
          (type) => html`
            <span class="cap ${color}" title=${PIECE_NAME[type]}>
              ${pieceSvg(type)}
            </span>
          `,
        )}
        ${advantage > 0 ? html`<span class="adv">+${advantage}</span>` : nothing}
      </div>
    `;
  }

  protected override render() {
    const pieces = parsePlacement(this.fen);
    const flipped = this.perspective === 'black';
    const mover = sideToMove(this.fen);

    // Captured material: each tray shows pieces taken *from* the opponent.
    const whiteOnBoard = countPieces(pieces, 'w');
    const blackOnBoard = countPieces(pieces, 'b');
    // Black pieces captured by white (missing black pieces).
    const whiteCaptured = capturedOf(blackOnBoard);
    // White pieces captured by black (missing white pieces).
    const blackCaptured = capturedOf(whiteOnBoard);
    const whiteMat = materialValue(whiteCaptured);
    const blackMat = materialValue(blackCaptured);
    const whiteAdv = whiteMat > blackMat ? whiteMat - blackMat : 0;
    const blackAdv = blackMat > whiteMat ? blackMat - whiteMat : 0;

    // The check glow sits on the side-to-move's king, found from the FEN.
    let checkSquare: string | null = null;
    if (this.check) {
      for (const [sq, piece] of pieces) {
        if (piece.type === 'k' && piece.color === mover) {
          checkSquare = sq;
          break;
        }
      }
    }

    const squares = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const file = flipped ? 7 - col : col;
        const rank = flipped ? row + 1 : 8 - row;
        const sq = `${FILES[file]}${rank}`;
        const piece = pieces.get(sq) ?? null;
        const isDark = (file + rank) % 2 !== 0;
        const isLastFrom = this.lastMove !== null && this.lastMove.from === sq;
        const isLastTo = this.lastMove !== null && this.lastMove.to === sq;
        const isLast = isLastFrom || isLastTo;
        const slide = this.anim !== null && this.anim.to === sq;

        const cls = [
          'sq',
          isDark ? 'dark' : '',
          isLast ? 'last' : '',
          isLastFrom ? 'last-from' : '',
          checkSquare === sq ? 'check' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const label = piece
          ? `${sq}: ${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAME[piece.type]}`
          : `${sq}: empty`;

        squares.push(
          keyed(
            `${sq}|${this.fen}`,
            html`
              <div class=${cls} role="img" aria-label=${label}>
                ${piece
                  ? html`
                      <span
                        class="piece ${piece.color} ${slide ? 'slide' : ''}"
                        style=${slide
                          ? `--dx:${this.anim!.dx}%;--dy:${this.anim!.dy}%`
                          : ''}
                      >
                        ${pieceSvg(piece.type)}
                      </span>
                    `
                  : nothing}
                ${row === 7
                  ? html`<span class="coord file">${FILES[file]}</span>`
                  : nothing}
                ${col === 0 ? html`<span class="coord rank">${rank}</span>` : nothing}
              </div>
            `,
          ),
        );
      }
    }

    // Trays: far side = opponent from viewer perspective, near = self.
    // whiteCaptured = black piece types white took → black icons, white advantage.
    // blackCaptured = white piece types black took → white icons, black advantage.
    const topCaptured = flipped ? whiteCaptured : blackCaptured;
    const topIconColor: 'w' | 'b' = flipped ? 'b' : 'w';
    const topAdv = flipped ? whiteAdv : blackAdv;

    const botCaptured = flipped ? blackCaptured : whiteCaptured;
    const botIconColor: 'w' | 'b' = flipped ? 'w' : 'b';
    const botAdv = flipped ? blackAdv : whiteAdv;

    return html`
      <div class="wrap">
        ${this.showCaptured ? this._tray(topCaptured, topIconColor, topAdv) : nothing}
        <div class="board" role="group" aria-label="Chess board">
          ${squares}
          ${this.check
            ? html`<span class="sr-only">King in check</span>`
            : nothing}
        </div>
        ${this.showCaptured ? this._tray(botCaptured, botIconColor, botAdv) : nothing}
        <div class="san" aria-label="Recent moves" ?hidden=${this.sanHistory.length === 0}>
          ${this._sanParts()}
        </div>
      </div>
    `;
  }

  /** The last few SAN moves as "n. white black" groups, newest emphasized. */
  private _sanParts() {
    const tail = this.sanHistory.slice(-8);
    const offset = this.sanHistory.length - tail.length;
    const parts = [];
    for (let i = 0; i < tail.length; i++) {
      const ply = offset + i;
      if (ply % 2 === 0) {
        parts.push(html`<span class="n">${ply / 2 + 1}.</span>`);
      } else if (i === 0) {
        parts.push(html`<span class="n">${Math.floor(ply / 2) + 1}…</span>`);
      }
      parts.push(html`<span class="mv">${tail[i]}</span>`);
    }
    return parts;
  }
}
