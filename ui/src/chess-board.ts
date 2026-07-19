import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import {
  arenaTokens,
  resetStyles,
  arenaKeyframes,
  BOARD_THEMES,
  BOARD_THEME_ORDER,
  BOARD_THEME_EVENT,
  DEFAULT_BOARD_THEME,
  loadBoardTheme,
  saveBoardTheme,
  seatAccentVar,
} from './theme.js';
import type { BoardThemeName } from './theme.js';
import { pieceSvg } from './chess-pieces.js';
import type { PieceKey } from './chess-pieces.js';

declare global {
  interface HTMLElementTagNameMap {
    'arena-chess-board': ArenaChessBoard;
  }
}

/** How a finished game ended; the parent decides when to pass one. */
export type ChessResult = { kind: 'win'; winner: string } | { kind: 'draw' };

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

/** Points of material advantage per 1% of eval-bar fill (±45% cap). */
const EVAL_GAIN = 5;

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
 * Spectator chess board for Agent Arena — the "wood table" look: carved wooden
 * pieces on a walnut/maple/ebony board inside a gradient timber frame, with a
 * material eval bar, captured-piece trays, last-move gold wash, check pulse,
 * capture bursts, SAN chips, and a checkmate/draw overlay. Purely
 * presentational: it renders a FEN from a server snapshot; watchers can't move.
 */
@customElement('arena-chess-board')
export class ArenaChessBoard extends LitElement {
  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 644px;
        font-family: var(--arena-font-sans, system-ui, sans-serif);

