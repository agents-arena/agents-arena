import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, arenaKeyframes, seatColorIndex } from './theme.js';
import './reasoning-badge.js';
import './method-chip.js';
import type { ReasoningMode } from './reasoning-badge.js';

// ---------------------------------------------------------------------------
// Local view types.
//
// @arena/ui stays decoupled from @arena/net/core: the app passes a plain,
// structurally-compatible object. These interfaces describe only the shape the
// panel needs to render — never import the engine's types here.
// ---------------------------------------------------------------------------

/** One move as shown in the report timeline. */
export interface ReportMoveView {
  /** 1-based ply index. */
  ply: number;
  /** Seat that made the move (colors the tag). */
  seat: string;
  /** The move payload — `{from,to}` renders as "e2 → e4", else compact JSON. */
  move: unknown;
  /** Wall-clock think time for this move, in milliseconds. */
  thinkMs: number;
  /** Optional agent telemetry captured with the move. */
  meta?: {
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    note?: string;
    /** Self-reported method of choosing this move. */
    method?: string;
    [k: string]: unknown;
  };
}

/** Per-seat aggregate row in the player summary. */
export interface ReportPlayerView {
  seat: string;
  name?: string;
  agent?: string;
  model?: string;
  moves: number;
  totalThinkMs: number;
  avgThinkMs: number;
  rejected: number;
  tokensIn?: number;
  tokensOut?: number;
  /**
   * Counts of self-reported methods across this player's moves
   * (e.g. `{ engine: 17, model: 1 }`).
   */
  methods?: Record<string, number>;
  /** Dominant / declared method when a full `methods` breakdown is absent. */
  method?: string;
}

/** Full post-game report payload. */
export interface MatchReportData {
  gameId: string;
  room: string;
  result: { kind: 'win'; winner: string } | { kind: 'draw' } | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  players: ReportPlayerView[];
  moves: ReportMoveView[];
  generatedAt: number;
  /** Declared room reasoning mode (`self` | `open`). */
  reasoning?: ReasoningMode;
}

/** `--seat` custom property wiring an element to its seat accent color. */
function seatVar(seat: string): string {
  return `--seat: var(--arena-seat-${seatColorIndex(seat)})`;
}

/** Physical WHITE/BLACK chips for chess seats; any other seat gets its accent hue. */
function seatChipClass(seat: string): string {
  const k = seat.trim().toLowerCase();
  if (k === 'white' || k === 'w') return 'chip white';
  if (k === 'black' || k === 'b') return 'chip black';
  return 'chip accent';
}

/** Format a whole-match duration: "12.4s" or "1m 03s". */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

/** Format a per-move think time compactly: "850ms", "1.2s", "1m 03s". */
function formatThink(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatDuration(ms);
}

/** Format an integer count with thousands separators. */
function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Token cell: "in / out", with "—" for any side that wasn't reported. */
function formatTokens(tin: number | undefined, tout: number | undefined): string {
  if (tin === undefined && tout === undefined) return '—';
  const a = tin === undefined ? '—' : formatInt(tin);
  const b = tout === undefined ? '—' : formatInt(tout);
  return `${a} / ${b}`;
}

/** Dominant method key from a counts map (highest count wins; ties keep first). */
function dominantMethod(
  methods: Record<string, number> | undefined,
  fallback?: string,
): string | null {
  if (methods) {
    let best: string | null = null;
    let bestCount = -1;
    for (const [k, n] of Object.entries(methods)) {
      if (n > bestCount) {
        best = k;
        bestCount = n;
      }
    }
    if (best !== null) return best;
  }
  return fallback?.trim() ? fallback : null;
}

/** "17× engine · 1× model" breakdown, sorted by count desc. */
function methodBreakdown(methods: Record<string, number> | undefined): string | null {
  if (!methods) return null;
  const entries = Object.entries(methods)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return null;
  return entries.map(([k, n]) => `${n}× ${k}`).join(' · ');
}

/** Render a move payload: "e2 → e4" for `{from,to}` shapes, else compact JSON. */
function moveText(move: unknown): string {
  if (move && typeof move === 'object' && !Array.isArray(move)) {
    const m = move as Record<string, unknown>;
    if (typeof m['from'] === 'string' && typeof m['to'] === 'string') {
      return `${m['from']} → ${m['to']}`;
    }
  }
  return JSON.stringify(move);
}

