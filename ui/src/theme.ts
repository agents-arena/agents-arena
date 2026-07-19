// Shared design tokens for @arena/ui — the "Arena / Wood Table" visual system.
//
// This is the dark, warm, cinematic look from the Agents Arena redesign: agents
// square off across a real wooden board on a felt-lit table, in near-black
// surroundings washed with teal and ember glows. Type is Archivo (display +
// body) and JetBrains Mono (labels, numbers, code). Gold is the signature
// accent; each seat carries its own hue.
//
// Every component includes `arenaTokens` + `resetStyles` (and, when it animates,
// `arenaKeyframes`) in its static styles so each shadow root is self-contained:
// no global stylesheet is required. Fonts are loaded once at the document level
// (see index.html) and reach every shadow root, with system fallbacks.
import { css, unsafeCSS } from 'lit';
import type { CSSResult } from 'lit';

// ---------------------------------------------------------------------------
// Token values — a single dark theme (the redesign has no light variant).
// ---------------------------------------------------------------------------
const tokens = unsafeCSS(`
  /* Type */
  --arena-font-sans: 'Archivo', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --arena-font-display: 'Archivo', system-ui, sans-serif;
  --arena-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  /* Surfaces & backdrop */
  --arena-bg: #0b0e13;
  --arena-surface: #12161e;
  --arena-surface-2: #171c26;
  --arena-surface-3: #1c222e;
  --arena-surface-inset: #0a0d12;
  --arena-overlay: rgba(0, 0, 0, 0.35);

  /* Borders */
  --arena-border: rgba(255, 255, 255, 0.08);
  --arena-border-soft: rgba(255, 255, 255, 0.06);
  --arena-border-strong: rgba(255, 255, 255, 0.14);

  /* Text */
  --arena-text: #ece7db;
  --arena-text-strong: #f4efe4;
  --arena-text-bright: #f6f1e5;
  --arena-text-muted: #9aa2b1;
  --arena-text-dim: #aeb6c4;
  --arena-text-faint: #5f6775;
  --arena-text-label: #8b93a3;

  /* Brand = gold (kept as --arena-brand so existing components inherit it) */
  --arena-brand: #e8b84b;
  --arena-brand-ink: #221807;
  --arena-gold: #e8b84b;
  --arena-gold-hi: #f6d47f;
  --arena-gold-a: #f4cd63;
  --arena-gold-b: #e2a93b;
  --arena-ring: color-mix(in srgb, var(--arena-gold) 45%, transparent);

  /* Signal colors */
  --arena-live: #ff5a52;
  --arena-live-2: #ff6b60;
  --arena-success: #3ddc85;
  --arena-success-hi: #57e39a;
  --arena-warning: #f0b45c;
  --arena-danger: #ff5a52;

  /* Seat / model accents (used across faces, cards, chips, feed) */
  --arena-seat-1: #ff7847;  /* ember  — default "first"/white side  */
  --arena-seat-2: #3fd8d4;  /* teal   — default "second"/black side */
  --arena-seat-3: #e8b84b;  /* gold   */
  --arena-seat-4: #3ddc85;  /* green  */
  --arena-seat-5: #a78bfa;  /* violet — default X */
  --arena-seat-6: #ff7a9e;  /* rose   — default O */
  --arena-ember: #ff7847;
  --arena-ember-hi: #ffab8b;
  --arena-teal: #3fd8d4;
  --arena-teal-hi: #8ceeeb;
  --arena-violet: #a78bfa;
  --arena-violet-hi: #c9b7ff;
  --arena-rose: #ff7a9e;

  /* Physical chess-piece / seat-chip palette (wood set) */
  --arena-piece-white: #fdf5e4;
  --arena-piece-white-edge: #6b4a26;
  --arena-piece-black: #1d1916;
  --arena-piece-black-edge: rgba(255, 246, 228, 0.42);
  --arena-chip-white-bg: #f2e7d3;
  --arena-chip-white-ink: #241f1b;
  --arena-chip-black-bg: #23201c;
  --arena-chip-black-ink: #d9d2c4;

  /* Radii */
  --arena-radius-sm: 6px;
  --arena-radius-md: 10px;
  --arena-radius-lg: 14px;
  --arena-radius-xl: 18px;
  --arena-radius-2xl: 22px;
  --arena-radius-pill: 999px;

  /* Spacing */
  --arena-space-1: 4px;
  --arena-space-2: 8px;
  --arena-space-3: 12px;
  --arena-space-4: 16px;
  --arena-space-5: 24px;
  --arena-space-6: 32px;
  --arena-space-7: 48px;

  /* Type scale */
  --arena-text-xs: 11px;
  --arena-text-sm: 13px;
  --arena-text-base: 15px;
  --arena-text-lg: 18px;
  --arena-text-xl: 22px;
  --arena-text-2xl: 28px;

  /* Shadows */
  --arena-shadow-1: 0 8px 22px rgba(0, 0, 0, 0.32);
  --arena-shadow-2: 0 30px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --arena-shadow-3: 0 40px 90px rgba(0, 0, 0, 0.55);
  --arena-glow-gold: 0 0 26px rgba(232, 184, 75, 0.25);

  /* App backdrop: ember + teal wash over near-black. Applied on the shell. */
  --arena-bg-wash:
    radial-gradient(900px 500px at 85% -5%, rgba(63, 216, 212, 0.07), transparent 60%),
    radial-gradient(1000px 600px at 8% -10%, rgba(255, 120, 71, 0.08), transparent 60%),
    #0b0e13;
`);

