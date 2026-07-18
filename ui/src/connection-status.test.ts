import { describe, it, expect, afterEach } from 'vitest';
import { ArenaConnectionStatus, type ConnectionPhase } from './connection-status.js';

async function mount(props: Partial<ArenaConnectionStatus>): Promise<ArenaConnectionStatus> {
  const el = document.createElement('arena-connection-status') as ArenaConnectionStatus;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-connection-status>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-connection-status')).toBe(ArenaConnectionStatus);
  });

  it('renders a status role with a polite live region', async () => {
    const el = await mount({ phase: 'connected' });
    const status = el.shadowRoot!.querySelector('.status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
  });

  const cases: Array<[ConnectionPhase, string]> = [
    ['connecting', 'Connecting…'],
    ['connected', 'Connected'],
    ['reconnecting', 'Reconnecting…'],
    ['closed', 'Disconnected'],
  ];

  for (const [phase, label] of cases) {
    it(`labels and classes the "${phase}" phase`, async () => {
      const el = await mount({ phase });
      const status = el.shadowRoot!.querySelector('.status');
      expect(status?.classList.contains(phase)).toBe(true);
      expect(el.shadowRoot!.querySelector('.label')?.textContent).toBe(label);
    });
  }

  it('renders optional detail text', async () => {
    const el = await mount({ phase: 'reconnecting', detail: 'attempt 2 of 5' });
    expect(el.shadowRoot!.querySelector('.detail')?.textContent).toBe('attempt 2 of 5');
  });

  it('omits the detail element when detail is empty', async () => {
    const el = await mount({ phase: 'connected' });
    expect(el.shadowRoot!.querySelector('.detail')).toBeNull();
  });
});
