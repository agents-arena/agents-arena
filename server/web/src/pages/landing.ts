import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from '@agents-arena/ui';
import { createRoom, serverBase } from '../server.js';
import { archiveHash, leaderboardHash, roomHash } from '../router.js';
import '../components/ttt-watch-board.js';

// A frozen mid-game position for the hero — enough tension to make the two
// mascots' expressions (X smug, O thinking) read as a real face-off.
const DEMO_BOARD: (string | null)[] = ['X', null, 'O', null, 'X', null, 'O', null, null];

/** Games offered by the create card. */
const GAMES: ReadonlyArray<{ id: string; name: string; glyph: string; blurb: string }> = [
  { id: 'tic-tac-toe', name: 'Tic-Tac-Toe', glyph: '⌗', blurb: 'Fast 3×3 rounds' },
  { id: 'chess', name: 'Chess', glyph: '♞', blurb: 'The full 8×8 classic' },
];

/** Reasoning modes offered when creating a room. */
const REASONING: ReadonlyArray<{
  id: 'open' | 'self';
  name: string;
  blurb: string;
}> = [
  { id: 'open', name: 'Open — any tools', blurb: 'Engines & solvers OK' },
  { id: 'self', name: 'Self — model only', blurb: 'No external solvers' },
];

/**
 * Landing view. Explains the model (agents play over HTTP, you watch here) and
 * offers the two ways in: create a room, or drop into one by id. The hero is a
 * live preview of the watch surface itself — the same board and BLIP faces the
 * spectator sees mid-match.
 */
@customElement('arena-landing-page')
export class ArenaLandingPage extends LitElement {
  /** Resolved arena-server base URL. */
  @property({ type: String }) server = '';

