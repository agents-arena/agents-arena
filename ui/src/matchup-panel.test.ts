import { describe, it, expect, afterEach } from 'vitest';
import { ArenaMatchupPanel } from './matchup-panel.js';
import type { MatchupPlayer } from './matchup-panel.js';
import type { ArenaAgentAvatar } from './agent-avatar.js';

function player(over: Partial<MatchupPlayer> = {}): MatchupPlayer {
  return {
    seat: 'white',
    name: 'Grok1',
    model: 'grok-4.5',
    status: 'connected',
    active: false,
    winner: false,
    ...over,
  };
}

async function mount(props: Partial<ArenaMatchupPanel>): Promise<ArenaMatchupPanel> {
  const el = document.createElement('arena-matchup-panel') as ArenaMatchupPanel;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-matchup-panel>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-matchup-panel')).toBe(ArenaMatchupPanel);
  });

  it('renders a card per player with name, model chip, and wood seat chips', async () => {
    const el = await mount({
      players: [
        player({ seat: 'black', name: 'Deepseek-Flash', model: 'deepseek-flash-2' }),
        player({ seat: 'white', name: 'Grok1', model: 'grok-4.5' }),
      ],
    });
    const root = el.shadowRoot!;
    expect(root.querySelectorAll('.card').length).toBe(2);
    expect(root.textContent).toContain('Deepseek-Flash');
    expect(root.textContent).toContain('Grok1');
    expect(root.querySelectorAll('.model')[0]?.textContent).toContain('deepseek-flash-2');
    expect(root.querySelector('.chip.wood-black')?.textContent?.trim()).toBe('black');
    expect(root.querySelector('.chip.wood-white')?.textContent?.trim()).toBe('white');
    expect(root.querySelector('.eyebrow')?.textContent).toContain('MATCHUP');
  });

  it('uses accent chips for X/O and shows the VS divider by default', async () => {
    const el = await mount({
      players: [player({ seat: 'X', name: 'Grok2' }), player({ seat: 'O', name: 'Deepseek' })],
    });
    const root = el.shadowRoot!;
    expect(root.querySelectorAll('.chip.accent').length).toBe(2);
    expect(root.querySelector('.vs')?.textContent).toContain('VS');
  });

  it('hides the VS divider when showVs is false', async () => {
    const el = await mount({
      players: [player(), player({ seat: 'black', name: 'B' })],
      showVs: false,
    });
    expect(el.shadowRoot!.querySelector('.vs')).toBeNull();
  });

  it('highlights the active player with THINKING dots and a thinking avatar', async () => {
    const el = await mount({ players: [player({ active: true })] });
    const root = el.shadowRoot!;
    const card = root.querySelector('.card');
    expect(card?.classList.contains('active')).toBe(true);
    expect(root.querySelector('.thinking')?.textContent).toContain('THINKING');
    expect(root.querySelectorAll('.thinking i').length).toBe(3);
    const avatar = root.querySelector('arena-agent-avatar') as ArenaAgentAvatar;
    expect(avatar.mood).toBe('thinking');
  });

  it('shows the WINNER badge and gold ring for the winner', async () => {
    const el = await mount({ players: [player({ winner: true })] });
    const root = el.shadowRoot!;
    expect(root.querySelector('.card')?.classList.contains('winner')).toBe(true);
    expect(root.querySelector('.badge-winner')?.textContent).toContain('WINNER');
    expect((root.querySelector('arena-agent-avatar') as ArenaAgentAvatar).mood).toBe('winner');
  });

  it('knocks out the avatar when the connection is lost', async () => {
    const el = await mount({ players: [player({ status: 'lost' })] });
    const root = el.shadowRoot!;
    expect(root.querySelector('.card')?.classList.contains('lost')).toBe(true);
    expect((root.querySelector('arena-agent-avatar') as ArenaAgentAvatar).mood).toBe('ko');
  });

  it('formats the clock as m:ss with its label', async () => {
    const el = await mount({
      players: [player({ clockMs: 83_450, clockLabel: 'TOTAL' })],
    });
    const root = el.shadowRoot!;
    expect(root.querySelector('.clock-time')?.textContent?.trim()).toBe('1:23');
    expect(root.querySelector('.clock-label')?.textContent).toContain('TOTAL');
  });

  it('hides the clock slot when clockMs is undefined', async () => {
    const el = await mount({ players: [player()] });
    expect(el.shadowRoot!.querySelector('.clock')).toBeNull();
  });

  it('goes gold when active and red/pulsing when active and low', async () => {
    const gold = await mount({ players: [player({ active: true, clockMs: 60_000 })] });
    expect(gold.shadowRoot!.querySelector('.clock-time')?.classList.contains('on')).toBe(true);

    const low = await mount({ players: [player({ active: true, clockMs: 5_000 })] });
    expect(low.shadowRoot!.querySelector('.clock-time')?.classList.contains('low')).toBe(true);

    const idle = await mount({ players: [player({ active: false, clockMs: 5_000 })] });
    const idleClock = idle.shadowRoot!.querySelector('.clock-time');
    expect(idleClock?.classList.contains('low')).toBe(false);
    expect(idleClock?.classList.contains('on')).toBe(false);
  });

  it('renders the open-seat variant for an empty seat', async () => {
    const el = await mount({
      players: [player({ seat: 'O', name: '', status: 'open', model: undefined })],
    });
    const root = el.shadowRoot!;
    expect(root.textContent).toContain('Open seat');
    expect(root.textContent).toContain('waiting for a challenger…');
    expect(root.querySelector('.pulse-dot')).not.toBeNull();
    expect(root.querySelector('.clock')).toBeNull();
  });

  it('honors a custom title', async () => {
    const el = await mount({ players: [player()], title: 'FIGHT CARD' });
    expect(el.shadowRoot!.querySelector('.eyebrow')?.textContent).toContain('FIGHT CARD');
  });
});
