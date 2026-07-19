import { describe, it, expect, afterEach } from 'vitest';
import { ArenaLeaderboardTable, type LeaderRow } from './leaderboard-table.js';

function rows(): LeaderRow[] {
  return [
    {
      rank: 1,
      name: 'Grok1',
      model: 'grok-1',
      games: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      winPct: 1,
      avgThink: 51_400,
      topMethod: 'model',
    },
    {
      rank: 2,
      name: 'Deepseek-Flash',
      model: 'deepseek-v3',
      games: 2,
      wins: 1,
      losses: 1,
      draws: 0,
      winPct: 50,
      avgThink: 12_300,
    },
  ];
}

async function mount(data: LeaderRow[]): Promise<ArenaLeaderboardTable> {
  const el = document.createElement('arena-leaderboard-table') as ArenaLeaderboardTable;
  el.rows = data;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-leaderboard-table>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-leaderboard-table')).toBe(ArenaLeaderboardTable);
  });

  it('renders an empty note without rows', async () => {
    const el = await mount([]);
    expect(el.shadowRoot!.textContent).toContain('No standings yet');
  });

  it('renders one grid row per competitor with table semantics', async () => {
    const el = await mount(rows());
    const root = el.shadowRoot!;
    expect(root.querySelector('[role="table"]')).not.toBeNull();
    expect(root.querySelectorAll('[role="row"].row').length).toBe(2);
    expect(root.querySelectorAll('[role="columnheader"]').length).toBe(7);
  });

  it('marks rank 1 with the gold wash class and renders avatars', async () => {
    const el = await mount(rows());
    const first = el.shadowRoot!.querySelector('[role="row"].row')!;
    expect(first.classList.contains('first')).toBe(true);
    expect(first.querySelector('arena-agent-avatar')).not.toBeNull();
    const second = el.shadowRoot!.querySelectorAll('[role="row"].row')[1]!;
    expect(second.classList.contains('first')).toBe(false);
  });

  it('renders the W-L-D triple with distinct color spans', async () => {
    const el = await mount(rows());
    const wld = el.shadowRoot!.querySelector('.row .wld')!;
    expect(wld.querySelector('.w')?.textContent).toBe('1');
    expect(wld.querySelector('.l')?.textContent).toBe('0');
    expect(wld.querySelector('.d')?.textContent).toBe('0');
  });

  it('normalises win% fractions and percentages onto the bar + label', async () => {
    const el = await mount(rows());
    const fills = el.shadowRoot!.querySelectorAll<HTMLElement>('.fill');
    expect(fills[0]!.getAttribute('style')).toContain('width:100%');
    expect(fills[1]!.getAttribute('style')).toContain('width:50%');
    const nums = el.shadowRoot!.querySelectorAll('.pct-num');
    expect(nums[0]!.textContent).toBe('100.0%');
    expect(nums[1]!.textContent).toBe('50.0%');
  });

  it('formats avg think and renders the top-method chip only when present', async () => {
    const el = await mount(rows());
    const root = el.shadowRoot!;
    const thinks = root.querySelectorAll('.row .think');
    expect(thinks[0]!.textContent).toBe('51.4s');
    expect(thinks[1]!.textContent).toBe('12.3s');
    const chips = root.querySelectorAll('arena-method-chip');
    expect(chips.length).toBe(1);
    expect(chips[0]!.getAttribute('method')).toBe('model');
  });
});
