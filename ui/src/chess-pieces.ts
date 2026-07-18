// The Arena chess piece set — six original, geometric silhouettes drawn for
// this board: single-weight outlines, rounded joins, and one shared plinth so
// the figures read as a family. Colors come from CSS custom properties set by
// the board (`--piece-fill` / `--piece-stroke`), so the same paths adapt to
// light and dark themes without duplicate artwork.
import { svg } from 'lit';
import type { TemplateResult } from 'lit';

export type PieceKey = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

const STROKE = 1.5;

/** Shared attributes for the filled body paths. */
const body = (d: string) => svg`
  <path
    d=${d}
    fill="var(--piece-fill)"
    stroke="var(--piece-stroke)"
    stroke-width=${STROKE}
    stroke-linejoin="round"
    stroke-linecap="round"
  />`;

/** Detail lines drawn in the stroke color only. */
const detail = (d: string) => svg`
  <path
    d=${d}
    fill="none"
    stroke="var(--piece-stroke)"
    stroke-width=${STROKE}
    stroke-linejoin="round"
    stroke-linecap="round"
  />`;

/** The plinth every piece stands on — the "family" trait of the set. */
const plinth = (x: number, w: number) => svg`
  <rect
    x=${x} y="35.5" width=${w} height="4.5" rx="2"
    fill="var(--piece-fill)"
    stroke="var(--piece-stroke)"
    stroke-width=${STROKE}
  />`;

const PIECES: Record<PieceKey, TemplateResult> = {
  p: svg`
    ${body('M22.5 8.5 a5 5 0 1 1 -0.01 0 Z')}
    ${body(
      'M22.5 17.5 C19.3 17.5 17.2 20 17.7 23.2 C14.8 26 13.7 30 13.7 35.5 L31.3 35.5 C31.3 30 30.2 26 27.3 23.2 C27.8 20 25.7 17.5 22.5 17.5 Z',
    )}
    ${plinth(12, 21)}
  `,
  r: svg`
    ${body(
      'M14 35.5 L14 25.5 L12.5 23.5 L12.5 10.5 L16.8 10.5 L16.8 14 L20.2 14 L20.2 10.5 L24.8 10.5 L24.8 14 L28.2 14 L28.2 10.5 L32.5 10.5 L32.5 23.5 L31 25.5 L31 35.5 Z',
    )}
    ${detail('M14 25.5 L31 25.5')}
    ${plinth(10.5, 24)}
  `,
  n: svg`
    ${body(
      'M14.8 35.5 C14.8 28 16.2 23.3 19.6 20.2 C18.2 19.1 17.6 17.3 18 15.4 L15.9 16.2 C15 15.1 15.2 13.4 16.4 12.2 L20.6 8.4 C21.1 7.9 21.9 7.9 22.4 8.4 L22.9 9 C27.8 9.6 31.7 13.7 32.1 19.2 C32.4 22.8 31.2 26.4 29.7 28.9 C28.8 30.4 28.3 32.6 28.3 35.5 Z',
    )}
    <circle cx="19.6" cy="13.4" r="1" fill="var(--piece-stroke)" />
  `,
  b: svg`
    ${body('M22.5 7.2 a2.6 2.6 0 1 1 -0.01 0 Z')}
    ${body(
      'M22.5 12.6 C26.4 15.2 29.3 19.4 29.3 23.6 C29.3 27.6 26.8 30.2 22.5 30.2 C18.2 30.2 15.7 27.6 15.7 23.6 C15.7 19.4 18.6 15.2 22.5 12.6 Z',
    )}
    ${detail('M22.5 17 L22.5 23.5')}
    ${body('M17.5 30.2 C16 32 14.7 33.6 13.9 35.5 L31.1 35.5 C30.3 33.6 29 32 27.5 30.2 Z')}
    ${plinth(12, 21)}
  `,
  q: svg`
    <circle cx="14" cy="12.6" r="2" fill="var(--piece-fill)" stroke="var(--piece-stroke)" stroke-width=${STROKE} />
    <circle cx="22.5" cy="10.6" r="2.2" fill="var(--piece-fill)" stroke="var(--piece-stroke)" stroke-width=${STROKE} />
    <circle cx="31" cy="12.6" r="2" fill="var(--piece-fill)" stroke="var(--piece-stroke)" stroke-width=${STROKE} />
    ${body(
      'M14.3 15 L18.8 22.6 L22.5 13.4 L26.2 22.6 L30.7 15 L29 26 L16 26 Z',
    )}
    ${body(
      'M16 26 C15.6 30 14.7 32.8 13.6 35.5 L31.4 35.5 C30.3 32.8 29.4 30 29 26 Z',
    )}
    ${plinth(11, 23)}
  `,
  k: svg`
    ${body(
      'M21.2 4.5 L23.8 4.5 L23.8 7.2 L26.5 7.2 L26.5 9.8 L23.8 9.8 L23.8 12.5 L21.2 12.5 L21.2 9.8 L18.5 9.8 L18.5 7.2 L21.2 7.2 Z',
    )}
    ${body(
      'M22.5 13.5 C26.5 13.5 29.5 15.5 30.4 18.8 C31.1 21.6 30 24.5 28 26.5 C29.4 29.4 29 32.6 28.5 35.5 L16.5 35.5 C16 32.6 15.6 29.4 17 26.5 C15 24.5 13.9 21.6 14.6 18.8 C15.5 15.5 18.5 13.5 22.5 13.5 Z',
    )}
    ${detail('M17 26.5 L28 26.5')}
    ${plinth(11, 23)}
  `,
};

/**
 * Render one piece as an SVG. The board decides the color by setting
 * `--piece-fill` / `--piece-stroke` on the wrapping element.
 */
export function pieceSvg(key: PieceKey): TemplateResult {
  return svg`
    <svg viewBox="0 0 45 45" aria-hidden="true" focusable="false">
      ${PIECES[key]}
    </svg>
  `;
}