/** Cap on staggered timeline delays so long games don't animate forever. */
const MAX_STAGGER_STEPS = 14;

/**
 * Post-game match report on the dark "wood table" system: a big seat-colored
 * "<Winner> wins" headline with the reasoning badge and duration/moves meta,
 * a PLAYERS grid (WHITE/BLACK chips, method ×count chip, moves / avg think /
 * tokens / rejected), a staggered-rise TIMELINE ("e2 → e4" + think time), and
 * a one-click JSON export. Presentational only — pass a `report` object
 * (see {@link MatchReportData}); renders an empty note until set.
 */
@customElement('arena-match-report')
export class ArenaMatchReport extends LitElement {
  /** The report to render, or `null` for the empty state. */
  @property({ attribute: false }) report: MatchReportData | null = null;

  static override styles = [
    resetStyles,
    arenaTokens,
    arenaKeyframes,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
        color: var(--arena-text);
      }

      .report {
        display: flex;
        flex-direction: column;
        padding: clamp(16px, 3vw, 24px);
        border: 1px solid var(--arena-border);
        border-radius: 18px;
        background: var(--arena-surface);
      }

      /* Headline ---------------------------------------------------------- */
      .head {
        display: flex;
        flex-wrap: wrap;
        row-gap: 10px;
        align-items: center;
        gap: 12px;
        margin-bottom: 22px;
      }
      .outcome {
        margin: 0;
        font-size: clamp(24px, 5vw, 30px);
        font-weight: 900;
        line-height: 1;
        letter-spacing: -0.01em;
        color: var(--arena-text-strong);
      }
      .outcome .who {
        color: var(--seat, var(--arena-text-strong));
      }
      .meta {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 14px;
        font-family: var(--arena-font-mono);
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--arena-text-dim);
        white-space: nowrap;
      }
      .meta .moves {
        color: var(--arena-text-faint);
      }

      /* Section labels ------------------------------------------------------ */
      .label {
        margin: 0 0 10px;
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--arena-text-faint);
      }

      /* Seat chips ----------------------------------------------------------
       * Physical WHITE/BLACK for chess seats; solid seat accent otherwise.
       */
      .chip {
        flex: none;
        display: inline-flex;
        padding: 2px 7px;
        border: 1px solid transparent;
        border-radius: 5px;
        font-family: var(--arena-font-mono);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .chip.white {
        background: var(--arena-chip-white-bg);
        color: var(--arena-chip-white-ink);
      }
      .chip.black {
        background: var(--arena-chip-black-bg);
        color: var(--arena-chip-black-ink);
        border-color: var(--arena-border-strong);
      }
      .chip.accent {
        background: var(--seat, var(--arena-text-faint));
        color: #0e0d17;
      }

      /* Players grid --------------------------------------------------------- */
      .table-scroll {
        overflow-x: auto;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 12px;
        margin-bottom: 24px;
        scrollbar-width: thin;
      }
      .table-scroll:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .prow {
        display: grid;
        min-width: 680px;
        grid-template-columns: minmax(160px, 1fr) 150px 80px 100px 130px 90px;
        align-items: center;
        padding: 12px 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }
      .prow.head-row {
        padding: 10px 16px;
        border-top: none;
        background: rgba(255, 255, 255, 0.025);
        font-family: var(--arena-font-mono);
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--arena-text-faint);
      }
      .right {
        text-align: right;
      }
      .pwho {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
      }
      .pname {
        display: flex;
        flex-direction: column;
        line-height: 1.25;
        min-width: 0;
      }
      .pname .n {
        font-size: 13.5px;
        font-weight: 700;
        color: #f2ecdf;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pname .m {
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
        color: var(--arena-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .method-cell {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        min-width: 0;
      }
      .method-line {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .mcount {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        font-weight: 700;
        color: var(--arena-text-faint);
        white-space: nowrap;
      }
      .method-break {
        font-family: var(--arena-font-mono);
        font-size: 10px;
        color: var(--arena-text-faint);
        white-space: normal;
        max-width: 20ch;
      }
      .num {
        font-family: var(--arena-font-mono);
        font-size: 12.5px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: #d9d2c4;
        white-space: nowrap;
      }
      .num.muted {
        color: var(--arena-text-faint);
      }
      .num.ok {
        color: var(--arena-success-hi);
      }
      .num.bad {
        color: var(--arena-live-2);
        font-weight: 700;
      }

      /* Timeline ------------------------------------------------------------- */
      .timeline {
        list-style: none;
        margin: 0;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 12px;
        overflow: hidden;
        max-height: 480px;
        overflow-y: auto;
        scrollbar-width: thin;
      }
      .timeline:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .ply {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 11px;
        padding: 11px 16px;
      }
      .ply + .ply {
        border-top: 1px solid rgba(255, 255, 255, 0.045);
      }
      @media (prefers-reduced-motion: no-preference) {
        .ply {
          animation: aa-rise 0.4s ease both;
          animation-delay: var(--rise-delay, 0ms);
        }
      }
      .ply .pnum {
        min-width: 14px;
        font-family: var(--arena-font-mono);
        font-size: 11px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--arena-text-faint);
        text-align: right;
      }
      .ply .move {
        font-family: var(--arena-font-mono);
        font-size: 12.5px;
        font-weight: 600;
        color: #d9d2c4;
        word-break: break-word;
        min-width: 0;
      }
      .ply .think {
        margin-left: auto;
        font-family: var(--arena-font-mono);
        font-size: 11px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--arena-text-label);
        white-space: nowrap;
      }
      .ply .telemetry {
        flex-basis: 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        padding-left: 25px;
        font-family: var(--arena-font-mono);
        font-size: 10px;
        color: var(--arena-text-faint);
      }
      .ply .telemetry .note {
        font-family: var(--arena-font-sans);
        font-style: italic;
      }

      /* Actions ----------------------------------------------------------- */
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 18px;
      }
      .download {
        min-height: 40px;
        padding: 9px 16px;
        border: 1px solid var(--arena-border-strong);
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--arena-text);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 140ms ease;
      }
      .download:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .download:active {
        filter: brightness(0.96);
      }
      .download:focus-visible {
        outline: none;
        border-color: var(--arena-gold);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }

      .empty {
        margin: 0;
        padding: var(--arena-space-6) var(--arena-space-3);
        text-align: center;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
      }
    `,
  ];

  private _download(): void {
    const report = this.report;
    if (!report) return;
    // Guard for non-browser / SSR environments.
    if (
      typeof document === 'undefined' ||
      typeof Blob === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return;
    }
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `match-report-${report.room}.json`;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  private _renderOutcome(report: MatchReportData) {
    const result = report.result;
    if (result === null) {
      return html`<h2 class="outcome">No result</h2>`;
    }
    if (result.kind === 'draw') {
      return html`<h2 class="outcome">Draw</h2>`;
    }
    const winner = result.winner;
    const player = report.players.find((p) => p.seat === winner);
    const label = player?.name ?? winner;
    return html`<h2 class="outcome" style=${seatVar(winner)}>
      <span class="who">${label}</span>&nbsp;wins
    </h2>`;
  }

  private _hasAnyMethod(report: MatchReportData): boolean {
    return report.players.some((p) => dominantMethod(p.methods, p.method) !== null);
  }

  private _renderPlayers(report: MatchReportData) {
    const showMethod = this._hasAnyMethod(report);
    return html`
      <div class="table-scroll" role="region" aria-label="Player summary" tabindex="0">
        <div role="table" aria-label="Players">
          <div class="prow head-row" role="row">
            <span role="columnheader">Player</span>
            ${showMethod ? html`<span role="columnheader">Method</span>` : html`<span></span>`}
            <span role="columnheader" class="right">Moves</span>
            <span role="columnheader" class="right">Avg think</span>
            <span role="columnheader" class="right">Tokens in/out</span>
            <span role="columnheader" class="right">Rejected</span>
          </div>
          ${report.players.map((p) => this._playerRow(p, showMethod))}
        </div>
      </div>
    `;
  }

  private _playerRow(p: ReportPlayerView, showMethod: boolean) {
    const tokens = formatTokens(p.tokensIn, p.tokensOut);
    const dom = dominantMethod(p.methods, p.method);
    const domCount = dom && p.methods ? p.methods[dom] : undefined;
    const distinct = p.methods
      ? Object.entries(p.methods).filter(([, n]) => n > 0).length
      : 0;
    const breakdown = distinct > 1 ? methodBreakdown(p.methods) : null;
    return html`
      <div class="prow" role="row">
        <span class="pwho" role="cell">
          <span class="${seatChipClass(p.seat)}" style=${seatVar(p.seat)}>${p.seat}</span>
          <span class="pname">
            <span class="n">${p.name ?? p.agent ?? p.seat}</span>
            ${p.model ? html`<span class="m">${p.model}</span>` : nothing}
          </span>
        </span>
        ${showMethod
          ? html`<span class="method-cell" role="cell">
              ${dom
                ? html`<span class="method-line">
                    <arena-method-chip method=${dom}></arena-method-chip>
                    ${domCount !== undefined
                      ? html`<span class="mcount">×${formatInt(domCount)}</span>`
                      : nothing}
                  </span>`
                : nothing}
              ${dom && breakdown
                ? html`<span class="method-break">${breakdown}</span>`
                : nothing}
            </span>`
          : html`<span role="cell"></span>`}
        <span class="num right" role="cell">${formatInt(p.moves)}</span>
        <span class="num right" role="cell">${formatThink(p.avgThinkMs)}</span>
        <span class="num right ${tokens === '—' ? 'muted' : ''}" role="cell">${tokens}</span>
        <span class="num right ${p.rejected > 0 ? 'bad' : 'ok'}" role="cell"
          >${formatInt(p.rejected)}</span
        >
      </div>
    `;
  }

  private _renderTimeline(report: MatchReportData) {
    return html`
      <ol class="timeline" tabindex="0" aria-label="Move timeline">
        ${report.moves.map((m, i) => {
          const meta = m.meta;
          const hasTokens = meta?.tokensIn !== undefined || meta?.tokensOut !== undefined;
          const method =
            typeof meta?.method === 'string' && meta.method.trim() ? meta.method.trim() : null;
          const telemetry =
            meta && (meta.model || hasTokens || meta.note || method)
              ? html`<span class="telemetry">
                  ${method
                    ? html`<arena-method-chip method=${method}></arena-method-chip>`
                    : nothing}
                  ${meta.model ? html`<span class="model">${meta.model}</span>` : nothing}
                  ${hasTokens
                    ? html`<span class="tok"
                        >${formatTokens(meta.tokensIn, meta.tokensOut)} tok</span
                      >`
                    : nothing}
                  ${meta.note ? html`<span class="note">${meta.note}</span>` : nothing}
                </span>`
              : nothing;
          const delay = Math.min(i, MAX_STAGGER_STEPS) * 60;
          return html`<li
            class="ply"
            style=${`${seatVar(m.seat)}; --rise-delay: ${delay}ms`}
          >
            <span class="pnum">${m.ply}</span>
            <span class="${seatChipClass(m.seat)}" style=${seatVar(m.seat)}>${m.seat}</span>
            <span class="move">${moveText(m.move)}</span>
            <span class="think">${formatThink(m.thinkMs)}</span>
            ${telemetry}
          </li>`;
        })}
      </ol>
    `;
  }

  protected override render() {
    const report = this.report;
    if (!report) {
      return html`<p class="empty">No match report yet.</p>`;
    }
    const durationMs =
      report.durationMs ?? (report.endedAt !== null ? report.endedAt - report.startedAt : null);
    const reasoning =
      report.reasoning === 'self' || report.reasoning === 'open' ? report.reasoning : null;
    return html`
      <section class="report" aria-label="Match report">
        <header class="head">
          ${this._renderOutcome(report)}
          ${reasoning
            ? html`<arena-reasoning-badge mode=${reasoning}></arena-reasoning-badge>`
            : nothing}
          <span class="meta">
            <span class="duration">${durationMs !== null ? formatDuration(durationMs) : '—'}</span>
            <span class="moves">${report.moves.length} moves</span>
          </span>
        </header>

        <section aria-label="Player summary">
          <h3 class="label">Players</h3>
          ${this._renderPlayers(report)}
        </section>

        <section aria-label="Move timeline">
          <h3 class="label">Timeline</h3>
          ${this._renderTimeline(report)}
        </section>

        <div class="actions">
          <button class="download" type="button" @click=${this._download}>Download JSON</button>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'arena-match-report': ArenaMatchReport;
  }
}
