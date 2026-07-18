import { describe, it, expect, afterEach } from 'vitest';
import { ArenaAgentFace, type FaceEmotion } from './agent-face.js';

async function mount(props: Partial<Pick<ArenaAgentFace, 'emotion' | 'seat' | 'label' | 'note' | 'size'>> = {}): Promise<ArenaAgentFace> {
  const el = document.createElement('arena-agent-face') as ArenaAgentFace;
  if (props.emotion) el.emotion = props.emotion;
  if (props.seat) el.seat = props.seat;
  if (props.label) el.label = props.label;
  if (props.note) el.note = props.note;
  if (props.size) el.size = props.size;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const svg = (el: ArenaAgentFace): SVGSVGElement | null =>
  el.shadowRoot!.querySelector('svg');

afterEach(() => {
  document.body.innerHTML = '';
});

const ALL_EMOTIONS: FaceEmotion[] = [
  'neutral',
  'thinking',
  'happy',
  'confident',
  'smug',
  'nervous',
  'worried',
  'surprised',
  'shocked',
  'sad',
  'crying',
  'angry',
  'celebrating',
  'defeated',
  'mischievous',
  'sweating',
];

describe('<arena-agent-face>', () => {
  it('registers the custom element', () => {
    expect(customElements.get('arena-agent-face')).toBe(ArenaAgentFace);
  });

  it('defaults to the neutral emotion', async () => {
    const el = await mount();
    expect(el.emotion).toBe('neutral');
  });

  it('renders an <svg> face with role="img"', async () => {
    const el = await mount({ emotion: 'happy' });
    const face = svg(el);
    expect(face).not.toBeNull();
    expect(face!.getAttribute('role')).toBe('img');
  });

  it('reflects the emotion onto the svg via data-emotion', async () => {
    const el = await mount({ emotion: 'smug' });
    expect(svg(el)!.getAttribute('data-emotion')).toBe('smug');
  });

  it('builds an aria-label from label + emotion', async () => {
    const el = await mount({ emotion: 'angry', label: 'Claude' });
    expect(svg(el)!.getAttribute('aria-label')).toBe('Claude: angry');
  });

  it('updates the aria-label when the emotion changes', async () => {
    const el = await mount({ emotion: 'happy', label: 'GPT' });
    expect(svg(el)!.getAttribute('aria-label')).toBe('GPT: happy');
    el.emotion = 'defeated';
    await el.updateComplete;
    expect(svg(el)!.getAttribute('aria-label')).toBe('GPT: defeated');
    expect(svg(el)!.getAttribute('data-emotion')).toBe('defeated');
  });

  it('falls back to just the emotion when there is no label', async () => {
    const el = await mount({ emotion: 'crying' });
    expect(svg(el)!.getAttribute('aria-label')).toBe('crying');
  });

  it('renders a speech bubble only when a note is set', async () => {
    const bare = await mount({ emotion: 'smug' });
    expect(bare.shadowRoot!.querySelector('.bubble')).toBeNull();

    const withNote = await mount({ emotion: 'smug', note: 'Too easy.' });
    const bubble = withNote.shadowRoot!.querySelector('.bubble');
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain('Too easy.');
  });

  it('treats a whitespace-only note as empty', async () => {
    const el = await mount({ emotion: 'neutral', note: '   ' });
    expect(el.shadowRoot!.querySelector('.bubble')).toBeNull();
  });

  it('shows the label with its emotion sublabel when a label is set', async () => {
    const el = await mount({ emotion: 'nervous', label: 'Bot 7' });
    const label = el.shadowRoot!.querySelector('.label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain('Bot 7');
    expect(label!.textContent).toContain('nervous');
  });

  it('applies the requested size to the stage', async () => {
    const el = await mount({ emotion: 'neutral', size: 200 });
    const stage = el.shadowRoot!.querySelector('.stage') as HTMLElement;
    expect(stage.getAttribute('style')).toContain('200px');
  });

  it('tints with a seat accent color', async () => {
    const el = await mount({ emotion: 'happy', seat: 'P3' });
    const stage = el.shadowRoot!.querySelector('.stage') as HTMLElement;
    expect(stage.getAttribute('style')).toMatch(/--arena-seat-\d/);
  });

  it('renders every emotion without throwing and keeps the svg present', async () => {
    for (const emotion of ALL_EMOTIONS) {
      const el = await mount({ emotion, label: 'A', seat: 'X' });
      const face = svg(el);
      expect(face).not.toBeNull();
      expect(face!.getAttribute('data-emotion')).toBe(emotion);
      // A mouth path/shape exists for the current emotion set.
      expect(face!.querySelectorAll('.mouth').length).toBeGreaterThan(0);
      document.body.innerHTML = '';
    }
  });

  it('always renders the antenna and both eyes in the base markup', async () => {
    const el = await mount({ emotion: 'thinking' });
    const face = svg(el)!;
    expect(face.querySelector('.antenna')).not.toBeNull();
    expect(face.querySelectorAll('.eye').length).toBe(2);
  });
});