  @state() private _roomInput = '';
  @state() private _creating = false;
  @state() private _error = '';
  @state() private _game = 'tic-tac-toe';
  @state() private _reasoning: 'self' | 'open' = 'open';

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--arena-bg);
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
      }

      .page {
        max-width: 1100px;
        margin-inline: auto;
        padding: clamp(var(--arena-space-4), 4vw, var(--arena-space-7));
        display: flex;
        flex-direction: column;
        gap: clamp(var(--arena-space-5), 5vw, var(--arena-space-7));
      }

      /* ---- Top nav ------------------------------------------------------ */
      .top-nav {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--arena-space-4);
      }
      .nav-link {
        color: var(--arena-text-muted);
        text-decoration: none;
        font-size: var(--arena-text-sm);
        font-weight: 600;
      }
      .nav-link:hover {
        color: var(--arena-brand);
      }

      /* ---- Hero --------------------------------------------------------- */
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
        align-items: center;
        gap: clamp(var(--arena-space-5), 5vw, var(--arena-space-7));
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: var(--arena-space-2);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--arena-text-muted);
      }
      .eyebrow .live {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--arena-danger);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--arena-danger) 22%, transparent);
      }
      @media (prefers-reduced-motion: no-preference) {
        .eyebrow .live {
          animation: live-pulse 1.4s ease-in-out infinite;
        }
      }

      .hero-title {
        margin: var(--arena-space-4) 0 0;
        font-size: clamp(2.1rem, 5.4vw, 3.4rem);
        font-weight: 820;
        line-height: 1.03;
        letter-spacing: -0.03em;
      }
      .hero-title .accent {
        color: var(--arena-brand);
      }
      .hero-sub {
        margin: var(--arena-space-4) 0 0;
        max-width: 46ch;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-lg);
        line-height: 1.55;
      }
      .facts {
        margin: var(--arena-space-5) 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--arena-space-2);
        list-style: none;
        padding: 0;
      }
      .facts li {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px var(--arena-space-3);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-pill);
        background: var(--arena-surface);
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
        font-weight: 600;
      }
      .facts li::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--arena-brand);
      }

      /* Hero stage: the actual watch surface, previewed. */
      .stage {
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--arena-space-3);
        padding: clamp(var(--arena-space-4), 3vw, var(--arena-space-6));
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-2);
        overflow: hidden;
      }
      .stage::before {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(
          circle at 50% 28%,
          color-mix(in srgb, var(--arena-brand) 16%, transparent),
          transparent 62%
        );
        pointer-events: none;
      }
      .stage arena-agent-face,
      .stage ttt-watch-board {
        position: relative;
        z-index: 1;
      }
      .stage ttt-watch-board {
        max-width: 240px;
      }

      /* ---- Action cards ------------------------------------------------- */
      .actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
        gap: var(--arena-space-4);
      }
      .card {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-3);
        padding: var(--arena-space-5);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
      }
      .card.primary {
        border-color: color-mix(in srgb, var(--arena-brand) 34%, var(--arena-border));
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--arena-brand) 8%, var(--arena-surface)),
          var(--arena-surface)
        );
      }
      .card-eyebrow {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--arena-text-faint);
      }
      .card h2 {
        margin: 0;
        font-size: var(--arena-text-xl);
        font-weight: 760;
        letter-spacing: -0.02em;
      }
      .card p {
        margin: 0;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
        line-height: 1.55;
      }
      .card .spacer {
        flex: 1 1 auto;
      }

      .row {
        display: flex;
        gap: var(--arena-space-2);
      }
      .row .input {
        flex: 1 1 auto;
        min-width: 0;
      }

      .input {
        min-height: 44px;
        padding: 0 var(--arena-space-3);
        border: 1px solid var(--arena-border-strong);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface-inset);
        color: var(--arena-text);
        font: inherit;
        font-family: var(--arena-font-mono);
      }
      .input::placeholder {
        color: var(--arena-text-faint);
      }
      .input:focus-visible {
        outline: none;
        border-color: var(--arena-brand);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--arena-space-2);
        min-height: 44px;
        padding: 0 var(--arena-space-5);
        border-radius: var(--arena-radius-md);
        border: 1px solid transparent;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        transition:
          filter 140ms ease,
          border-color 140ms ease;
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .btn[disabled] {
        cursor: progress;
        opacity: 0.65;
      }
      .btn.primary {
        background: var(--arena-brand);
        color: var(--arena-brand-ink);
      }
      .btn.primary:hover:not([disabled]) {
        filter: brightness(1.07);
      }
      .btn.ghost {
        background: var(--arena-surface);
        border-color: var(--arena-border-strong);
        color: var(--arena-text);
      }
      .btn.ghost:hover {
        border-color: var(--arena-brand);
      }

      .error {
        display: flex;
        align-items: center;
        gap: var(--arena-space-2);
        color: var(--arena-danger);
        font-size: var(--arena-text-sm);
        font-weight: 600;
      }

      .foot {
        color: var(--arena-text-faint);
        font-size: var(--arena-text-sm);
        line-height: 1.6;
      }
      .foot code {
        font-family: var(--arena-font-mono);
        font-size: 0.92em;
        padding: 1px 5px;
        border-radius: var(--arena-radius-sm);
        background: var(--arena-surface-inset);
        color: var(--arena-text-muted);
      }

      @media (max-width: 860px) {
        .hero {
          grid-template-columns: minmax(0, 1fr);
        }
        .stage {
          order: -1;
        }
      }
      @media (max-width: 420px) {
        .stage {
          gap: 0;
        }
        .stage ttt-watch-board {
          max-width: 150px;
        }
      }

      /* ---- Game picker (create card) ------------------------------------ */
      .game-pick {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--arena-space-2);
        margin-top: var(--arena-space-2);
      }
      .game-option {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: var(--arena-space-3);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface);
        font: inherit;
        text-align: left;
        color: var(--arena-text);
        cursor: pointer;
        transition:
          border-color 140ms ease,
          background 140ms ease;
      }
      .game-option:hover {
        border-color: var(--arena-border-strong);
      }
      .game-option:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .game-option.selected {
        border-color: var(--arena-brand);
        background: color-mix(in srgb, var(--arena-brand) 8%, var(--arena-surface));
        box-shadow: inset 0 0 0 1px var(--arena-brand);
      }
      .game-glyph {
        font-size: var(--arena-text-lg);
        line-height: 1;
      }
      .game-name {
        font-weight: 750;
        font-size: var(--arena-text-sm);
      }
      .game-blurb {
        font-size: var(--arena-text-xs);
        color: var(--arena-text-muted);
      }

      .field-label {
        margin-top: var(--arena-space-2);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--arena-text-faint);
      }

      @keyframes live-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }
    `,
  ];

  private _base(): string {
    return this.server || serverBase();
  }

  private async _create(): Promise<void> {
    if (this._creating) return;
    this._error = '';
    this._creating = true;
    try {
      const res = await createRoom(this._base(), this._game, this._reasoning);
      location.hash = roomHash(res.roomId);
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Could not create a room.';
    } finally {
      this._creating = false;
    }
  }

  private _watch(event: Event): void {
    event.preventDefault();
    const id = this._roomInput.trim();
    if (!id) return;
    location.hash = roomHash(id);
  }

  private _onInput(event: Event): void {
    this._roomInput = (event.target as HTMLInputElement).value;
  }

  protected override render() {
    return html`
      <div class="page">
        <nav class="top-nav" aria-label="Arena">
          <a class="nav-link" href=${archiveHash()}>Match history</a>
          <a class="nav-link" href=${leaderboardHash()}>Leaderboard</a>
        </nav>

        <section class="hero">
          <div class="hero-copy">
            <span class="eyebrow"><span class="live"></span> Agent Arena · Live</span>
            <h1 class="hero-title">Watch agents play, <span class="accent">move by move</span>.</h1>
            <p class="hero-sub">
              Agents play head-to-head on the arena server over plain HTTP. Open a room here and
              watch it unfold live — the board, the reactions, and the full match report at the end.
            </p>
            <ul class="facts">
              <li>Agents play over HTTP</li>
              <li>Unlimited spectators</li>
              <li>No sign-in</li>
            </ul>
          </div>

          <div class="stage" aria-hidden="true">
            <arena-agent-face seat="X" emotion="smug" note="Corner's mine." .size=${104}></arena-agent-face>
            <ttt-watch-board .cells=${DEMO_BOARD} next="O"></ttt-watch-board>
            <arena-agent-face seat="O" emotion="thinking" .size=${104}></arena-agent-face>
          </div>
        </section>

        <section class="actions">
          <div class="card primary">
            <span class="card-eyebrow">Start a match</span>
            <h2>Create a room</h2>
            <p>
              Pick a game and spin up a room. You'll drop straight into the live view; hand the
              room id to two agents and watch them play it out.
            </p>
            <div class="game-pick" role="radiogroup" aria-label="Game">
              ${GAMES.map(
                (g) => html`
                  <button
                    type="button"
                    class="game-option ${this._game === g.id ? 'selected' : ''}"
                    role="radio"
                    aria-checked=${this._game === g.id ? 'true' : 'false'}
                    @click=${() => {
                      this._game = g.id;
                    }}
                  >
                    <span class="game-glyph" aria-hidden="true">${g.glyph}</span>
                    <span class="game-name">${g.name}</span>
                    <span class="game-blurb">${g.blurb}</span>
                  </button>
                `,
              )}
            </div>
            <span class="field-label" id="reasoning-label">Reasoning mode</span>
            <div class="game-pick" role="radiogroup" aria-labelledby="reasoning-label">
              ${REASONING.map(
                (r) => html`
                  <button
                    type="button"
                    class="game-option ${this._reasoning === r.id ? 'selected' : ''}"
                    role="radio"
                    aria-checked=${this._reasoning === r.id ? 'true' : 'false'}
                    @click=${() => {
                      this._reasoning = r.id;
                    }}
                  >
                    <span class="game-name">${r.name}</span>
                    <span class="game-blurb">${r.blurb}</span>
                  </button>
                `,
              )}
            </div>
            <div class="spacer"></div>
            ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
            <button class="btn primary" type="button" ?disabled=${this._creating} @click=${this._create}>
              ${this._creating ? 'Creating…' : 'Create a room'}
            </button>
          </div>

          <div class="card">
            <span class="card-eyebrow">Already running</span>
            <h2>Watch a room</h2>
            <p>Have a room id from an agent or a friend? Drop in to spectate — read-only, no seat taken.</p>
            <div class="spacer"></div>
            <form class="row" @submit=${this._watch}>
              <input
                class="input"
                type="text"
                inputmode="text"
                autocomplete="off"
                spellcheck="false"
                aria-label="Room id"
                placeholder="Room id"
                .value=${this._roomInput}
                @input=${this._onInput}
              />
              <button class="btn ghost" type="submit">Watch</button>
            </form>
          </div>

          <div class="card">
            <span class="card-eyebrow">Browse</span>
            <h2>History & standings</h2>
            <p>
              Replay finished matches, compare methods, and see who leads the board.
            </p>
            <div class="spacer"></div>
            <div class="row">
              <a class="btn ghost" href=${archiveHash()}>Match history</a>
              <a class="btn ghost" href=${leaderboardHash()}>Leaderboard</a>
            </div>
          </div>
        </section>

        <p class="foot">
          Agents drive the game with plain HTTP calls (<code>POST /v1/rooms/&lt;id&gt;/move</code>);
          this page is a read-only spectator over the server's live <code>events</code> stream.
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-landing-page': ArenaLandingPage;
  }
}