/** CSS custom properties for the whole system (single dark theme). */
export const arenaTokens: CSSResult = css`
  :host {
    ${tokens}
    color-scheme: dark;
  }
`;

/** Minimal reset applied inside every component's shadow root. */
export const resetStyles: CSSResult = css`
  :host {
    box-sizing: border-box;
  }
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

/**
 * The shared animation library, referenced by name across components. Included
 * in a component's styles so its shadow root can resolve the `animation-name`
 * (keyframes do not reliably cross shadow boundaries). Mirrors the design's
 * `aa-*` set. Guard motion with `prefers-reduced-motion` at the call site.
 */
export const arenaKeyframes: CSSResult = css`
  @keyframes aa-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.25;
    }
  }
  @keyframes aa-bounce {
    0%,
    80%,
    100% {
      transform: translateY(0);
      opacity: 0.35;
    }
    40% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }
  @keyframes aa-pop {
    0% {
      transform: scale(0.7) translateY(10px);
      opacity: 0;
    }
    60% {
      transform: scale(1.03) translateY(-1px);
      opacity: 1;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes aa-rise {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes aa-burst {
    0% {
      transform: scale(0.35);
      opacity: 0.95;
    }
    100% {
      transform: scale(2);
      opacity: 0;
    }
  }
  @keyframes aa-conf {
    0% {
      opacity: 1;
    }
    80% {
      opacity: 1;
    }
    100% {
      transform: translate3d(var(--dx, 0), 640px, 0) rotate(var(--rot, 360deg));
      opacity: 0;
    }
  }
  @keyframes aa-shimmer {
    to {
      background-position: 200% center;
    }
  }
  @keyframes aa-float {
    0%,
    100% {
      transform: translateY(-6px) rotate(-3deg);
    }
    50% {
      transform: translateY(8px) rotate(3deg);
    }
  }
  @keyframes aa-strike {
    from {
      transform: scaleY(0);
    }
    to {
      transform: scaleY(1);
    }
  }
  @keyframes aa-checkpulse {
    0%,
    100% {
      opacity: 0.95;
    }
    50% {
      opacity: 0.45;
    }
  }
  @keyframes aa-glowring {
    0%,
    100% {
      box-shadow: 0 0 0 2px rgba(232, 184, 75, 0.55), 0 0 28px rgba(232, 184, 75, 0.28);
    }
    50% {
      box-shadow: 0 0 0 2px rgba(232, 184, 75, 0.25), 0 0 10px rgba(232, 184, 75, 0.12);
    }
  }
  @keyframes aa-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.25;
    }
  }
`;

// ---------------------------------------------------------------------------
// Seat accents — deterministic hue per seat.
// ---------------------------------------------------------------------------

/** Number of distinct seat accent colors available. */
export const SEAT_ACCENT_COUNT = 6;

// Well-known seats get an intentional hue so chess/tic-tac-toe read the way the
// design intends; anything else hashes into the palette below.
const SEAT_OVERRIDES: Record<string, number> = {
  white: 1,
  w: 1,
  black: 2,
  b: 2,
  x: 5,
  o: 6,
};

/**
 * Deterministically map a seat identifier (e.g. "white", "X", "P1") to one of
 * the seat accent colors (1..SEAT_ACCENT_COUNT). Stable across renders so a seat
 * keeps its color everywhere it appears.
 */
export function seatColorIndex(seat: string): number {
  const key = seat.trim().toLowerCase();
  const override = SEAT_OVERRIDES[key];
  if (override !== undefined) return override;
  let hash = 0;
  for (let i = 0; i < seat.length; i++) {
    hash = (hash * 31 + seat.charCodeAt(i)) >>> 0;
  }
  return (hash % SEAT_ACCENT_COUNT) + 1;
}

/** The `var(--arena-seat-N)` reference for a seat's accent color. */
export function seatAccentVar(seat: string): string {
  return `var(--arena-seat-${seatColorIndex(seat)})`;
}

// ---------------------------------------------------------------------------
// Board themes — the wood the user picks (walnut / maple / ebony).
// ---------------------------------------------------------------------------

export type BoardThemeName = 'walnut' | 'maple' | 'ebony';

export interface BoardTheme {
  name: BoardThemeName;
  label: string;
  /** Light square. */
  light: string;
  /** Dark square. */
  dark: string;
  /** Board frame gradient — inner. */
  frame1: string;
  /** Board frame gradient — outer. */
  frame2: string;
  /** A single representative swatch for the picker. */
  swatch: string;
}

export const BOARD_THEMES: Record<BoardThemeName, BoardTheme> = {
  walnut: {
    name: 'walnut',
    label: 'Walnut',
    light: '#ecd2ab',
    dark: '#96603a',
    frame1: '#4a3522',
    frame2: '#2c2013',
    swatch: '#96603a',
  },
  maple: {
    name: 'maple',
    label: 'Maple',
    light: '#f0dcb7',
    dark: '#b98551',
    frame1: '#6b4c30',
    frame2: '#443021',
    swatch: '#b98551',
  },
  ebony: {
    name: 'ebony',
    label: 'Ebony',
    light: '#d8cfc2',
    dark: '#4a4038',
    frame1: '#26211c',
    frame2: '#151210',
    swatch: '#4a4038',
  },
};

export const BOARD_THEME_ORDER: BoardThemeName[] = ['walnut', 'maple', 'ebony'];
export const DEFAULT_BOARD_THEME: BoardThemeName = 'walnut';

const BOARD_THEME_KEY = 'arena.boardTheme';

/** Read the spectator's chosen board wood from localStorage (default walnut). */
export function loadBoardTheme(): BoardThemeName {
  try {
    const v = localStorage.getItem(BOARD_THEME_KEY);
    if (v === 'walnut' || v === 'maple' || v === 'ebony') return v;
  } catch {
    /* storage unavailable — fall through */
  }
  return DEFAULT_BOARD_THEME;
}

/** Persist the spectator's chosen board wood. */
export function saveBoardTheme(name: BoardThemeName): void {
  try {
    localStorage.setItem(BOARD_THEME_KEY, name);
  } catch {
    /* ignore */
  }
}

/** Event dispatched on `window` when the board theme changes (cross-component sync). */
export const BOARD_THEME_EVENT = 'arena-board-theme';
