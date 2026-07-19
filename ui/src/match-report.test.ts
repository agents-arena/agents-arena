import { describe, it, expect, afterEach } from 'vitest';
import { ArenaMatchReport, type MatchReportData } from './match-report.js';
import './reasoning-badge.js';
import './method-chip.js';

function sampleReport(overrides: Partial<MatchReportData> = {}): MatchReportData {
  return {
    gameId: 'g-1',
    room: 'sunny-otter-42',
    result: { kind: 'win', winner: 'X' },
    startedAt: 1_000,
    endedAt: 13_400,
    durationMs: 12_400,
    players: [
      {
        seat: 'X',
        name: 'Ada',
        model: 'opus-4',
        moves: 5,
        totalThinkMs: 4250,
        avgThinkMs: 850,
        rejected: 0,
        tokensIn: 1200,
        tokensOut: 340,
      },
      {
        seat: 'O',
        name: 'Bo',
        moves: 4,
        totalThinkMs: 6000,
        avgThinkMs: 1500,
        rejected: 2,
      },
    ],
    moves: [
      { ply: 1, seat: 'X', move: { r: 0, c: 0 }, thinkMs: 800 },
      { ply: 2, seat: 'O', move: { r: 1, c: 1 }, thinkMs: 1500, meta: { model: 'sonnet', note: 'blocked' } },
      { ply: 3, seat: 'X', move: { r: 2, c: 2 }, thinkMs: 900, meta: { tokensIn: 300, tokensOut: 90 } },
    ],
    generatedAt: 20_000,
    ...overrides,
  };
}

