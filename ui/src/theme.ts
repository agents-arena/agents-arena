// Shared design tokens for @arena/ui — the "Arena / Scoreboard" visual system.
// Components include `arenaTokens` and `resetStyles` in their static styles so
// every shadow root is self-contained: no global stylesheet is required.
//
// Theming strategy:
//   - Light values are the default on :host.
//   - Dark values apply via `@media (prefers-color-scheme: dark)` (follows the OS).
//   - An explicit `data-theme` on :root wins via `:host-context([data-theme=…])`,
//     because :host-context has higher specificity than the plain :host rules.
import { css, unsafeCSS } from 'lit';
import type { CSSResult } from 'lit';

// Fixed hues + scales — identical in both themes.
const raw = unsafeCSS(`
  --arena-brand: #4f7cff;
  --arena-brand-ink: #ffffff;

  --arena-seat-1: #4f7cff;
  --arena-seat-2: #f0466e;
  --arena-seat-3: #f5a524;
  --arena-seat-4: #12b886;
  --arena-seat-5: #9b5cff;
  --arena-seat-6: #ff7a45;

  --arena-ring: color-mix(in srgb, var(--arena-brand) 42%, transparent);

  --arena-font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --arena-font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;

  --arena-text-xs: 11px;
  --arena-text-sm: 13px;
  --arena-text-base: 15px;
  --arena-text-lg: 18px;
  --arena-text-xl: 22px;

  --arena-space-1: 4px;
  --arena-space-2: 8px;
  --arena-space-3: 12px;
  --arena-space-4: 16px;
  --arena-space-5: 24px;
  --arena-space-6: 32px;
  --arena-space-7: 48px;

  --arena-radius-sm: 6px;
  --arena-radius-md: 10px;
  --arena-radius-lg: 14px;
  --arena-radius-pill: 999px;
`);

// Semantic tokens that flip with the active theme.
const light = unsafeCSS(`
  --arena-bg: #eef1f8;
  --arena-surface: #ffffff;
  --arena-surface-2: #f3f5fb;
  --arena-surface-inset: #e9edf6;
  --arena-text: #111726;
  --arena-text-muted: #5b6577;
  --arena-text-faint: #8a93a6;
  --arena-border: #dde3ee;
  --arena-border-strong: #c6cede;
  --arena-success: #15a34a;
  --arena-warning: #d97706;
  --arena-danger: #dc2f34;
  --arena-shadow-1: 0 1px 2px rgba(16, 23, 38, 0.06), 0 1px 3px rgba(16, 23, 38, 0.09);
  --arena-shadow-2: 0 8px 24px -8px rgba(16, 23, 38, 0.16), 0 2px 6px -2px rgba(16, 23, 38, 0.08);
`);

const dark = unsafeCSS(`
  --arena-bg: #0a0e18;
  --arena-surface: #131a28;
  --arena-surface-2: #1a2233;
  --arena-surface-inset: #0e1420;
  --arena-text: #eef2fb;
  --arena-text-muted: #9aa5bb;
  --arena-text-faint: #6b7688;
  --arena-border: #29324a;
  --arena-border-strong: #3a4665;
  --arena-success: #22c55e;
  --arena-warning: #fbbf24;
  --arena-danger: #ff5a5f;
  --arena-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.45);
  --arena-shadow-2: 0 14px 34px -10px rgba(0, 0, 0, 0.65), 0 2px 8px -2px rgba(0, 0, 0, 0.5);
`);

/** CSS custom properties for the whole system, wired for light + dark. */
export const arenaTokens: CSSResult = css`
  :host {
    ${raw}
    ${light}
  }

  @media (prefers-color-scheme: dark) {
    :host {
      ${dark}
    }
  }

  /* Explicit override on :root wins over the OS preference. */
  :host-context([data-theme='light']) {
    ${light}
  }
  :host-context([data-theme='dark']) {
    ${dark}
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

/** Number of distinct seat accent colors available. */
export const SEAT_ACCENT_COUNT = 6;

/**
 * Deterministically map an arbitrary seat identifier (e.g. "P1", "X", "north")
 * to one of the seat accent colors (1..SEAT_ACCENT_COUNT). Stable across
 * renders, so a seat keeps its color everywhere it appears.
 */
export function seatColorIndex(seat: string): number {
  let hash = 0;
  for (let i = 0; i < seat.length; i++) {
    hash = (hash * 31 + seat.charCodeAt(i)) >>> 0;
  }
  return (hash % SEAT_ACCENT_COUNT) + 1;
}
