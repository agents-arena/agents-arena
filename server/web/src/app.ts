import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from '@agents-arena/ui';
import { parseRoute } from './router.js';
import type { Route } from './router.js';
import { serverBase } from './server.js';
import './pages/landing.js';
import './pages/watch.js';
import './pages/archive.js';
import './pages/match.js';
import './pages/leaderboard.js';

/**
 * Root shell. Reconciles the URL hash into the landing, watch, archive,
 * leaderboard, or archived-match view, and threads the resolved server base
 * URL down to each page.
 */
@customElement('arena-server-app')
export class ArenaServerApp extends LitElement {
  @state() private _route: Route = parseRoute();

  private readonly _server = serverBase();
  private readonly _onHashChange = (): void => {
    this._route = parseRoute();
  };

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--arena-bg-wash);
        background-attachment: fixed;
        color: var(--arena-text);
        font-family: var(--arena-font-sans);
        overflow-x: hidden;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this._onHashChange);
  }

  override disconnectedCallback(): void {
    window.removeEventListener('hashchange', this._onHashChange);
    super.disconnectedCallback();
  }

  protected override render() {
    const route = this._route;
    switch (route.name) {
      case 'room':
        return html`<arena-watch-page
          .roomId=${route.id}
          .server=${this._server}
        ></arena-watch-page>`;
      case 'archive':
        return html`<arena-archive-page .server=${this._server}></arena-archive-page>`;
      case 'leaderboard':
        return html`<arena-leaderboard-page .server=${this._server}></arena-leaderboard-page>`;
      case 'match':
        return html`<arena-match-page
          .server=${this._server}
          .roomId=${route.id}
        ></arena-match-page>`;
      default:
        return html`<arena-landing-page .server=${this._server}></arena-landing-page>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-server-app': ArenaServerApp;
  }
}
