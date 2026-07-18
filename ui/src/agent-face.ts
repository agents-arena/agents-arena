// <arena-agent-face> — "BLIP", the Arena's expressive silicon-blob mascot.
//
// Every AI agent in a match owns one of these little faces. It reacts live to
// how the agent "feels" about the board: gloating when ahead, panicking and
// sweating when cornered, wailing when it blunders, and going limp-antenna'd
// and grey when it's beaten. The whole point is charm and comedy.
//
// Design notes:
//   - ONE inline SVG face. Emotion never rebuilds the DOM — it only flips the
//     `data-emotion` attribute, and CSS drives which brow/eye/mouth/FX layers
//     are visible and how they're posed. That keeps render() tiny, transitions
//     smooth (features cross-fade / tween), and the component easy to test.
//   - The seat color (via seatColorIndex) tints the skin, cheeks and antenna
//     bulb so each agent's face is recognizably theirs.
//   - Theme-aware through the shared arena tokens: the ink outline rides on
//     --arena-text (which flips light/dark), so the face reads on both.
//   - All motion lives behind `prefers-reduced-motion: no-preference`; the
//     emotional POSE is set with static transforms/visibility, so reduced-motion
//     users still get a clear, frozen expression.
//
// Decoupling: @arena/ui depends only on `lit`/`qrcode`. The emotion union is
// defined locally here (it mirrors the match protocol's emotion set).
import { LitElement, html, css } from 'lit';
import type { CSSResultGroup } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, seatColorIndex } from './theme.js';

/**
 * How an agent "feels" about the board right now. Mirrors the match protocol's
 * emotion set exactly. Drives the entire facial expression.
 */
export type FaceEmotion =
  | 'neutral'
  | 'thinking'
  | 'happy'
  | 'confident'
  | 'smug'
  | 'nervous'
  | 'worried'
  | 'surprised'
  | 'shocked'
  | 'sad'
  | 'crying'
  | 'angry'
  | 'celebrating'
  | 'defeated'
  | 'mischievous'
  | 'sweating';

// A rounded drop/teardrop, tip up, centered on its local origin. Reused for
// sweat beads and tears (translated/animated into place).
const DROP = 'M0,-7 C4,-1.5 5,1.5 5,4.2 A5,5 0 1 1 -5,4.2 C-5,1.5 -4,-1.5 0,-7 Z';
// A chunky 5-point star for "celebrating" eyes (translated onto each eye).
const STAR = 'M0,-7.5 L2.1,-2.4 7.4,-2.4 3.1,0.9 4.6,6.2 0,3 -4.6,6.2 -3.1,0.9 -7.4,-2.4 -2.1,-2.4 Z';
// A 4-point sparkle "glint" for smug / mischievous / confident.
const GLINT =
  'M0,-6 C0.7,-1.7 1.7,-0.7 6,0 C1.7,0.7 0.7,1.7 0,6 C-0.7,1.7 -1.7,0.7 -6,0 C-1.7,-0.7 -0.7,-1.7 0,-6 Z';

/**
 * An expressive animated cartoon face for an AI agent. Set `emotion` to make it
 * react; `seat` tints it, `label` names it, `note` pops a comic speech bubble.
 *
 * @example
 * html`<arena-agent-face
 *   emotion="smug" seat="P1" label="Claude" note="Too easy." .size=${140}
 * ></arena-agent-face>`
 */
@customElement('arena-agent-face')
export class ArenaAgentFace extends LitElement {
  /** Current feeling. Drives the whole expression + animation. */
  @property({ type: String, reflect: true }) emotion: FaceEmotion = 'neutral';

  /** Seat identifier; maps deterministically to one of the seat accent colors. */
  @property({ type: String }) seat = '';

  /** Name / model shown beneath the face. */
  @property({ type: String }) label = '';

  /** Optional short quip; when set, shown in a comic speech bubble above. */
  @property({ type: String }) note = '';

  /** Rendered size of the face in px (width; height follows). */
  @property({ type: Number }) size = 128;

