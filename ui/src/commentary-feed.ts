// <arena-commentary-feed> — the right-rail "COMMENTARY" panel of a live match.
//
// A scrolling log of two kinds of events, newest at the top (chronological
// items in the DOM, `column-reverse` for display — the design's chat trick,
// which also keeps the scroll pinned to the newest entry):
//   move — a small seat-tinted square tile, the SAN in mono, and a faint
//          "thought Xs" label;
//   say  — the seat's robot avatar, a tinted name, a seat chip, and the
//          message in a speech bubble.
//
// Purely presentational — the parent feeds `items` in chronological order.
import { LitElement, html, css, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes, seatColorIndex } from './theme.js';
import './agent-avatar.js';

/** One feed entry, oldest → newest in the `items` array. */
export type FeedItem =
  | { kind: 'move'; seat: string; san: string; thinkLabel?: string }
  | { kind: 'say'; seat?: string; name: string; text: string };

type ChipVariant = 'wood-white' | 'wood-black' | 'accent' | 'tinted';

/** Which chip treatment a seat gets: wood for chess, solid accent for X/O. */
function chipVariant(seat: string): ChipVariant {
  const key = seat.trim().toLowerCase();
  if (key === 'white' || key === 'w') return 'wood-white';
  if (key === 'black' || key === 'b') return 'wood-black';
  if (key === 'x' || key === 'o') return 'accent';
  return 'tinted';
}

/** The move tile's look: cream for the white seat, dark for black, tint otherwise. */
function dotVariant(seat: string): 'cream' | 'dark' | 'tint' {
  const key = seat.trim().toLowerCase();
  if (key === 'white' || key === 'w') return 'cream';
  if (key === 'black' || key === 'b') return 'dark';
  return 'tint';
}

/**
 * The live commentary feed shown in a match's right rail.
 *
 * @example
 * html`<arena-commentary-feed .items=${feed}></arena-commentary-feed>`
 */
@customElement('arena-commentary-feed')
export class ArenaCommentaryFeed extends LitElement {
  /** Feed entries in chronological order (rendered newest at the top). */
  @property({ attribute: false }) items: FeedItem[] = [];
  /** Mono section eyebrow. */
  @property({ type: String }) override title = 'COMMENTARY';
  /** Shown while the feed is empty. */
  @property({ type: String }) emptyLabel = 'Waiting for the first move — agents talk trash here.';

  static override styles: CSSResultGroup = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        min-width: 0;
        font-family: var(--arena-font-sans);
      }

      .panel {
        background: var(--arena-surface);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 16px;
        padding: 16px;
        min-height: 0;
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 2px 2px 12px;
      }
      .eyebrow {
        font: 700 10px var(--arena-font-mono);
        letter-spacing: 0.22em;
        color: var(--arena-text-label);
        text-transform: uppercase;
      }
      .count {
        font: 600 10px var(--arena-font-mono);
        color: var(--arena-text-faint);
        white-space: nowrap;
      }

      /* Newest at top: chronological DOM + column-reverse (also pins scroll). */
      .list {
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
        max-height: var(--arena-feed-max-height, 430px);
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 4px;
        overscroll-behavior: contain;
      }

      .empty {
        font: italic 400 12px var(--arena-font-sans);
        color: var(--arena-text-faint);
        padding: 8px 2px;
      }

      /* --- Move item --------------------------------------------------------- */
      .move {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 2px;
        min-width: 0;
      }
      .dot {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 2px;
      }
      .dot.cream {
        background: var(--arena-chip-white-bg);
      }
      .dot.dark {
        background: #33302b;
        border: 1px solid rgba(255, 255, 255, 0.25);
      }
      .dot.tint {
        background: var(--seat);
      }
      .san {
        font: 700 12px var(--arena-font-mono);
        color: var(--arena-chip-black-ink);
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .think {
        font: 500 10px var(--arena-font-mono);
        color: var(--arena-text-faint);
        white-space: nowrap;
      }

      /* --- Say item ----------------------------------------------------------- */
      .say {
        display: flex;
        gap: 9px;
        padding: 6px 2px;
        min-width: 0;
      }
      .say arena-agent-avatar {
        flex: 0 0 auto;
        margin-top: 2px;
      }
      .body {
        flex: 1;
        min-width: 0;
      }
      .who {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 7px;
        min-width: 0;
      }
      .who-name {
        font: 700 12px var(--arena-font-sans);
        color: var(--arena-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }
      .who-name.tinted {
        color: color-mix(in srgb, var(--seat) 72%, white);
      }
      .bubble {
        margin-top: 4px;
        font: 400 13px/1.45 var(--arena-font-sans);
        color: #cfc9bb;
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.07);
        padding: 8px 11px;
        border-radius: 4px 12px 12px 12px;
        overflow-wrap: anywhere;
      }

      /* --- Seat chips (feed size, per design seatW/seatB) ---------------------- */
      .chip {
        flex: 0 0 auto;
        font: 700 8.5px var(--arena-font-mono);
        letter-spacing: 0.08em;
        padding: 2px 7px;
        border-radius: 5px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .chip.wood-white {
        color: var(--arena-chip-white-ink);
        background: var(--arena-chip-white-bg);
      }
      .chip.wood-black {
        color: var(--arena-chip-black-ink);
        background: var(--arena-chip-black-bg);
        border: 1px solid var(--arena-border-strong);
      }
      .chip.accent {
        font-weight: 800;
        letter-spacing: normal;
        color: #0e0d17;
        background: var(--seat);
      }
      .chip.tinted {
        color: color-mix(in srgb, var(--seat) 72%, var(--arena-text));
        background: color-mix(in srgb, var(--seat) 14%, transparent);
        border: 1px solid color-mix(in srgb, var(--seat) 35%, var(--arena-border));
      }

      @media (prefers-reduced-motion: no-preference) {
        .item {
          animation: aa-pop 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
        }
      }
    `,
  ];

  private _seatStyle(seat: string | undefined): string {
    return seat ? `--seat: var(--arena-seat-${seatColorIndex(seat)})` : '';
  }

  private _renderItem(item: FeedItem): TemplateResult {
    if (item.kind === 'move') {
      return html`
        <div class="item">
          <div class="move" style=${this._seatStyle(item.seat)}>
            <i class="dot ${dotVariant(item.seat)}" aria-hidden="true"></i>
            <span class="san">${item.san}</span>
            ${item.thinkLabel ? html`<span class="think">${item.thinkLabel}</span>` : nothing}
          </div>
        </div>
      `;
    }
    const seat = item.seat ?? '';
    return html`
      <div class="item">
        <div class="say" style=${this._seatStyle(item.seat)}>
          <arena-agent-avatar seat=${seat} name=${item.name} .size=${26}></arena-agent-avatar>
          <div class="body">
            <div class="who">
              <span class="who-name ${seat ? 'tinted' : ''}" title=${item.name}>${item.name}</span>
              ${seat ? html`<span class="chip ${chipVariant(seat)}">${seat}</span>` : nothing}
            </div>
            <div class="bubble">${item.text}</div>
          </div>
        </div>
      </div>
    `;
  }

  protected override render(): TemplateResult {
    return html`
      <div class="panel">
        <div class="head">
          <div class="eyebrow">${this.title}</div>
          <div class="count">${this.items.length} events</div>
        </div>
        <div class="list" role="log" aria-live="polite">
          ${this.items.length === 0 ? html`<div class="empty">${this.emptyLabel}</div>` : nothing}
          ${this.items.map((item) => this._renderItem(item))}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-commentary-feed': ArenaCommentaryFeed;
  }
}
