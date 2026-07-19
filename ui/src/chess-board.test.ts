import { describe, it, expect, beforeEach } from 'vitest';

// The vitest happy-dom environment (under Node's experimental localStorage
// global) leaves `localStorage` undefined; the component guards every access,
// but the theme-persistence tests need a working store.
if (globalThis.localStorage == null) {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
}

import './chess-board.js';
import type { ArenaChessBoard } from './chess-board.js';
import { BOARD_THEME_EVENT, saveBoardTheme } from './theme.js';

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

beforeEach(() => {
  localStorage.removeItem('arena.boardTheme');
});

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

  it('highlights only the newest SAN chip in gold', async () => {
    const el = await mount((b) => {
      b.sanHistory = ['e4', 'e5', 'Qh5'];
    });
    const chips = el.shadowRoot!.querySelectorAll('.san .mv');
    expect(chips).toHaveLength(3);
    const now = el.shadowRoot!.querySelectorAll('.san .mv.now');
    expect(now).toHaveLength(1);
    expect(now[0]!.textContent).toContain('Qh5');
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
    // Position with one black knight missing → white is +3.
    const el = await mount((b) => {
      b.fen = 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    });
    const trays = el.shadowRoot!.querySelectorAll('.tray');
    expect(trays.length).toBe(2);
    const caps = el.shadowRoot!.querySelectorAll('.tray .cap');
    expect(caps.length).toBeGreaterThanOrEqual(1);
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

  describe('eval bar', () => {
    it('sits at 50% when material is even', async () => {
      const el = await mount();
      const fill = el.shadowRoot!.querySelector('.eval-fill') as HTMLElement;
      expect(fill).not.toBeNull();
      expect(fill.getAttribute('style')).toContain('height:50%');
      el.remove();
    });

    it('tilts toward the side with a material lead (knight = 65%)', async () => {
      const el = await mount((b) => {
        b.fen = 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      });
      const fill = el.shadowRoot!.querySelector('.eval-fill') as HTMLElement;
      expect(fill.getAttribute('style')).toContain('height:65%');
      el.remove();
    });

    it('flips the fill for the black perspective', async () => {
      const el = await mount((b) => {
        b.fen = 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        b.perspective = 'black';
      });
      const fill = el.shadowRoot!.querySelector('.eval-fill') as HTMLElement;
      expect(fill.getAttribute('style')).toContain('height:35%');
      el.remove();
    });

    it('is hidden when showEval is false', async () => {
      const el = await mount((b) => {
        b.showEval = false;
      });
      expect(el.shadowRoot!.querySelector('.evalbar')).toBeNull();
      el.remove();
    });
  });

  describe('board wood picker', () => {
    it('defaults to walnut and offers three woods', async () => {
      const el = await mount();
      expect(el.boardTheme).toBe('walnut');
      const buttons = el.shadowRoot!.querySelectorAll('.picker .wood');
      expect(buttons).toHaveLength(3);
      expect(
        el.shadowRoot!.querySelector('.wood[aria-pressed="true"]')!.getAttribute('aria-label'),
      ).toBe('Walnut board');
      el.remove();
    });

    it('switches wood on click, persists it, and broadcasts the change', async () => {
      const el = await mount();
      let broadcast = 0;
      const onEvent = () => broadcast++;
      window.addEventListener(BOARD_THEME_EVENT, onEvent);
      const maple = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.wood')).find(
        (b) => b.getAttribute('aria-label') === 'Maple board',
      )!;
      maple.click();
      await el.updateComplete;
      window.removeEventListener(BOARD_THEME_EVENT, onEvent);

      expect(el.boardTheme).toBe('maple');
      expect(el.getAttribute('board-theme')).toBe('maple');
      expect(localStorage.getItem('arena.boardTheme')).toBe('maple');
      expect(broadcast).toBe(1);
      el.remove();
    });

    it('re-reads the stored wood when another board broadcasts a change', async () => {
      const el = await mount();
      saveBoardTheme('ebony');
      window.dispatchEvent(new CustomEvent(BOARD_THEME_EVENT, { detail: 'ebony' }));
      await el.updateComplete;
      expect(el.boardTheme).toBe('ebony');
      el.remove();
    });

    it('can be forced via the board-theme attribute', async () => {
      const el = await mount((b) => {
        b.setAttribute('board-theme', 'ebony');
      });
      expect(el.boardTheme).toBe('ebony');
      el.remove();
    });
  });

  describe('result overlay', () => {
    it('shows a checkmate card with the winner name', async () => {
      const el = await mount((b) => {
        b.result = { kind: 'win', winner: 'white' };
        b.winnerName = 'Astra';
        b.resultDetail = 'Checkmate · 34 moves';
      });
      const overlay = el.shadowRoot!.querySelector('.endcap');
      expect(overlay).not.toBeNull();
      expect(overlay!.textContent).toContain('CHECKMATE');
      expect(overlay!.textContent).toContain('Astra');
      expect(overlay!.textContent).toContain('wins');
      expect(overlay!.textContent).toContain('Checkmate · 34 moves');
      el.remove();
    });

    it('falls back to the seat id when no winner name is given', async () => {
      const el = await mount((b) => {
        b.result = { kind: 'win', winner: 'black' };
      });
      expect(el.shadowRoot!.querySelector('.endcap')!.textContent).toContain('black');
      el.remove();
    });

    it('labels a stalemate draw as STALEMATE', async () => {
      const el = await mount((b) => {
        b.result = { kind: 'draw' };
        b.resultDetail = 'Stalemate after 61 moves';
      });
      const overlay = el.shadowRoot!.querySelector('.endcap')!;
      expect(overlay.textContent).toContain('STALEMATE');
      expect(overlay.textContent).toContain('Draw');
      el.remove();
    });

    it('stays hidden while the game runs and when suppressed', async () => {
      const running = await mount();
      expect(running.shadowRoot!.querySelector('.endcap')).toBeNull();
      running.remove();

      const suppressed = await mount((b) => {
        b.result = { kind: 'draw' };
        b.showResultOverlay = false;
      });
      expect(suppressed.shadowRoot!.querySelector('.endcap')).toBeNull();
      suppressed.remove();
    });
  });

  describe('capture burst', () => {
    it('bursts on the destination square of a capture', async () => {
      const el = await mount((b) => {
        b.fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
      });
      // White pawn takes on d5.
      el.lastMove = { from: 'e4', to: 'd5' };
      el.fen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
      await el.updateComplete;
      const d5 = byLabelPrefix(el, 'd5:')!;
      expect(d5.querySelector('.burst')).not.toBeNull();
      el.remove();
    });

    it('does not burst on a quiet move', async () => {
      const el = await mount();
      el.lastMove = { from: 'e2', to: 'e4' };
      el.fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.burst')).toBeNull();
      el.remove();
    });
  });
});
