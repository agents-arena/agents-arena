import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { arenaTokens, resetStyles, seatColorIndex } from './theme.js';
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
  /** The move payload — rendered as compact JSON. */
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
function dominantMethod(methods: Record<string, number> | undefined, fallback?: string): string | null {
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

/**
 * Post-game match report: outcome headline, a per-player summary, a scrollable
 * move timeline, and a one-click JSON export. Presentational only — pass a
 * `report` object (see {@link MatchReportData}); renders nothing until set.
 */
@customElement('arena-match-report')
export class ArenaMatchReport extends LitElement {
  /** The report to render, or `null` for the empty state. */
  @property({ attribute: false }) report: MatchReportData | null = null;

  static override styles = [
    resetStyles,
    arenaTokens,
    css`
      :host {
        display: block;
        font-family: var(--arena-font-sans);
        color: var(--arena-text);
      }

      .report {
        display: flex;
        flex-direction: column;
        gap: var(--arena-space-4);
        padding: var(--arena-space-4);
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-lg);
        background: var(--arena-surface);
        box-shadow: var(--arena-shadow-1);
      }

      /* Headline ---------------------------------------------------------- */
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--arena-space-3);
      }
      .head-left {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-2);
      }
      .outcome {
        display: flex;
        align-items: center;
        gap: var(--arena-space-2);
        margin: 0;
        font-size: var(--arena-text-xl);
        font-weight: 800;
        letter-spacing: -0.01em;
      }
      .outcome .who {
        color: color-mix(in srgb, var(--seat) 78%, var(--arena-text));
      }
      .outcome.draw {
        color: var(--arena-text-muted);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-1) var(--arena-space-3);
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
      }
      .meta .duration {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        color: var(--arena-text);
      }

      /* Section titles ---------------------------------------------------- */
      .title {
        margin: 0 0 var(--arena-space-2);
        font-size: var(--arena-text-sm);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--arena-text-muted);
      }

      /* Seat chip --------------------------------------------------------- */
      .seat {
        display: inline-block;
        padding: 1px 7px;
        border-radius: var(--arena-radius-sm);
        background: color-mix(in srgb, var(--seat) 16%, transparent);
        color: color-mix(in srgb, var(--seat) 74%, var(--arena-text));
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        font-size: var(--arena-text-xs);
        white-space: nowrap;
      }

      /* Player summary ---------------------------------------------------- */
      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface-2);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--arena-text-sm);
      }
      thead th {
        position: sticky;
        top: 0;
        padding: var(--arena-space-2) var(--arena-space-3);
        text-align: right;
        font-size: var(--arena-text-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--arena-text-faint);
        background: var(--arena-surface-2);
        border-bottom: 1px solid var(--arena-border);
        white-space: nowrap;
      }
      thead th.player,
      tbody td.player,
      thead th.method,
      tbody td.method {
        text-align: left;
      }
      tbody td {
        padding: var(--arena-space-2) var(--arena-space-3);
        text-align: right;
        vertical-align: middle;
        border-top: 1px solid var(--arena-border);
        font-variant-numeric: tabular-nums;
        font-family: var(--arena-font-mono);
        color: var(--arena-text);
        white-space: nowrap;
      }
      tbody tr:first-child td {
        border-top: none;
      }
      td.player,
      td.method {
        font-family: var(--arena-font-sans);
      }
      .who-cell {
        display: flex;
        align-items: center;
        gap: var(--arena-space-2);
      }
      .who-name {
        display: flex;
        flex-direction: column;
        line-height: 1.25;
        min-width: 0;
      }
      .who-name .n {
        font-weight: 600;
      }
      .who-name .m {
        font-size: var(--arena-text-xs);
        color: var(--arena-text-muted);
        font-family: var(--arena-font-mono);
      }
      .method-cell {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
      }
      .method-break {
        font-size: var(--arena-text-xs);
        color: var(--arena-text-faint);
        font-family: var(--arena-font-mono);
        white-space: normal;
        max-width: 18ch;
      }
      td.rejected.has {
        color: var(--arena-danger);
        font-weight: 700;
      }
      td.muted {
        color: var(--arena-text-faint);
      }

      /* Move timeline ----------------------------------------------------- */
      .timeline {
        list-style: none;
        margin: 0;
        padding: var(--arena-space-1);
        max-height: 320px;
        overflow-y: auto;
        border: 1px solid var(--arena-border);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface-inset);
        scrollbar-width: thin;
      }
      .timeline:focus-visible {
        outline: none;
        border-color: var(--arena-brand);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }
      .ply {
        display: grid;
        grid-template-columns: auto auto 1fr auto;
        align-items: baseline;
        gap: var(--arena-space-2);
        padding: 6px var(--arena-space-2);
        border-radius: var(--arena-radius-sm);
      }
      .ply + .ply {
        border-top: 1px solid var(--arena-border);
      }
      .ply .num {
        color: var(--arena-text-faint);
        font-family: var(--arena-font-mono);
        font-variant-numeric: tabular-nums;
        font-size: var(--arena-text-xs);
        text-align: right;
        min-width: 3ch;
      }
      .ply .move {
        color: var(--arena-text);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-sm);
        word-break: break-word;
      }
      .ply .think {
        justify-self: end;
        color: var(--arena-text-muted);
        font-family: var(--arena-font-mono);
        font-variant-numeric: tabular-nums;
        font-size: var(--arena-text-xs);
        white-space: nowrap;
      }
      .ply .telemetry {
        grid-column: 3 / -1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--arena-space-1) var(--arena-space-3);
        margin-top: 2px;
        color: var(--arena-text-faint);
        font-family: var(--arena-font-mono);
        font-size: var(--arena-text-xs);
      }
      .ply .telemetry .note {
        font-family: var(--arena-font-sans);
        font-style: italic;
      }

      /* Actions ----------------------------------------------------------- */
      .actions {
        display: flex;
        justify-content: flex-end;
      }
      .download {
        min-height: 40px;
        padding: 0 var(--arena-space-4);
        border: 1px solid var(--arena-border-strong);
        border-radius: var(--arena-radius-md);
        background: var(--arena-surface-2);
        color: var(--arena-text);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        transition:
          filter 140ms ease,
          border-color 140ms ease;
      }
      .download:hover {
        filter: brightness(1.04);
        border-color: var(--arena-brand);
      }
      .download:active {
        filter: brightness(0.96);
      }
      .download:focus-visible {
        outline: none;
        border-color: var(--arena-brand);
        box-shadow: 0 0 0 3px var(--arena-ring);
      }

      .empty {
        margin: 0;
        padding: var(--arena-space-6) var(--arena-space-3);
        text-align: center;
        color: var(--arena-text-muted);
        font-size: var(--arena-text-sm);
      }

      @media (max-width: 480px) {
        .report {
          padding: var(--arena-space-3);
        }
        .outcome {
          font-size: var(--arena-text-lg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .download {
          transition: none;
        }
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
      return html`<h2 class="outcome draw">No result</h2>`;
    }
    if (result.kind === 'draw') {
      return html`<h2 class="outcome draw">Draw</h2>`;
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
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="player" scope="col">Player</th>
              ${showMethod ? html`<th class="method" scope="col">Method</th>` : nothing}
              <th scope="col">Moves</th>
              <th scope="col">Avg think</th>
              <th scope="col">Tokens (in/out)</th>
              <th scope="col">Rejected</th>
            </tr>
          </thead>
          <tbody>
            ${report.players.map((p) => {
              const tokens = formatTokens(p.tokensIn, p.tokensOut);
              const dom = dominantMethod(p.methods, p.method);
              const breakdown = methodBreakdown(p.methods);
              return html`<tr>
                <td class="player">
                  <div class="who-cell">
                    <span class="seat" style=${seatVar(p.seat)}>${p.seat}</span>
                    <span class="who-name">
                      <span class="n">${p.name ?? p.agent ?? p.seat}</span>
                      ${p.model ? html`<span class="m">${p.model}</span>` : nothing}
                    </span>
                  </div>
                </td>
                ${showMethod
                  ? html`<td class="method">
                      ${dom
                        ? html`<div class="method-cell">
                            <arena-method-chip method=${dom}></arena-method-chip>
                            ${breakdown
                              ? html`<span class="method-break">${breakdown}</span>`
                              : nothing}
                          </div>`
                        : nothing}
                    </td>`
                  : nothing}
                <td>${formatInt(p.moves)}</td>
                <td>${formatThink(p.avgThinkMs)}</td>
                <td class=${tokens === '—' ? 'muted' : ''}>${tokens}</td>
                <td class="rejected ${p.rejected > 0 ? 'has' : ''}">${formatInt(p.rejected)}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  private _renderTimeline(report: MatchReportData) {
    return html`
      <ol class="timeline" tabindex="0" aria-label="Move timeline">
        ${report.moves.map((m) => {
          const meta = m.meta;
          const hasTokens = meta?.tokensIn !== undefined || meta?.tokensOut !== undefined;
          const method =
            typeof meta?.method === 'string' && meta.method.trim()
              ? meta.method.trim()
              : null;
          const telemetry =
            meta && (meta.model || hasTokens || meta.note || method)
              ? html`<div class="telemetry">
                  ${method
                    ? html`<arena-method-chip method=${method}></arena-method-chip>`
                    : nothing}
                  ${meta.model ? html`<span class="model">${meta.model}</span>` : nothing}
                  ${hasTokens
                    ? html`<span class="tok">${formatTokens(meta.tokensIn, meta.tokensOut)} tok</span>`
                    : nothing}
                  ${meta.note ? html`<span class="note">${meta.note}</span>` : nothing}
                </div>`
              : nothing;
          return html`<li class="ply" style=${seatVar(m.seat)}>
            <span class="num">${m.ply}</span>
            <span class="seat" style=${seatVar(m.seat)}>${m.seat}</span>
            <span class="move">${JSON.stringify(m.move)}</span>
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
          <div class="head-left">
            ${this._renderOutcome(report)}
            ${reasoning
              ? html`<arena-reasoning-badge mode=${reasoning}></arena-reasoning-badge>`
              : nothing}
          </div>
          <div class="meta">
            <span class="duration"
              >${durationMs !== null ? formatDuration(durationMs) : '—'}</span
            >
            <span>${report.moves.length} moves</span>
          </div>
        </header>

        <section aria-label="Player summary">
          <h3 class="title">Players</h3>
          ${this._renderPlayers(report)}
        </section>

        <section aria-label="Move timeline">
          <h3 class="title">Timeline</h3>
          ${this._renderTimeline(report)}
        </section>

        <div class="actions">
          <button class="download" type="button" @click=${this._download}>
            Download JSON
          </button>
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