async function mount(report: MatchReportData | null): Promise<ArenaMatchReport> {
  const el = document.createElement('arena-match-report') as ArenaMatchReport;
  el.report = report;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<arena-match-report>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-match-report')).toBe(ArenaMatchReport);
  });

  it('renders nothing meaningful (empty state) when report is null', async () => {
    const el = await mount(null);
    expect(el.shadowRoot!.querySelector('.report')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain('No match report yet');
  });

  it('renders the winner outcome and formatted duration', async () => {
    const el = await mount(sampleReport());
    const root = el.shadowRoot!;
    const outcome = root.querySelector('.outcome');
    expect(outcome?.textContent).toContain('Ada');
    expect(outcome?.textContent).toContain('wins');
    expect(root.querySelector('.duration')?.textContent?.trim()).toBe('12.4s');
  });

  it('renders a draw outcome', async () => {
    const el = await mount(sampleReport({ result: { kind: 'draw' } }));
    expect(el.shadowRoot!.querySelector('.outcome')?.textContent?.trim()).toBe('Draw');
  });

  it('renders one summary row per player with model and rejected count', async () => {
    const el = await mount(sampleReport());
    const root = el.shadowRoot!;
    const rows = root.querySelectorAll('.prow:not(.head-row)');
    expect(rows.length).toBe(2);
    expect(root.textContent).toContain('Ada');
    expect(root.textContent).toContain('opus-4');
    // Player Bo reported no tokens -> em dash cell present.
    expect(root.textContent).toContain('—');
    // Rejected: 0 is calm/green, >0 flags red.
    const rejected = root.querySelectorAll('.prow:not(.head-row) .num:last-of-type');
    expect(rejected[0]?.classList.contains('ok')).toBe(true);
    expect(rejected[1]?.classList.contains('bad')).toBe(true);
  });

  it('renders seat chips on player rows (accent class for non-chess seats)', async () => {
    const el = await mount(sampleReport());
    const chips = el.shadowRoot!.querySelectorAll('.prow:not(.head-row) .chip');
    expect(chips.length).toBe(2);
    expect(chips[0]!.classList.contains('accent')).toBe(true);
  });

  it('uses the physical WHITE/BLACK chip styling for chess seats', async () => {
    const el = await mount(
      sampleReport({
        result: { kind: 'win', winner: 'white' },
        players: [
          { seat: 'white', name: 'Ada', moves: 6, totalThinkMs: 0, avgThinkMs: 51_400, rejected: 0 },
          { seat: 'black', name: 'Bo', moves: 5, totalThinkMs: 0, avgThinkMs: 7_500, rejected: 0 },
        ],
        moves: [{ ply: 1, seat: 'white', move: { from: 'e2', to: 'e4' }, thinkMs: 160_000 }],
      }),
    );
    const chips = el.shadowRoot!.querySelectorAll('.prow:not(.head-row) .chip');
    expect(chips[0]!.classList.contains('white')).toBe(true);
    expect(chips[1]!.classList.contains('black')).toBe(true);
  });

  it('renders {from,to} moves as "from → to" in the timeline', async () => {
    const el = await mount(
      sampleReport({
        moves: [
          { ply: 1, seat: 'X', move: { from: 'e2', to: 'e4' }, thinkMs: 800 },
          { ply: 2, seat: 'O', move: { r: 1, c: 1 }, thinkMs: 900 },
        ],
      }),
    );
    const moves = el.shadowRoot!.querySelectorAll('.timeline .move');
    expect(moves[0]?.textContent).toBe('e2 → e4');
    expect(moves[1]?.textContent).toContain('"r":1');
  });

  it('renders one timeline entry per move with compact JSON', async () => {
    const el = await mount(sampleReport());
    const entries = el.shadowRoot!.querySelectorAll('.timeline .ply');
    expect(entries.length).toBe(3);
    const first = entries[0]!;
    expect(first.querySelector('.move')?.textContent).toContain('"r":0');
    // Telemetry note surfaces on the second move.
    expect(el.shadowRoot!.textContent).toContain('blocked');
  });

  it('staggers timeline rows via --rise-delay custom property', async () => {
    const el = await mount(sampleReport());
    const entries = el.shadowRoot!.querySelectorAll<HTMLElement>('.timeline .ply');
    expect(entries[0]!.getAttribute('style')).toContain('--rise-delay: 0ms');
    expect(entries[2]!.getAttribute('style')).toContain('--rise-delay: 120ms');
  });

  it('exposes a Download JSON button', async () => {
    const el = await mount(sampleReport());
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('button.download');
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim()).toBe('Download JSON');
  });

  it('renders a reasoning badge when reasoning is set', async () => {
    const el = await mount(sampleReport({ reasoning: 'self' }));
    const badge = el.shadowRoot!.querySelector('arena-reasoning-badge');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('mode')).toBe('self');
  });

  it('renders method chip with ×count and breakdown in player summary', async () => {
    const el = await mount(
      sampleReport({
        players: [
          {
            seat: 'X',
            name: 'Ada',
            model: 'opus-4',
            moves: 18,
            totalThinkMs: 9000,
            avgThinkMs: 500,
            rejected: 0,
            methods: { engine: 17, model: 1 },
          },
          {
            seat: 'O',
            name: 'Bo',
            moves: 17,
            totalThinkMs: 8000,
            avgThinkMs: 470,
            rejected: 0,
            method: 'model',
          },
        ],
      }),
    );
    const root = el.shadowRoot!;
    expect(root.querySelector('.prow.head-row')?.textContent).toContain('Method');
    const chips = root.querySelectorAll('.prow:not(.head-row) arena-method-chip');
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips[0]!.getAttribute('method')).toBe('engine');
    expect(chips[1]!.getAttribute('method')).toBe('model');
    // Dominant count rides on the chip; the multi-method breakdown stays visible.
    expect(root.querySelector('.mcount')?.textContent).toBe('×17');
    expect(root.textContent).toContain('17× engine');
    expect(root.textContent).toContain('1× model');
  });

  it('shows a single-method count without a redundant breakdown', async () => {
    const el = await mount(
      sampleReport({
        players: [
          {
            seat: 'X',
            name: 'Ada',
            moves: 6,
            totalThinkMs: 0,
            avgThinkMs: 500,
            rejected: 0,
            methods: { model: 6 },
          },
          { seat: 'O', name: 'Bo', moves: 5, totalThinkMs: 0, avgThinkMs: 470, rejected: 0 },
        ],
      }),
    );
    const root = el.shadowRoot!;
    expect(root.querySelector('.mcount')?.textContent).toBe('×6');
    expect(root.querySelector('.method-break')).toBeNull();
  });

  it('renders a per-move method chip when meta.method is set', async () => {
    const el = await mount(
      sampleReport({
        moves: [
          { ply: 1, seat: 'X', move: { r: 0, c: 0 }, thinkMs: 800, meta: { method: 'engine' } },
          { ply: 2, seat: 'O', move: { r: 1, c: 1 }, thinkMs: 900 },
        ],
      }),
    );
    const chips = el.shadowRoot!.querySelectorAll('.timeline arena-method-chip');
    expect(chips.length).toBe(1);
    expect(chips[0]!.getAttribute('method')).toBe('engine');
  });
});
