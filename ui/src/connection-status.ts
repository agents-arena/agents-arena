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
        font-family: var(--arena-font-sans);
      }

      .status {
        --tone: var(--arena-text-faint);
        display: inline-flex;
        align-items: center;
        gap: var(--arena-space-2);
        padding: 5px var(--arena-space-3);
        border: 1px solid color-mix(in srgb, var(--tone) 30%, var(--arena-border));
        border-radius: var(--arena-radius-pill);
        background: color-mix(in srgb, var(--tone) 10%, var(--arena-surface));
        font-size: var(--arena-text-sm);
        line-height: 1.2;
      }
      .status.connecting {
        --tone: var(--arena-brand);
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
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--tone);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 22%, transparent);
      }

      .label {
        font-weight: 600;
        color: var(--arena-text);
      }

      .detail {
        color: var(--arena-text-muted);
        font-size: var(--arena-text-xs);
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