        /* Board coordinates + tray/highlight palette (single dark theme). */
        --coord-ink: rgba(235, 222, 199, 0.5);
        --wood-grain: repeating-linear-gradient(
          98deg,
          rgba(255, 255, 255, 0.05) 0 2px,
          rgba(0, 0, 0, 0.04) 2px 5px
        );
      }

      .wrap {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        min-width: 0;
      }

      /* ---- Captured trays + wood picker ---------------------------------- */
      .meta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        min-height: 26px;
        padding: 0 2px;
      }
      .tray {
        display: flex;
        align-items: center;
        gap: 5px;
        min-height: 26px;
        flex-wrap: wrap;
      }
      .tray .cap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
      }
      .tray .cap svg {
        width: 82%;
        height: 82%;
        display: block;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
      }
      /* White pieces lost to the opponent — cream figures on a dark tile. */
      .tray .cap.w {
        background: rgba(0, 0, 0, 0.3);
        --piece-fill: var(--arena-piece-white);
        --piece-stroke: var(--arena-piece-white-edge);
      }
      /* Black pieces lost — near-black figures on a cream tile. */
      .tray .cap.b {
        background: rgba(242, 231, 211, 0.92);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
        --piece-fill: var(--arena-piece-black);
        --piece-stroke: var(--arena-piece-black-edge);
      }
      .tray .adv {
        margin-left: 4px;
        font-family: var(--arena-font-mono);
        font-size: 11px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: #8fd8b7;
      }

      .picker {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-left: auto;
        padding: 3px;
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-pill);
        background: rgba(255, 255, 255, 0.03);
      }
      .wood {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 9px;
        border: 0;
        border-radius: var(--arena-radius-pill);
        background: transparent;
        cursor: pointer;
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--arena-text-label);
      }
      .wood .swatch {
        width: 12px;
        height: 12px;
        border-radius: 4px;
        background-image: var(--wood-grain);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
      }
      .wood.on {
        background: rgba(255, 255, 255, 0.08);
        color: var(--arena-text-strong);
      }
      .wood.on .swatch {
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.35),
          0 0 0 2px rgba(232, 184, 75, 0.35);
      }
      .wood:focus-visible {
        outline: 2px solid var(--arena-gold);
        outline-offset: 1px;
      }

      /* ---- Eval bar + timber frame ---------------------------------------- */
      .stage {
        display: flex;
        gap: 18px;
        align-items: stretch;
        justify-content: center;
        min-width: 0;
      }
      .evalbar {
        width: 14px;
        flex: none;
        align-self: stretch;
        margin: 16px 0 30px;
        border-radius: 8px;
        background: #121a15;
        border: 1px solid rgba(255, 255, 255, 0.08);
        overflow: hidden;
        display: flex;
        flex-direction: column-reverse;
        box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.5);
      }
      .eval-fill {
        width: 100%;
        background: linear-gradient(180deg, #fdf6e6, #e8cba2);
        border-radius: 0 0 7px 7px;
      }

      .frame {
        flex: 1 1 auto;
        min-width: 0;
        max-width: 612px;
        border-radius: var(--arena-radius-lg);
        padding: 16px 18px 8px;
        background: linear-gradient(
          135deg,
          var(--wood-f1) 0%,
          var(--wood-f2) 55%,
          var(--wood-f1) 100%
        );
        box-shadow:
          0 26px 60px rgba(0, 0, 0, 0.55),
          inset 0 1px 0 rgba(255, 255, 255, 0.09),
          inset 0 -8px 24px rgba(0, 0, 0, 0.4);
      }
      .frame-row {
        display: flex;
        container-type: inline-size;
      }
      .ranks {
        width: 16px;
        flex: none;
        display: flex;
        flex-direction: column;
      }
      .ranks div,
      .files div {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 600;
        color: var(--coord-ink);
      }
      .files {
        display: flex;
        margin-left: 16px;
      }
      .files div {
        padding: 4px 0 2px;
      }

      /* ---- The board -------------------------------------------------------- */
      .board {
        position: relative;
        flex: 1;
        min-width: 0;
        aspect-ratio: 1;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        grid-template-rows: repeat(8, 1fr);
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
      }
      /* Inner shading over the squares, under the pieces. */
      .board::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.25);
        z-index: 1;
      }

      .sq {
        position: relative;
        background-color: var(--wood-light);
        background-image: var(--wood-grain);
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.045);
      }
      .sq.dark {
        background-color: var(--wood-dark);
      }

      /* Last-move gold wash + ring on both from and to squares. */
      .sq.last::before {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(232, 184, 75, 0.3);
        box-shadow: inset 0 0 0 2px rgba(232, 184, 75, 0.6);
        pointer-events: none;
      }
      /* Pulsing red radial on the checked king. */
      .sq.check::after {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(
          circle,
          rgba(255, 90, 82, 0.55) 0%,
          rgba(255, 90, 82, 0.18) 70%
        );
        box-shadow: inset 0 0 0 2px rgba(255, 90, 82, 0.7);
        pointer-events: none;
      }

      /* Expanding gold ring on the freshest capture square. */
      .burst {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 3px solid rgba(246, 212, 127, 0.95);
        opacity: 0;
        pointer-events: none;
        z-index: 3;
      }

      .piece {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
        pointer-events: none;
      }
      .piece svg {
        width: 88%;
        height: 88%;
        display: block;
        filter: drop-shadow(0 6px 4px rgba(0, 0, 0, 0.32));
      }
      .piece.w {
        --piece-fill: var(--arena-piece-white);
        --piece-stroke: var(--arena-piece-white-edge);
      }
      .piece.b {
        --piece-fill: var(--arena-piece-black);
        --piece-stroke: var(--arena-piece-black-edge);
      }
      /* The just-moved piece rides on top while it settles. */
      .piece.slide {
        z-index: 5;
      }
      @keyframes slide {
        from {
          transform: translate(var(--dx, 0%), var(--dy, 0%));
        }
        to {
          transform: translate(0, 0);
        }
      }

      /* ---- Result overlay --------------------------------------------------- */
      .endcap {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(8, 10, 14, 0.55);
        backdrop-filter: blur(3px);
      }
      .endcard {
        text-align: center;
        max-width: 88%;
        padding: clamp(14px, 4cqw, 26px) clamp(16px, 6cqw, 42px);
        border-radius: 16px;
        background: rgba(12, 14, 19, 0.9);
        border: 1px solid rgba(232, 184, 75, 0.5);
        box-shadow:
          0 0 60px rgba(232, 184, 75, 0.25),
          0 30px 80px rgba(0, 0, 0, 0.6);
      }
      .end-eyebrow {
        font-family: var(--arena-font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.3em;
        color: var(--arena-gold);
        margin-bottom: 8px;
      }
      .end-title {
        font-family: var(--arena-font-display);
        font-weight: 900;
        font-stretch: 115%;
        font-size: clamp(20px, 6.5cqw, 38px);
        line-height: 1;
        letter-spacing: -0.01em;
        color: #f6f0e2;
      }
      .end-detail {
        font-family: var(--arena-font-mono);
        font-size: 12px;
        font-weight: 500;
        color: var(--arena-text-label);
        margin-top: 10px;
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

      /* ---- SAN chips --------------------------------------------------------- */
      .san {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 4px;
      }
      .san .mv {
        font-family: var(--arena-font-mono);
        font-size: 11px;
        font-weight: 600;
        padding: 5px 9px;
        border-radius: 7px;
        color: var(--arena-text-dim);
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.09);
        white-space: nowrap;
      }
      .san .mv.now {
        color: var(--arena-brand-ink);
        background: linear-gradient(180deg, var(--arena-gold-a), var(--arena-gold-b));
        border-color: transparent;
      }
      .san[hidden] {
        display: none;
      }

      /* ---- Motion (opt-in only) ---------------------------------------------- */
      @media (prefers-reduced-motion: no-preference) {
        .piece.slide {
          animation: slide 0.55s cubic-bezier(0.25, 0.9, 0.3, 1);
        }
        .sq.check::after {
          animation: aa-checkpulse 1s ease infinite;
        }
        .burst {
          animation: aa-burst 0.65s ease-out forwards;
        }
        .tray .cap {
          animation: aa-pop 0.4s ease both;
        }
        .san .mv {
          animation: aa-pop 0.35s ease both;
        }
        .eval-fill {
          transition: height 1s cubic-bezier(0.3, 0.7, 0.3, 1);
        }
        .endcard {
          animation: aa-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
        }
      }

      /* ---- Small screens ------------------------------------------------------ */
      @media (max-width: 430px) {
        .stage {
          gap: 10px;
        }
        .evalbar {
          width: 8px;
          margin: 10px 0 26px;
        }
        .frame {
          padding: 10px 12px 6px;
        }
        .ranks {
          width: 12px;
        }
        .files {
          margin-left: 12px;
        }
        .tray .cap {
          width: 20px;
          height: 20px;
        }
        .wood .lbl {
          display: none;
        }
        .wood {
          padding: 5px 7px;
        }
      }
    `,
  ];

  /** Full FEN of the position to render (fields 1–2 are used). */
  @property({ type: String }) fen = DEFAULT_FEN;

  /** Last move played, for the gold square wash + slide animation. */
  @property({ attribute: false }) lastMove: { from: string; to: string } | null = null;

  /** When true, the side-to-move's king square pulses red. */
  @property({ type: Boolean }) check = false;

  /** SAN move history; when non-empty the last few moves render as chips. */
  @property({ attribute: false }) sanHistory: string[] = [];

  /** 'black' flips the board; anything else renders from white's side. */
  @property({ type: String }) perspective: string | null = null;

  /** When true (default), show captured-piece trays and material advantage. */
  @property({ type: Boolean }) showCaptured = true;

  /** When true (default), show the material eval bar left of the board. */
  @property({ attribute: false }) showEval = true;

  /** Game outcome; when set (and showResultOverlay), the board dims and a card shows. */
  @property({ attribute: false }) result: ChessResult | null = null;

  /** Display name for the winning seat (falls back to the seat id). */
  @property({ type: String }) winnerName = '';

  /** Subtle detail line under the winner (e.g. "Checkmate · 34 moves"). */
  @property({ type: String }) resultDetail = '';

  /** Set false to suppress the result overlay even when result is set. */
  @property({ attribute: false }) showResultOverlay = true;

  /** The wood the board is made of; persisted per spectator, synced across boards. */
  @property({ type: String, reflect: true, attribute: 'board-theme' })
  boardTheme: BoardThemeName = loadBoardTheme();

  /** Slide animation for the piece that just landed (per fen change). */
  private anim: { to: string; dx: number; dy: number } | null = null;

  /** Square of the most recent capture, for the gold burst ring. */
  private burstSq: string | null = null;

  private prevFen = '';

  private readonly _onThemeSync = (): void => {
    const stored = loadBoardTheme();
    if (stored !== this.boardTheme) this.boardTheme = stored;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(BOARD_THEME_EVENT, this._onThemeSync);
  }

  override disconnectedCallback(): void {
    window.removeEventListener(BOARD_THEME_EVENT, this._onThemeSync);
    super.disconnectedCallback();
  }

  protected override willUpdate(): void {
    if (this.fen !== this.prevFen) {
      this.anim = null;
      this.burstSq = null;
      if (this.prevFen && this.lastMove) {
        const flip = this.perspective === 'black' ? -1 : 1;
        const from = this.lastMove.from;
        const to = this.lastMove.to;
        const dCol = (from.charCodeAt(0) - to.charCodeAt(0)) * flip;
        const dRow = (Number(to[1]) - Number(from[1])) * flip;
        this.anim = { to, dx: dCol * 100, dy: dRow * 100 };
        // A capture happened if the destination held an enemy piece before.
        const before = parsePlacement(this.prevFen);
        const mover = before.get(from);
        const target = before.get(to);
        if (target && (!mover || target.color !== mover.color)) this.burstSq = to;
      }
      this.prevFen = this.fen;
    }
  }

  private _pickTheme(name: BoardThemeName): void {
    if (name === this.boardTheme) return;
    this.boardTheme = name;
    saveBoardTheme(name);
    window.dispatchEvent(new CustomEvent(BOARD_THEME_EVENT, { detail: name }));
  }

  /** Render a tray of captured pieces for one side, with optional advantage. */
  private _tray(captured: PieceKey[], color: 'w' | 'b', advantage: number) {
    if (captured.length === 0 && advantage <= 0) {
      return html`<div class="tray" aria-hidden="true"></div>`;
    }
    return html`
      <div
        class="tray"
        aria-label=${`${color === 'w' ? 'White' : 'Black'} pieces captured${
          advantage > 0 ? `, material advantage +${advantage}` : ''
        }`}
      >
        ${captured.map(
          (type) => html`
            <span class="cap ${color}" title=${PIECE_NAME[type]}> ${pieceSvg(type)} </span>
          `,
        )}
        ${advantage > 0 ? html`<span class="adv">+${advantage}</span>` : nothing}
      </div>
    `;
  }

  /** The three-wood segmented control; syncs across boards via BOARD_THEME_EVENT. */
  private _picker() {
    return html`
      <div class="picker" role="group" aria-label="Board wood">
        ${BOARD_THEME_ORDER.map((name) => {
          const t = BOARD_THEMES[name];
          const on = name === this.boardTheme;
          return html`
            <button
              type="button"
              class="wood ${on ? 'on' : ''}"
              aria-pressed=${on ? 'true' : 'false'}
              aria-label=${`${t.label} board`}
              @click=${() => this._pickTheme(name)}
            >
              <span class="swatch" style=${`background-color:${t.swatch}`}></span>
              <span class="lbl">${t.label}</span>
            </button>
          `;
        })}
      </div>
    `;
  }

  /** The result overlay card — parent-driven, no auto-replay. */
  private _overlay() {
    const result = this.result;
    if (!result || !this.showResultOverlay) return nothing;
    const eyebrow =
      result.kind === 'win'
        ? 'CHECKMATE'
        : /stalemate/i.test(this.resultDetail)
          ? 'STALEMATE'
          : 'DRAW';
    return html`
      <div class="endcap" role="status">
        <div class="endcard">
          <div class="end-eyebrow">${eyebrow}</div>
          <div class="end-title">
            ${result.kind === 'win'
              ? html`<span style=${`color:${seatAccentVar(result.winner)}`}
                    >${this.winnerName || result.winner}</span
                  >
                  wins`
              : 'Draw'}
          </div>
          ${this.resultDetail
            ? html`<div class="end-detail">${this.resultDetail}</div>`
            : nothing}
        </div>
      </div>
    `;
  }

  protected override render() {
    const theme = BOARD_THEMES[this.boardTheme] ?? BOARD_THEMES[DEFAULT_BOARD_THEME];
    const woodVars = `--wood-light:${theme.light};--wood-dark:${theme.dark};--wood-f1:${theme.frame1};--wood-f2:${theme.frame2}`;

    const pieces = parsePlacement(this.fen);
    const flipped = this.perspective === 'black';
    const mover = sideToMove(this.fen);
    const hasPieces = pieces.size > 0;

    // Captured material: each tray shows pieces taken *from* one side.
    const whiteOnBoard = countPieces(pieces, 'w');
    const blackOnBoard = countPieces(pieces, 'b');
    // Black pieces captured by white (missing black pieces).
    const whiteCaptured = hasPieces ? capturedOf(blackOnBoard) : [];
    // White pieces captured by black (missing white pieces).
    const blackCaptured = hasPieces ? capturedOf(whiteOnBoard) : [];
    const whiteMat = materialValue(whiteCaptured);
    const blackMat = materialValue(blackCaptured);
    const whiteAdv = whiteMat > blackMat ? whiteMat - blackMat : 0;
    const blackAdv = blackMat > whiteMat ? blackMat - whiteMat : 0;

    // Eval from material only (the server has no engine): 50% is even, each
    // point of material tilts the bar EVAL_GAIN%, capped at ±45%.
    const matDiff = whiteMat - blackMat;
    const bottomDiff = flipped ? -matDiff : matDiff;
    const evalPct =
      50 + Math.max(-45, Math.min(45, bottomDiff * EVAL_GAIN));
    const evalLabel =
      matDiff === 0
        ? 'Material even'
        : `${matDiff > 0 ? 'White' : 'Black'} ahead by ${Math.abs(matDiff)}`;

    // The check pulse sits on the side-to-move's king, found from the FEN.
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
        const isLast =
          this.lastMove !== null && (this.lastMove.from === sq || this.lastMove.to === sq);
        const slide = this.anim !== null && this.anim.to === sq;

        const cls = [
          'sq',
          isDark ? 'dark' : '',
          isLast ? 'last' : '',
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
                        style=${slide ? `--dx:${this.anim!.dx}%;--dy:${this.anim!.dy}%` : ''}
                      >
                        ${pieceSvg(piece.type)}
                      </span>
                    `
                  : nothing}
                ${this.burstSq === sq ? html`<span class="burst"></span>` : nothing}
              </div>
            `,
          ),
        );
      }
    }

    // Trays: each side's row shows what that side has taken from the other.
    // whiteCaptured = black piece types white took → cream-tile black icons.
    const topCaptured = flipped ? whiteCaptured : blackCaptured;
    const topIconColor: 'w' | 'b' = flipped ? 'b' : 'w';
    const topAdv = flipped ? whiteAdv : blackAdv;

    const botCaptured = flipped ? blackCaptured : whiteCaptured;
    const botIconColor: 'w' | 'b' = flipped ? 'w' : 'b';
    const botAdv = flipped ? blackAdv : whiteAdv;

    const rankLabels = flipped
      ? ['1', '2', '3', '4', '5', '6', '7', '8']
      : ['8', '7', '6', '5', '4', '3', '2', '1'];
    const fileLabels = flipped ? [...FILES].reverse() : [...FILES];

    return html`
      <div class="wrap" style=${woodVars}>
        <div class="meta">
          ${this.showCaptured ? this._tray(topCaptured, topIconColor, topAdv) : nothing}
          ${this._picker()}
        </div>

        <div class="stage">
          ${this.showEval
            ? html`
                <div class="evalbar" role="img" aria-label=${evalLabel}>
                  <div class="eval-fill" style=${`height:${evalPct}%`}></div>
                </div>
              `
            : nothing}
          <div class="frame">
            <div class="frame-row">
              <div class="ranks" aria-hidden="true">
                ${rankLabels.map((r) => html`<div>${r}</div>`)}
              </div>
              <div class="board" role="group" aria-label="Chess board">
                ${squares}
                ${this.check ? html`<span class="sr-only">King in check</span>` : nothing}
                ${this._overlay()}
              </div>
            </div>
            <div class="files" aria-hidden="true">
              ${fileLabels.map((f) => html`<div>${f}</div>`)}
            </div>
          </div>
        </div>

        ${this.showCaptured
          ? html`<div class="meta">${this._tray(botCaptured, botIconColor, botAdv)}</div>`
          : nothing}

        <div class="san" aria-label="Recent moves" ?hidden=${this.sanHistory.length === 0}>
          ${this._sanChips()}
        </div>
      </div>
    `;
  }

  /** The last few SAN moves as chips, newest highlighted gold. */
  private _sanChips() {
    const tail = this.sanHistory.slice(-6);
    const offset = this.sanHistory.length - tail.length;
    return tail.map((san, i) => {
      const ply = offset + i;
      const num = Math.floor(ply / 2) + 1;
      const label = ply % 2 === 0 ? `${num}. ${san}` : `${num}… ${san}`;
      return html`<span class="mv ${i === tail.length - 1 ? 'now' : ''}">${label}</span>`;
    });
  }
}
