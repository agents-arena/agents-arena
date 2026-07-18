import { describe, it, expect } from 'vitest';
import './chess-board.js';
import type { ArenaChessBoard } from './chess-board.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

async function mount(setup?: (el: ArenaChessBoard) => void): Promise<ArenaChessBoard> {
  const el = document.createElement('arena-chess-board');
  setup?.(el);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function squares(el: ArenaChessBoard): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.sq'));
}

function byLabelPrefix(el: ArenaChessBoard, prefix: string): HTMLElement | undefined {
  return squares(el).find((s) => (s.getAttribute('aria-label') ?? '').startsWith(prefix));
}

describe('arena-chess-board', () => {
  it('renders 64 squares and 32 starting pieces', async () => {
    const el = await mount();
    expect(squares(el)).toHaveLength(64);
    expect(el.shadowRoot!.querySelectorAll('.piece')).toHaveLength(32);
    el.remove();
  });

  it('uses correct square colors (a1 dark, h1 light, d1 light)', async () => {
    const el = await mount();
    expect(byLabelPrefix(el, 'a1:')!.classList.contains('dark')).toBe(true);
    expect(byLabelPrefix(el, 'h1:')!.classList.contains('dark')).toBe(false);
    expect(byLabelPrefix(el, 'd1:')!.classList.contains('dark')).toBe(false);
    el.remove();
  });

  it('marks the last move squares', async () => {
    const el = await mount((b) => {
      b.fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
      b.lastMove = { from: 'e2', to: 'e4' };
    });
    expect(byLabelPrefix(el, 'e2:')!.classList.contains('last')).toBe(true);
    expect(byLabelPrefix(el, 'e4:')!.classList.contains('last')).toBe(true);
    expect(byLabelPrefix(el, 'a1:')!.classList.contains('last')).toBe(false);
    el.remove();
  });

  it('glows the side-to-move king square when check is set', async () => {
    // Fool's mate final position: white to move, white king on e1 in check.
    const el = await mount((b) => {
      b.fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
      b.check = true;
    });
    expect(byLabelPrefix(el, 'e1:')!.classList.contains('check')).toBe(true);
    expect(byLabelPrefix(el, 'e8:')!.classList.contains('check')).toBe(false);
    el.remove();
  });

  it('flips the board for the black perspective', async () => {
    const el = await mount((b) => {
      b.perspective = 'black';
    });
    const first = squares(el)[0]!;
    expect(first.getAttribute('aria-label')!.startsWith('h1:')).toBe(true);
    el.remove();
  });

  it('renders a SAN strip when history is provided', async () => {
    const el = await mount((b) => {
      b.sanHistory = ['e4', 'e5', 'Qh5'];
    });
    const san = el.shadowRoot!.querySelector('.san');
    expect(san).not.toBeNull();
    expect(san!.textContent).toContain('Qh5');
    el.remove();
  });

  it('hides the SAN strip for an empty history', async () => {
    const el = await mount();
    const san = el.shadowRoot!.querySelector('.san');
    expect(san).not.toBeNull();
    expect(san!.hasAttribute('hidden')).toBe(true);
    el.remove();
  });

  it('defaults to the initial position', async () => {
    const el = await mount();
    expect(el.fen).toBe(START_FEN);
    const e2 = byLabelPrefix(el, 'e2:');
    expect(e2!.getAttribute('aria-label')).toContain('white pawn');
    el.remove();
  });

  it('renders captured-piece trays with material advantage', async () => {
    // Position after white captures a black knight and two pawns (missing black: n×1, p×2).
    // Material advantage for white: 3 + 1 + 1 = +5.
    const el = await mount((b) => {
      b.fen = 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      // Remove black knight from b8 → still on board? r1bq... means b8 empty, so one black knight missing.
      // Start has 2 knights; only n on g8 remains → 1 knight captured.
      // Full start black: rnbqkbnr — r1bqkbnr is missing one n (the b8 knight).
    });
    const trays = el.shadowRoot!.querySelectorAll('.tray');
    expect(trays.length).toBe(2);
    // Captured black knight icon should appear in white's tray (bottom for white perspective).
    const caps = el.shadowRoot!.querySelectorAll('.tray .cap');
    expect(caps.length).toBeGreaterThanOrEqual(1);
    // Material advantage: knight = 3.
    expect(el.shadowRoot!.textContent).toContain('+3');
    el.remove();
  });

  it('hides captured trays when showCaptured is false', async () => {
    const el = await mount((b) => {
      b.fen = 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      b.showCaptured = false;
    });
    expect(el.shadowRoot!.querySelectorAll('.tray')).toHaveLength(0);
    el.remove();
  });
});