  static override styles: CSSResultGroup = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: inline-flex;
        font-family: var(--arena-font-sans);
        --face-size: 128px;
      }

      .stage {
        position: relative;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: var(--arena-space-2);
        padding-top: 6px;
      }

      /* ---- Speech bubble ------------------------------------------------ */
      .bubble {
        position: absolute;
        bottom: calc(100% - 10px);
        left: 50%;
        transform: translateX(-50%);
        max-width: max(160px, calc(var(--face-size) * 1.5));
        width: max-content;
        padding: 8px 12px;
        background: var(--arena-surface);
        color: var(--arena-text);
        border: 2px solid var(--seat);
        border-radius: var(--arena-radius-lg);
        box-shadow: var(--arena-shadow-2);
        font-size: var(--arena-text-sm);
        font-weight: 650;
        line-height: 1.3;
        text-align: center;
        z-index: 2;
        animation: bubble-pop 0.26s cubic-bezier(0.2, 1.5, 0.4, 1) both;
      }
      .bubble::after,
      .bubble::before {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        width: 0;
        height: 0;
        border: 9px solid transparent;
        border-top-color: var(--seat);
        transform: translateX(-50%);
      }
      .bubble::after {
        border-width: 7px;
        border-top-color: var(--arena-surface);
        margin-top: -2px;
      }

      /* ---- Face ---------------------------------------------------------- */
      .face {
        display: block;
        width: var(--face-size);
        height: auto;
        overflow: visible;
        /* Palette derived from the seat accent + theme tokens. */
        --line: color-mix(in srgb, var(--arena-text) 82%, var(--seat));
        --skin: color-mix(in srgb, var(--seat) 26%, var(--arena-surface));
        --skin-2: color-mix(in srgb, var(--seat) 44%, var(--arena-surface));
        --white: color-mix(in srgb, #ffffff 92%, var(--arena-surface));
        --pupil: var(--line);
        --mouth: color-mix(in srgb, #7c2b3a 68%, var(--line));
        --tongue: #ff8fa6;
        --blush: color-mix(in srgb, var(--seat) 50%, #ff789c);
        --wet: #56b7ff;
      }

      .stroke {
        fill: none;
        stroke: var(--line);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .head-group {
        transition: transform 0.32s ease, filter 0.32s ease;
        transform-box: fill-box;
        transform-origin: center;
      }
      .head {
        fill: var(--skin);
        stroke: var(--line);
        stroke-width: 3.2;
        transition: fill 0.32s ease;
        transform-box: fill-box;
        transform-origin: center;
      }
      .ear {
        fill: var(--skin-2);
        stroke: var(--line);
        stroke-width: 3;
      }

      /* ---- Antenna (the mood tell) -------------------------------------- */
      .antenna {
        transition: transform 0.34s cubic-bezier(0.3, 1.2, 0.4, 1);
        transform-box: fill-box;
        transform-origin: bottom center;
      }
      .antenna-stalk {
        stroke-width: 3;
      }
      .antenna-bulb {
        fill: var(--seat);
        stroke: var(--line);
        stroke-width: 2.2;
        transition: fill 0.3s ease, opacity 0.3s ease;
      }

      /* ---- Brows --------------------------------------------------------- */
      .brow {
        stroke-width: 3.4;
        transition: transform 0.28s ease;
        transform-box: fill-box;
        transform-origin: center;
      }

      /* ---- Eyes ---------------------------------------------------------- */
      .eyes {
        transition: transform 0.28s ease;
        transform-box: fill-box;
        transform-origin: center;
      }
      .eye-white {
        fill: var(--white);
        stroke: var(--line);
        stroke-width: 2.4;
      }
      .pupil {
        fill: var(--pupil);
        transition: transform 0.28s ease;
        transform-box: fill-box;
        transform-origin: center;
      }
      .glint {
        fill: var(--white);
      }
      .lid {
        fill: var(--skin);
        transition: transform 0.28s ease;
        transform-box: fill-box;
        transform-origin: center;
        transform: translateY(-17px);
      }

      /* Alternate eye sets — hidden until their emotion selects them. */
      .cry-eyes,
      .x-eyes,
      .star-eyes {
        display: none;
      }
      .star {
        fill: var(--seat);
        stroke: var(--line);
        stroke-width: 2;
        stroke-linejoin: round;
      }

      /* ---- Cheeks -------------------------------------------------------- */
      .cheek {
        display: none;
        fill: var(--blush);
        opacity: 0.72;
      }

      /* ---- Mouths (only one shows at a time) ---------------------------- */
      .mouth {
        display: none;
      }
      .mouth.fill {
        fill: var(--mouth);
        stroke: var(--line);
        stroke-width: 2.4;
        stroke-linejoin: round;
      }
      .tongue {
        fill: var(--tongue);
      }
      .teeth {
        stroke: var(--line);
        stroke-width: 1.8;
        fill: none;
      }

      /* ---- FX overlays --------------------------------------------------- */
      .fx {
        display: none;
      }
      .drop {
        fill: var(--wet);
        stroke: color-mix(in srgb, var(--wet) 60%, var(--line));
        stroke-width: 1.4;
      }
      .steam {
        fill: none;
        stroke: var(--arena-text-faint);
        stroke-width: 2.4;
        stroke-linecap: round;
        opacity: 0.7;
      }
      .think-dot {
        fill: var(--line);
      }
      .confetti {
        stroke: none;
      }
      .sparkle {
        fill: var(--arena-warning);
      }

      /* =================================================================== */
      /*  EMOTION POSES                                                      */
      /* =================================================================== */

      /* Brow poses ------------------------------------------------------- */
      .face[data-emotion='happy'] .brow,
      .face[data-emotion='confident'] .brow,
      .face[data-emotion='celebrating'] .brow {
        transform: translateY(-3px);
      }
      .face[data-emotion='surprised'] .brow,
      .face[data-emotion='shocked'] .brow {
        transform: translateY(-6px);
      }
      .face[data-emotion='angry'] .brow--l {
        transform: translateY(6px) rotate(17deg);
      }
      .face[data-emotion='angry'] .brow--r {
        transform: translateY(6px) rotate(-17deg);
      }
      .face[data-emotion='sad'] .brow--l,
      .face[data-emotion='worried'] .brow--l,
      .face[data-emotion='crying'] .brow--l {
        transform: translateY(-2px) rotate(-15deg);
      }
      .face[data-emotion='sad'] .brow--r,
      .face[data-emotion='worried'] .brow--r,
      .face[data-emotion='crying'] .brow--r {
        transform: translateY(-2px) rotate(15deg);
      }
      .face[data-emotion='nervous'] .brow--l,
      .face[data-emotion='sweating'] .brow--l {
        transform: translateY(-3px) rotate(-11deg);
      }
      .face[data-emotion='nervous'] .brow--r,
      .face[data-emotion='sweating'] .brow--r {
        transform: translateY(-3px) rotate(11deg);
      }
      .face[data-emotion='thinking'] .brow--r,
      .face[data-emotion='smug'] .brow--r {
        transform: translateY(-5px) rotate(-8deg);
      }
      .face[data-emotion='mischievous'] .brow--l {
        transform: translateY(3px) rotate(13deg);
      }
      .face[data-emotion='mischievous'] .brow--r {
        transform: translateY(-4px) rotate(-7deg);
      }

      /* Eye set swaps ---------------------------------------------------- */
      .face[data-emotion='crying'] .eyes {
        display: none;
      }
      .face[data-emotion='crying'] .cry-eyes {
        display: inline;
      }
      .face[data-emotion='defeated'] .eyes {
        display: none;
      }
      .face[data-emotion='defeated'] .x-eyes {
        display: inline;
      }
      .face[data-emotion='celebrating'] .eyes {
        display: none;
      }
      .face[data-emotion='celebrating'] .star-eyes {
        display: inline;
      }

      /* Eye scale (wide-eyed) -------------------------------------------- */
      .face[data-emotion='shocked'] .eyes {
        transform: scale(1.2);
      }
      .face[data-emotion='surprised'] .eyes {
        transform: scale(1.1);
      }
      .face[data-emotion='nervous'] .eyes {
        transform: scale(1.09);
      }
      .face[data-emotion='sweating'] .eyes {
        transform: scale(1.05);
      }
      .face[data-emotion='angry'] .eyes {
        transform: scaleY(0.82);
      }

      /* Pupil aim / size ------------------------------------------------- */
      .face[data-emotion='shocked'] .pupil {
        transform: scale(0.55);
      }
      .face[data-emotion='surprised'] .pupil {
        transform: scale(0.78);
      }
      .face[data-emotion='angry'] .pupil {
        transform: scale(0.72) translateY(1px);
      }
      .face[data-emotion='thinking'] .pupil {
        transform: translate(2.5px, -3px);
      }
      .face[data-emotion='sad'] .pupil,
      .face[data-emotion='worried'] .pupil {
        transform: translateY(3px);
      }
      .face[data-emotion='smug'] .pupil,
      .face[data-emotion='mischievous'] .pupil {
        transform: translate(2px, 1px);
      }

      /* Half-lidded (sleepy / sly / strained) ---------------------------- */
      .face[data-emotion='smug'] .lid,
      .face[data-emotion='mischievous'] .lid,
      .face[data-emotion='sweating'] .lid {
        transform: translateY(-1px);
      }

      /* Cheeks ----------------------------------------------------------- */
      .face[data-emotion='happy'] .cheek,
      .face[data-emotion='celebrating'] .cheek,
      .face[data-emotion='nervous'] .cheek,
      .face[data-emotion='sweating'] .cheek,
      .face[data-emotion='crying'] .cheek {
        display: inline;
      }
      .face[data-emotion='angry'] .cheek {
        display: inline;
        fill: var(--arena-danger);
        opacity: 0.6;
      }

      /* Mouth selection -------------------------------------------------- */
      .face[data-emotion='neutral'] .m-neutral,
      .face[data-emotion='thinking'] .m-think,
      .face[data-emotion='happy'] .m-smile,
      .face[data-emotion='confident'] .m-smile,
      .face[data-emotion='smug'] .m-smirk,
      .face[data-emotion='mischievous'] .m-smirk,
      .face[data-emotion='nervous'] .m-wavy,
      .face[data-emotion='worried'] .m-frown,
      .face[data-emotion='sad'] .m-frown,
      .face[data-emotion='surprised'] .m-o,
      .face[data-emotion='shocked'] .m-bigo,
      .face[data-emotion='crying'] .m-cry,
      .face[data-emotion='angry'] .m-grit,
      .face[data-emotion='celebrating'] .m-grin,
      .face[data-emotion='defeated'] .m-flat,
      .face[data-emotion='sweating'] .m-strain {
        display: inline;
      }

      /* Antenna poses ---------------------------------------------------- */
      .face[data-emotion='defeated'] .antenna {
        transform: rotate(118deg) translateY(1px);
      }
      .face[data-emotion='defeated'] .antenna-bulb {
        fill: var(--arena-text-faint);
        opacity: 0.7;
      }
      .face[data-emotion='sad'] .antenna,
      .face[data-emotion='crying'] .antenna,
      .face[data-emotion='worried'] .antenna {
        transform: rotate(24deg);
      }
      .face[data-emotion='angry'] .antenna-bulb {
        fill: var(--arena-danger);
      }
      .face[data-emotion='confident'] .antenna,
      .face[data-emotion='smug'] .antenna,
      .face[data-emotion='mischievous'] .antenna {
        transform: rotate(-12deg);
      }

      /* Whole-head tone shifts ------------------------------------------- */
      .face[data-emotion='defeated'] .head-group {
        filter: grayscale(0.6) brightness(0.98);
        transform: translateY(5px);
      }
      .face[data-emotion='sad'] .head-group,
      .face[data-emotion='crying'] .head-group {
        filter: saturate(0.75);
        transform: translateY(2px);
      }

      /* FX visibility ---------------------------------------------------- */
      .face[data-emotion='nervous'] .fx-sweat,
      .face[data-emotion='sweating'] .fx-sweat {
        display: inline;
      }
      .face[data-emotion='crying'] .fx-tears {
        display: inline;
      }
      .face[data-emotion='angry'] .fx-steam {
        display: inline;
      }
      .face[data-emotion='celebrating'] .fx-confetti {
        display: inline;
      }
      .face[data-emotion='thinking'] .fx-think {
        display: inline;
      }
      .face[data-emotion='smug'] .fx-sparkle,
      .face[data-emotion='mischievous'] .fx-sparkle,
      .face[data-emotion='confident'] .fx-sparkle {
        display: inline;
      }

      /* ---- Label --------------------------------------------------------- */
      .label {
        max-width: calc(var(--face-size) * 1.4);
        font-size: var(--arena-text-sm);
        font-weight: 700;
        color: var(--arena-text);
        text-align: center;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sublabel {
        display: block;
        font-size: var(--arena-text-xs);
        font-weight: 600;
        color: var(--arena-text-faint);
        text-transform: capitalize;
        letter-spacing: 0.02em;
      }

      /* =================================================================== */
      /*  MOTION — only when the user hasn't asked to reduce it.             */
      /* =================================================================== */
      @media (prefers-reduced-motion: no-preference) {
        .head {
          animation: breathe 4.2s ease-in-out infinite;
        }
        .eyes {
          animation: blink 5.4s ease-in-out infinite;
        }
        .antenna {
          animation: sway 3.6s ease-in-out infinite;
        }
        .antenna-bulb {
          animation: bulb-glow 2.4s ease-in-out infinite;
        }

        .face[data-emotion='thinking'] .antenna-bulb {
          animation: bulb-pulse 0.9s ease-in-out infinite;
        }
        .face[data-emotion='thinking'] .eyes {
          animation: none;
        }
        .face[data-emotion='thinking'] .think-dot {
          animation: think-rise 1.5s ease-in-out infinite;
        }
        .face[data-emotion='thinking'] .think-dot.d2 {
          animation-delay: 0.2s;
        }
        .face[data-emotion='thinking'] .think-dot.d3 {
          animation-delay: 0.4s;
        }

        .face[data-emotion='angry'] .head-group {
          animation: shake 0.32s linear infinite;
        }
        .face[data-emotion='angry'] .steam {
          animation: steam-rise 1.1s ease-out infinite;
        }
        .face[data-emotion='angry'] .steam.s2 {
          animation-delay: 0.45s;
        }

        .face[data-emotion='shocked'] .head-group {
          animation: jolt 0.5s ease-in-out infinite;
        }

        .face[data-emotion='surprised'] .head-group {
          animation: pop-in 0.3s cubic-bezier(0.2, 1.6, 0.4, 1) 1;
        }

        .face[data-emotion='nervous'] .head-group,
        .face[data-emotion='sweating'] .head-group {
          animation: tremble 0.28s linear infinite;
        }
        .face[data-emotion='nervous'] .drop,
        .face[data-emotion='sweating'] .drop {
          animation: sweat-fall 1.9s ease-in infinite;
        }
        .face[data-emotion='sweating'] .drop.b2 {
          animation-delay: 0.9s;
        }

        .face[data-emotion='crying'] .tear {
          animation: tear-fall 1.4s ease-in infinite;
        }
        .face[data-emotion='crying'] .tear.t2 {
          animation-delay: 0.55s;
        }
        .face[data-emotion='crying'] .m-cry {
          animation: quiver 0.22s ease-in-out infinite;
        }

        .face[data-emotion='celebrating'] .head-group {
          animation: bounce 0.62s cubic-bezier(0.3, 0.7, 0.3, 1) infinite;
        }
        .face[data-emotion='celebrating'] .antenna {
          animation: boing 0.62s cubic-bezier(0.3, 1.4, 0.4, 1) infinite;
        }
        .face[data-emotion='celebrating'] .confetti {
          animation: confetti-fall 1.5s linear infinite;
        }
        .face[data-emotion='celebrating'] .confetti.c2 {
          animation-delay: 0.3s;
        }
        .face[data-emotion='celebrating'] .confetti.c3 {
          animation-delay: 0.6s;
        }
        .face[data-emotion='celebrating'] .confetti.c4 {
          animation-delay: 0.9s;
        }
        .face[data-emotion='celebrating'] .confetti.c5 {
          animation-delay: 1.2s;
        }

        .face[data-emotion='smug'] .sparkle,
        .face[data-emotion='mischievous'] .sparkle,
        .face[data-emotion='confident'] .sparkle {
          animation: twinkle 1.6s ease-in-out infinite;
        }
      }

      @keyframes breathe {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.02);
        }
      }
      @keyframes blink {
        0%,
        92%,
        100% {
          transform: scaleY(1);
        }
        95%,
        97% {
          transform: scaleY(0.08);
        }
      }
      @keyframes sway {
        0%,
        100% {
          transform: rotate(-5deg);
        }
        50% {
          transform: rotate(5deg);
        }
      }
      @keyframes bulb-glow {
        0%,
        100% {
          opacity: 0.85;
        }
        50% {
          opacity: 1;
        }
      }
      @keyframes bulb-pulse {
        0%,
        100% {
          opacity: 0.35;
        }
        50% {
          opacity: 1;
        }
      }
      @keyframes think-rise {
        0% {
          opacity: 0;
          transform: translateY(3px);
        }
        40%,
        70% {
          opacity: 1;
          transform: translateY(0);
        }
        100% {
          opacity: 0;
          transform: translateY(-3px);
        }
      }
      @keyframes shake {
        0%,
        100% {
          transform: translateX(-1.4px) rotate(-1deg);
        }
        50% {
          transform: translateX(1.4px) rotate(1deg);
        }
      }
      @keyframes steam-rise {
        0% {
          opacity: 0;
          transform: translateY(2px) scale(0.7);
        }
        30% {
          opacity: 0.75;
        }
        100% {
          opacity: 0;
          transform: translateY(-10px) scale(1.1);
        }
      }
      @keyframes jolt {
        0%,
        100% {
          transform: translateY(0) scale(1);
        }
        50% {
          transform: translateY(-1.5px) scale(1.03);
        }
      }
      @keyframes pop-in {
        0% {
          transform: scale(0.9);
        }
        100% {
          transform: scale(1);
        }
      }
      @keyframes tremble {
        0%,
        100% {
          transform: translate(-0.8px, 0);
        }
        50% {
          transform: translate(0.8px, 0.4px);
        }
      }
      @keyframes sweat-fall {
        0% {
          opacity: 0;
          transform: translateY(-3px);
        }
        18% {
          opacity: 1;
        }
        80% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateY(20px);
        }
      }
      @keyframes tear-fall {
        0% {
          opacity: 0;
          transform: translateY(0) scaleY(0.8);
        }
        20% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateY(24px) scaleY(1.15);
        }
      }
      @keyframes quiver {
        0%,
        100% {
          transform: translateX(-0.7px);
        }
        50% {
          transform: translateX(0.7px);
        }
      }
      @keyframes bounce {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-6px);
        }
      }
      @keyframes boing {
        0%,
        100% {
          transform: rotate(-9deg);
        }
        50% {
          transform: rotate(9deg);
        }
      }
      @keyframes confetti-fall {
        0% {
          opacity: 0;
          transform: translateY(-6px) rotate(0deg);
        }
        15% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateY(26px) rotate(220deg);
        }
      }
      @keyframes twinkle {
        0%,
        100% {
          opacity: 0.2;
          transform: scale(0.7);
        }
        50% {
          opacity: 1;
          transform: scale(1);
        }
      }
      @keyframes bubble-pop {
        0% {
          opacity: 0;
          transform: translateX(-50%) scale(0.8);
        }
        100% {
          opacity: 1;
          transform: translateX(-50%) scale(1);
        }
      }
    `,
  ];

  protected override render(): unknown {
    const seatVar = `var(--arena-seat-${seatColorIndex(this.seat)})`;
    const ariaLabel = this.label ? `${this.label}: ${this.emotion}` : this.emotion;
    const quip = this.note.trim();

    return html`
      <div class="stage" style=${`--face-size:${this.size}px; --seat:${seatVar};`}>
        ${quip ? html`<div class="bubble" role="note">${quip}</div>` : null}
        ${this.renderFace(ariaLabel)}
        ${this.label
          ? html`<div class="label">
              ${this.label}<span class="sublabel">${this.emotion}</span>
            </div>`
          : null}
      </div>
    `;
  }

  private renderFace(ariaLabel: string): unknown {
    return html`
      <svg
        class="face"
        data-emotion=${this.emotion}
        viewBox="0 0 100 118"
        role="img"
        aria-label=${ariaLabel}
      >
        <!-- Antenna: the mood tell -->
        <g class="antenna">
          <path class="antenna-stalk stroke" d="M50,30 C50,22 50,17 50,13" />
          <circle class="antenna-bulb" cx="50" cy="10" r="4.6" />
        </g>

        <g class="head-group">
          <!-- little side "ears"/ports for silhouette -->
          <rect class="ear" x="10" y="56" width="7" height="16" rx="3" />
          <rect class="ear" x="83" y="56" width="7" height="16" rx="3" />

          <!-- Head -->
          <rect class="head" x="16" y="30" width="68" height="64" rx="25" ry="26" />

          <!-- Cheeks (blush / anger flush) -->
          <ellipse class="cheek" cx="30" cy="74" rx="6.5" ry="4.2" />
          <ellipse class="cheek" cx="70" cy="74" rx="6.5" ry="4.2" />

          <!-- Brows -->
          <path class="brow brow--l stroke" d="M27,45 Q35,40.5 43,44.5" />
          <path class="brow brow--r stroke" d="M57,44.5 Q65,40.5 73,45" />

          <!-- Normal eyes -->
          <g class="eyes">
            <g class="eye eye--l" transform="translate(37,58)">
              <ellipse class="eye-white" rx="9" ry="11" />
              <circle class="pupil" r="4.6" cy="0.5" />
              <circle class="glint" cx="1.9" cy="-2.6" r="1.5" />
              <rect class="lid" x="-10" y="-16" width="20" height="15" rx="5" />
            </g>
            <g class="eye eye--r" transform="translate(63,58)">
              <ellipse class="eye-white" rx="9" ry="11" />
              <circle class="pupil" r="4.6" cy="0.5" />
              <circle class="glint" cx="1.9" cy="-2.6" r="1.5" />
              <rect class="lid" x="-10" y="-16" width="20" height="15" rx="5" />
            </g>
          </g>

          <!-- Crying eyes: squeezed-shut upward arcs -->
          <g class="cry-eyes">
            <path class="stroke" d="M28,60 Q37,50 46,60" />
            <path class="stroke" d="M54,60 Q63,50 72,60" />
          </g>

          <!-- Defeated eyes: dead X's -->
          <g class="x-eyes">
            <path class="stroke" d="M31,52 L43,64 M43,52 L31,64" />
            <path class="stroke" d="M57,52 L69,64 M69,52 L57,64" />
          </g>

          <!-- Celebrating eyes: stars -->
          <g class="star-eyes">
            <path class="star" transform="translate(37,58)" d=${STAR} />
            <path class="star" transform="translate(63,58)" d=${STAR} />
          </g>

          <!-- Mouths (exactly one shows per emotion) -->
          <path class="mouth m-neutral stroke" d="M41,81 Q50,84 59,81" />
          <path class="mouth m-think stroke" d="M45,82 Q51,81 56,79" />
          <path class="mouth m-smile stroke" d="M36,78 Q50,91 64,78" />
          <path class="mouth m-smirk stroke" d="M39,83 Q49,84 62,75" />
          <path class="mouth m-frown stroke" d="M38,86 Q50,78 62,86" />
          <path
            class="mouth m-wavy stroke"
            d="M38,82 q3,-4 6,0 q3,4 6,0 q3,-4 6,0"
          />
          <path class="mouth m-strain stroke" d="M39,82 Q50,86 61,82" />
          <ellipse class="mouth m-o fill" cx="50" cy="83" rx="5.5" ry="6.8" />
          <ellipse class="mouth m-bigo fill" cx="50" cy="83" rx="8.5" ry="11.5" />

          <!-- Angry: gritted teeth -->
          <g class="mouth m-grit">
            <rect
              class="fill"
              x="38"
              y="78"
              width="24"
              height="10"
              rx="2.5"
            />
            <path class="teeth" d="M38,83 L62,83 M44,78 L44,88 M50,78 L50,88 M56,78 L56,88" />
          </g>

          <!-- Crying: open wailing mouth -->
          <path class="mouth m-cry fill" d="M40,83 Q50,80 60,83 Q56,95 44,95 Z" />

          <!-- Celebrating: open grin + tongue -->
          <g class="mouth m-grin">
            <path class="fill" d="M35,78 Q50,80 65,78 Q59,95 41,95 Q36,88 35,78 Z" />
            <path class="tongue" d="M43,91 Q50,88 57,91 Q56,96 50,96 Q44,96 43,91 Z" />
          </g>

          <!-- Defeated: glum flat line -->
          <path class="mouth m-flat stroke" d="M41,84 L59,84" />
        </g>

        <!-- ================= FX overlays ================= -->

        <!-- Sweat beads sliding down the temple -->
        <g class="fx fx-sweat">
          <path class="drop b1" transform="translate(80,50)" d=${DROP} />
          <path class="drop b2" transform="translate(18,52)" d=${DROP} />
        </g>

        <!-- Streaming tears -->
        <g class="fx fx-tears">
          <path class="drop tear t1" transform="translate(34,70)" d=${DROP} />
          <path class="drop tear t2" transform="translate(66,70)" d=${DROP} />
        </g>

        <!-- Angry steam puffs -->
        <g class="fx fx-steam">
          <path class="steam s1" d="M26,30 q-4,-5 0,-9 q4,-4 0,-9" />
          <path class="steam s2" d="M74,30 q4,-5 0,-9 q-4,-4 0,-9" />
        </g>

        <!-- Thinking dots -->
        <g class="fx fx-think">
          <circle class="think-dot d1" cx="76" cy="34" r="2" />
          <circle class="think-dot d2" cx="83" cy="28" r="2.4" />
          <circle class="think-dot d3" cx="91" cy="21" r="2.8" />
        </g>

        <!-- Celebration confetti -->
        <g class="fx fx-confetti">
          <rect class="confetti c1" x="20" y="20" width="5" height="5" rx="1" fill="var(--arena-seat-3)" />
          <circle class="confetti c2" cx="78" cy="22" r="2.6" fill="var(--arena-seat-2)" />
          <rect class="confetti c3" x="12" y="42" width="4" height="6" rx="1" fill="var(--arena-seat-4)" />
          <circle class="confetti c4" cx="88" cy="44" r="2.6" fill="var(--arena-seat-5)" />
          <rect class="confetti c5" x="50" y="14" width="5" height="5" rx="1" fill="var(--arena-seat-6)" />
        </g>

        <!-- Smug / mischievous / confident glint -->
        <g class="fx fx-sparkle">
          <path class="sparkle" transform="translate(70,46) scale(0.8)" d=${GLINT} />
        </g>
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-agent-face': ArenaAgentFace;
  }
}
