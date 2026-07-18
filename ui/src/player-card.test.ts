import { describe, it, expect, afterEach } from 'vitest';
import { ArenaPlayerCard } from './player-card.js';

async function mount(props: Partial<ArenaPlayerCard>): Promise<ArenaPlayerCard> {
  const el = document.createElement('arena-player-card') as ArenaPlayerCard;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-player-card>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-player-card')).toBe(ArenaPlayerCard);
  });

  it('renders the name and seat', async () => {
    const el = await mount({ name: 'Ada', seat: 'P1' });
    const root = el.shadowRoot!;
    expect(root.textContent).toContain('Ada');
    expect(root.querySelector('.seat-chip')?.textContent).toContain('P1');
    // Avatar initial derived from the name.
    expect(root.querySelector('.avatar')?.textContent?.trim()).toBe('A');
  });

  it('highlights the active player and exposes aria-current', async () => {
    const el = await mount({ name: 'Ada', seat: 'X', active: true });
    const card = el.shadowRoot!.querySelector('.card');
    expect(card?.classList.contains('active')).toBe(true);
    expect(el.shadowRoot!.textContent).toContain('To move');
    expect(el.getAttribute('aria-current')).toBe('true');
  });

  it('reflects a disconnected player', async () => {
    const el = await mount({ name: 'Bo', seat: 'O', connected: false });
    const card = el.shadowRoot!.querySelector('.card');
    expect(card?.classList.contains('offline')).toBe(true);
    expect(el.shadowRoot!.querySelector('.sr-only')?.textContent).toBe('Disconnected');
    expect(el.getAttribute('aria-label')).toContain('disconnected');
  });

  it('marks the local player', async () => {
    const el = await mount({ name: 'Me', seat: 'P2', you: true });
    expect(el.shadowRoot!.querySelector('.you')?.textContent).toContain('You');
  });

  it('falls back to an empty-seat placeholder when unnamed', async () => {
    const el = await mount({ name: '', seat: 'P3' });
    expect(el.shadowRoot!.textContent).toContain('Empty seat');
    expect(el.shadowRoot!.querySelector('.avatar')?.textContent?.trim()).toBe('•');
  });
});
