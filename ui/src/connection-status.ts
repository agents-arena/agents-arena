import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles } from './theme.js';

/** Lifecycle phase of the realtime connection to the room. */
export type ConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'closed';

const LABELS: Record<ConnectionPhase, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
};

/**
 * Compact connection indicator: a colored dot plus a label, with a distinct
 * color per phase (brand while connecting, green when connected, amber while
 * reconnecting, red when closed). The transient phases pulse.
 */
@customElement('arena-connection-status')
export class ArenaConnectionStatus extends LitElement {
  /** Current connection phase. */
  @property({ type: String, reflect: true }) phase: ConnectionPhase = 'connecting';
  /** Optional extra context (e.g. "attempt 2 of 5"). */
  @property({ type: String }) detail = '';

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: inline-block;
        font-family: var(--arena-font-mono);
      }

      .status {
        --tone: var(--arena-text-faint);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border: 1px solid color-mix(in srgb, var(--tone) 32%, transparent);
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--tone) 8%, transparent);
        font-size: 10px;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .status.connecting {
        --tone: var(--arena-gold);
      }
      .status.connected {
        --tone: var(--arena-success);
      }
      .status.reconnecting {
        --tone: var(--arena-warning);
      }
      .status.closed {
        --tone: var(--arena-danger);
      }

      .dot {
        flex: 0 0 auto;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--tone);
      }

      .label {
        font-weight: 700;
        color: color-mix(in srgb, var(--tone) 55%, var(--arena-text-bright));
      }

      .detail {
        color: var(--arena-text-muted);
        font-size: 10px;
        text-transform: none;
        letter-spacing: 0.02em;
      }

      @media (prefers-reduced-motion: no-preference) {
        .status.connecting .dot,
        .status.reconnecting .dot {
          animation: arena-pulse 1.15s ease-in-out infinite;
        }
      }
      @keyframes arena-pulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(0.72);
          opacity: 0.55;
        }
      }
    `,
  ];

  protected override render() {
    return html`
      <div class="status ${this.phase}" role="status" aria-live="polite">
        <span class="dot" aria-hidden="true"></span>
        <span class="label">${LABELS[this.phase]}</span>
        ${this.detail ? html`<span class="detail">${this.detail}</span>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-connection-status': ArenaConnectionStatus;
  }
}
