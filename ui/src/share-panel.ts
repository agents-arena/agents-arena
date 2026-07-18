import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import QRCode from 'qrcode';
import { arenaTokens, resetStyles } from './theme.js';

/**
 * Invite panel: shows the room link in a read-only field with a one-tap Copy
 * button (transient "Copied!" confirmation) and a scannable QR code. The QR is
 * regenerated whenever `url` changes; clipboard and QR failures degrade
 * gracefully rather than throwing.
 */
@customElement('arena-share-panel')
export class ArenaSharePanel extends LitElement {
  /** The room / invite URL to share. */
  @property({ type: String }) url = '';
  /** Panel heading. */
  @property({ type: String }) heading = 'Invite players';

  @state() private _copied = false;
  @state() private _copyFailed = false;
  @state() private _qr = '';
  @state() private _qrError = false;

  private _copyTimer: ReturnType<typeof setTimeout> | undefined;

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
      }

      .panel {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-3);
        padding: var(--arena-space-4);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
      }

      .heading {
        margin: 0;
        font-size: var(--arena-text-sm);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--arena-text-muted);
      }

      .row {
        display: flex;
        gap: var(--arena-space-2);
      }

      .url {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 44px;
        padding: 0 var(--arena-space-3);
        border: 1px solid var(--arena-border-strong);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface-inset);
        color: var(--arena-text);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-sm);
      }
      .url:focus-visible {
        outline: none;
        border-color: var(--arena-brand);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }

      .copy {
        flex: 0 0 auto;
        min-width: 84px;
        min-height: 44px;
        padding: 0 var(--arena-space-4);
        border: 1px solid transparent;
        border-radius: var(--arena-radius-md);
        background: var(--arena-brand);
        color: var(--arena-brand-ink);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        transition:
          filter 140ms ease,
          background 140ms ease;
      }
      .copy:hover {
        filter: brightness(1.06);
      }
      .copy:active {
        filter: brightness(0.95);
      }
      .copy:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .copy.ok {
        background: var(--arena-success);
      }
      .copy.fail {
        background: var(--arena-danger);
      }

      .qr {
        display: grid;
        place-items: center;
        padding: var(--arena-space-3);
        border: 1px dashed var(--arena-border-strong);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface-2);
        min-height: 120px;
      }
      .qr img {
        display: block;
        width: 168px;
        height: 168px;
        max-width: 100%;
        border-radius: var(--arena-radius-sm);
        /* QR is intentionally dark-on-white so it scans in either theme. */
        background: #ffffff;
      }
      .qr-msg {
        margin: 0;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
        text-align: center;
      }
    `,
  ];

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._copyTimer !== undefined) clearTimeout(this._copyTimer);
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('url')) void this._generateQr();
  }

  private async _generateQr(): Promise<void> {
    const url = this.url;
    if (!url) {
      this._qr = '';
      this._qrError = false;
      return;
    }
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 336,
        color: { dark: '#0e1622ff', light: '#ffffffff' },
      });
      if (this.url === url) {
        this._qr = dataUrl;
        this._qrError = false;
      }
    } catch {
      if (this.url === url) {
        this._qr = '';
        this._qrError = true;
      }
    }
  }

  private _selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  private async _copy(): Promise<void> {
    if (this._copyTimer !== undefined) clearTimeout(this._copyTimer);
    try {
      await navigator.clipboard.writeText(this.url);
      this._copied = true;
      this._copyFailed = false;
    } catch {
      // No clipboard access — select the field so the user can copy manually.
      this._copied = false;
      this._copyFailed = true;
      const input = this.renderRoot.querySelector<HTMLInputElement>('.url');
      input?.select();
    }
    this._copyTimer = setTimeout(() => {
      this._copied = false;
      this._copyFailed = false;
    }, 1800);
  }

  private get _copyLabel(): string {
    if (this._copied) return 'Copied!';
    if (this._copyFailed) return 'Press Ctrl+C';
    return 'Copy';
  }

  protected override render() {
    const copyCls = ['copy', this._copied ? 'ok' : '', this._copyFailed ? 'fail' : '']
      .filter(Boolean)
      .join(' ');
    return html`
      <section class="panel" aria-label=${this.heading}>
        <h3 class="heading">${this.heading}</h3>
        <div class="row">
          <input
            class="url"
            type="text"
            readonly
            aria-label="Invite link"
            .value=${this.url}
            @focus=${this._selectAll}
          />
          <button
            class=${copyCls}
            type="button"
            @click=${this._copy}
            aria-label=${this._copied ? 'Link copied' : 'Copy invite link'}
          >
            ${this._copyLabel}
          </button>
        </div>
        <div class="qr">
          ${this._renderQr()}
        </div>
      </section>
    `;
  }

  private _renderQr() {
    if (this._qrError) {
      return html`<p class="qr-msg">Couldn't build a QR code. Share the link above instead.</p>`;
    }
    if (!this._qr) {
      return html`<p class="qr-msg">${this.url ? 'Generating QR code…' : 'Add a link to generate a QR code.'}</p>`;
    }
    return html`<img src=${this._qr} alt="QR code linking to this room" />`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-share-panel': ArenaSharePanel;
  }
}
