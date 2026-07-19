import { describe, it, expect, afterEach, vi } from 'vitest';
import { ArenaArchiveCard, type MatchSummary } from './archive-card.js';

function sampleSummary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    room: 'nsafwx',
    game: 'chess',
    winner: 'white',
    players: [
      { seat: 'white', name: 'Ada', model: 'opus-4', moves: 6, avgThinkMs: 51_400 },
      { seat: 'black', name: 'Bo', moves: 5, avgThinkMs: 7_500 },
    ],
    reasoning: 'self',
    durationMs: 346_000,
    moveCount: 11,
    commentCount: 0,
    endedAt: Date.now() - 12 * 60_000,
    ...overrides,
  };
}

async function mount(
  summary: MatchSummary | null,
  live = false,
): Promise<ArenaArchiveCard> {
  const el = document.createElement('arena-archive-card') as ArenaArchiveCard;
  el.summary = summary;
  el.live = live;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-archive-card>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-archive-card')).toBe(ArenaArchiveCard);
  });

  it('renders an empty note without a summary', async () => {
    const el = await mount(null);
    expect(el.shadowRoot!.querySelector('button.card')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain('No match summary');
  });

  it('is a button and dispatches select with the room on click', async () => {
    const el = await mount(sampleSummary());
    const onSelect = vi.fn();
    el.addEventListener('select', onSelect);
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('button.card')!;
    expect(btn.getAttribute('aria-label')).toContain('nsafwx');
    btn.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0]![0] as CustomEvent).detail).toEqual({ room: 'nsafwx' });
  });

  it('shows the winner headline in the seat accent, or Draw', async () => {
    const el = await mount(sampleSummary());
    expect(el.shadowRoot!.querySelector('.headline')?.textContent).toContain('Ada');
    expect(el.shadowRoot!.querySelector('.headline')?.textContent).toContain('wins');

    const draw = await mount(sampleSummary({ winner: null }));
    expect(draw.shadowRoot!.querySelector('.headline')?.textContent?.trim()).toBe('Draw');
  });

  it('renders a player row with chip, avatar, name and per-player stats', async () => {
    const el = await mount(sampleSummary());
    const rows = el.shadowRoot!.querySelectorAll('.player');
    expect(rows.length).toBe(2);
    const first = rows[0]!;
    expect(first.querySelector('.chip.white')).not.toBeNull();
    expect(first.querySelector('arena-agent-avatar')).not.toBeNull();
    expect(first.querySelector('.pname')?.textContent).toBe('Ada');
    expect(first.querySelector('.pstat')?.textContent).toBe('6 moves · 51.4s avg');
    expect(rows[1]!.querySelector('.chip.black')).not.toBeNull();
  });

  it('renders the stats footer with duration, moves, comments and relative end', async () => {
    const el = await mount(sampleSummary());
    const stats = el.shadowRoot!.querySelector('.stats')!;
    expect(stats.textContent).toContain('5m 46s');
    expect(stats.textContent).toContain('11 moves');
    expect(stats.textContent).toContain('0 comments');
    expect(stats.querySelector('.rel')?.textContent).toContain('ended 12m ago');
  });

  it('shows the reasoning badge for archived matches and a LIVE badge when live', async () => {
    const archived = await mount(sampleSummary());
    expect(archived.shadowRoot!.querySelector('arena-reasoning-badge')).not.toBeNull();
    expect(archived.shadowRoot!.querySelector('.live-badge')).toBeNull();
    expect(archived.shadowRoot!.querySelector('.card.live')).toBeNull();

    const live = await mount(sampleSummary(), true);
    expect(live.shadowRoot!.querySelector('.card.live')).not.toBeNull();
    expect(live.shadowRoot!.querySelector('.live-badge')?.textContent).toContain('LIVE');
    // LIVE replaces the reasoning badge in the header slot.
    expect(live.shadowRoot!.querySelector('arena-reasoning-badge')).toBeNull();
  });

  it('uses accent chips for non-chess seats (X / O)', async () => {
    const el = await mount(
      sampleSummary({
        game: 'tic-tac-toe',
        winner: null,
        players: [
          { seat: 'X', name: 'Grok2' },
          { seat: 'O', name: 'Deepseek-Flash' },
        ],
      }),
    );
    const chips = el.shadowRoot!.querySelectorAll('.chip.accent');
    expect(chips.length).toBe(2);
  });
});
