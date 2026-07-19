import { describe, it, expect, afterEach } from 'vitest';
import { ArenaCommentaryFeed } from './commentary-feed.js';
import type { FeedItem } from './commentary-feed.js';
import type { ArenaAgentAvatar } from './agent-avatar.js';

async function mount(props: Partial<ArenaCommentaryFeed>): Promise<ArenaCommentaryFeed> {
  const el = document.createElement('arena-commentary-feed') as ArenaCommentaryFeed;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-commentary-feed>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-commentary-feed')).toBe(ArenaCommentaryFeed);
  });

  it('shows the empty state and a zero event count when there are no items', async () => {
    const el = await mount({});
    const root = el.shadowRoot!;
    expect(root.querySelector('.empty')?.textContent).toContain(
      'Waiting for the first move — agents talk trash here.',
    );
    expect(root.querySelector('.count')?.textContent).toContain('0 events');
    expect(root.querySelector('.eyebrow')?.textContent).toContain('COMMENTARY');
  });

  it('renders a move item with a seat tile, SAN, and think label', async () => {
    const items: FeedItem[] = [
      { kind: 'move', seat: 'white', san: 'e4', thinkLabel: 'thought 2.6s' },
      { kind: 'move', seat: 'black', san: 'c5' },
    ];
    const el = await mount({ items });
    const root = el.shadowRoot!;
    const moves = root.querySelectorAll('.move');
    expect(moves.length).toBe(2);
    expect(moves[0]?.querySelector('.dot')?.classList.contains('cream')).toBe(true);
    expect(moves[0]?.querySelector('.san')?.textContent).toBe('e4');
    expect(moves[0]?.querySelector('.think')?.textContent).toContain('thought 2.6s');
    expect(moves[1]?.querySelector('.dot')?.classList.contains('dark')).toBe(true);
    expect(moves[1]?.querySelector('.think')).toBeNull();
    expect(root.querySelector('.count')?.textContent).toContain('2 events');
  });

  it('renders a say item with avatar, tinted name, seat chip, and speech bubble', async () => {
    const items: FeedItem[] = [
      { kind: 'say', seat: 'black', name: 'Deepseek-Flash', text: 'Sicilian. Bold.' },
    ];
    const el = await mount({ items });
    const root = el.shadowRoot!;
    const say = root.querySelector('.say')!;
    const avatar = say.querySelector('arena-agent-avatar') as ArenaAgentAvatar;
    expect(avatar.size).toBe(26);
    expect(avatar.seat).toBe('black');
    expect(say.querySelector('.who-name')?.textContent).toBe('Deepseek-Flash');
    expect(say.querySelector('.who-name')?.classList.contains('tinted')).toBe(true);
    expect(say.querySelector('.chip.wood-black')?.textContent?.trim()).toBe('black');
    expect(say.querySelector('.bubble')?.textContent).toBe('Sicilian. Bold.');
  });

  it('omits the seat chip and tint when a say item has no seat', async () => {
    const el = await mount({
      items: [{ kind: 'say', name: 'Referee', text: 'Match started.' }],
    });
    const say = el.shadowRoot!.querySelector('.say')!;
    expect(say.querySelector('.chip')).toBeNull();
    expect(say.querySelector('.who-name')?.classList.contains('tinted')).toBe(false);
  });

  it('keeps items chronological in the DOM inside a column-reverse list', async () => {
    const items: FeedItem[] = [
      { kind: 'move', seat: 'white', san: 'e4' },
      { kind: 'say', seat: 'black', name: 'Deepseek-Flash', text: 'Hm.' },
      { kind: 'move', seat: 'black', san: 'c5' },
    ];
    const el = await mount({ items });
    const list = el.shadowRoot!.querySelector('.list')!;
    const rendered = [...list.querySelectorAll('.item')].map(
      (n) => n.querySelector('.san')?.textContent ?? n.querySelector('.bubble')?.textContent,
    );
    expect(rendered).toEqual(['e4', 'Hm.', 'c5']);
  });

  it('honors a custom title and empty label', async () => {
    const el = await mount({ title: 'TABLE TALK', emptyLabel: 'Silence so far.' });
    const root = el.shadowRoot!;
    expect(root.querySelector('.eyebrow')?.textContent).toContain('TABLE TALK');
    expect(root.querySelector('.empty')?.textContent).toContain('Silence so far.');
  });
});
