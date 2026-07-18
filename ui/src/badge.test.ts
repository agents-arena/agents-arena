import { describe, it, expect, afterEach } from 'vitest';
import { ArenaBadge, type BadgeVariant } from './badge.js';

async function mount(
  variant: BadgeVariant | undefined,
  text: string,
): Promise<ArenaBadge> {
  const el = document.createElement('arena-badge') as ArenaBadge;
  if (variant) el.variant = variant;
  el.textContent = text;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-badge>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-badge')).toBe(ArenaBadge);
  });

  it('defaults to the neutral variant', async () => {
    const el = await mount(undefined, 'LIVE');
    expect(el.variant).toBe('neutral');
    expect(el.shadowRoot!.querySelector('.badge')?.classList.contains('neutral')).toBe(true);
  });

  it('projects slotted content', async () => {
    const el = await mount('accent', 'LIVE');
    // Slotted light-DOM content is included in the host's text content.
    expect(el.textContent).toContain('LIVE');
    const slot = el.shadowRoot!.querySelector('slot');
    expect(slot).not.toBeNull();
  });

  it('applies the requested variant class', async () => {
    for (const variant of ['accent', 'success', 'danger'] as const) {
      const el = await mount(variant, variant);
      expect(el.shadowRoot!.querySelector('.badge')?.classList.contains(variant)).toBe(true);
    }
  });
});
