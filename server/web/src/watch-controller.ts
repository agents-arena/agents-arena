// Owns the EventSource connection to a room's SSE stream and reduces its named
// events (`snapshot` / `emote` / `report` / `comment` / `joinRequest`) into a
// single immutable view object. The watch page renders straight from that view;
// it never touches EventSource.

import type { ConnectionPhase } from '@agents-arena/ui';
import type { ArenaEvent, Comment, Emote, JoinRequestInfo, MatchReport, Snapshot } from './types.js';
import { eventsUrl } from './server.js';

/** High-level lifecycle of the watch view. */
export type WatchPhase = 'connecting' | 'watching' | 'error';

/** Everything the watch page needs, recomputed on every stream event. */
export interface WatchView {
  /** Overall page state. */
  phase: WatchPhase;
  /** Fine-grained connection status, mapped onto <arena-connection-status>. */
  connection: ConnectionPhase;
  /** Latest authoritative game snapshot, or null before the first arrives. */
  snapshot: Snapshot | null;
  /** Most recent emote per seat, keyed by seat id. */
  emotes: Record<string, Emote>;
  /** Final report once the match ends, else null. */
  report: MatchReport | null;
  /** Human-readable failure reason when `phase === 'error'`. */
  error: string | null;
  /** In-order comment stream, capped at 100. */
  comments: Comment[];
  /** Pending join request for a lost seat, cleared when the seat reconnects. */
  joinRequest: JoinRequestInfo | null;
}

const INITIAL: WatchView = {
  phase: 'connecting',
  connection: 'connecting',
  snapshot: null,
  emotes: {},
  report: null,
  error: null,
  comments: [],
  joinRequest: null,
};

/**
 * Connects to `GET <base>/v1/rooms/<id>/events` and streams updates to
 * `onChange`. The server sends an immediate `snapshot`, then live
 * `snapshot`/`emote`/`report`/`comment`/`joinRequest` events. The browser
 * auto-reconnects on transient drops; a fatal close (bad room, server down)
 * surfaces as an error state the caller can retry.
 */
export class WatchController {
  private es: EventSource | null = null;
  private view: WatchView = INITIAL;

  constructor(
    private readonly base: string,
    private readonly roomId: string,
    private readonly onChange: (view: WatchView) => void,
  ) {}

  /** Current view snapshot (useful for the first synchronous render). */
  getView(): WatchView {
    return this.view;
  }

  /** Open (or re-open) the stream. */
  start(): void {
    this.close();
    this.view = { ...INITIAL, emotes: {} };
    this.emit();

    let es: EventSource;
    try {
      es = new EventSource(eventsUrl(this.base, this.roomId));
    } catch {
      this.patch({ phase: 'error', connection: 'closed', error: 'Could not open a stream to this room.' });
      return;
    }
    this.es = es;

    es.addEventListener('open', () => this.patch({ connection: 'connected' }));
    es.addEventListener('snapshot', (e) => this.handle(e));
    es.addEventListener('emote', (e) => this.handle(e));
    es.addEventListener('report', (e) => this.handle(e));
    es.addEventListener('comment', (e) => this.handle(e));
    es.addEventListener('joinRequest', (e) => this.handle(e));
    es.addEventListener('error', () => this.handleError());
  }

  /** Retry after a failure — same as reopening the stream. */
  retry(): void {
    this.start();
  }

  /** Close the stream and stop emitting. */
  destroy(): void {
    this.close();
  }

  private close(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  private handle(e: Event): void {
    const data = (e as MessageEvent<string>).data;
    let ev: ArenaEvent;
    try {
      ev = JSON.parse(data) as ArenaEvent;
    } catch {
      return; // ignore malformed frames
    }

    if (ev.snapshot) {
      const snap = ev.snapshot;
      this.patch({ snapshot: snap, phase: 'watching', connection: 'connected' });
      // The stream only replays the snapshot on connect. If we tuned in after
      // the game ended, pull the report ourselves so late spectators see it.
      if (snap.result != null && this.view.report == null) {
        void this.fetchReport();
      }
      // If a pending joinRequest's seat is now connected, clear the request.
      if (this.view.joinRequest) {
        const seated = snap.players.find((p) => p.seat === this.view.joinRequest!.seat);
        if (seated && seated.status === 'connected') {
          this.patch({ joinRequest: null });
        }
      }
    } else if (ev.emote) {
      const emote = ev.emote;
      this.patch({ emotes: { ...this.view.emotes, [emote.seat]: emote } });
    } else if (ev.report) {
      this.patch({ report: ev.report });
    } else if (ev.comment) {
      const comments = [...this.view.comments, ev.comment];
      if (comments.length > 100) comments.splice(0, comments.length - 100);
      this.patch({ comments });
    } else if (ev.joinRequest) {
      this.patch({ joinRequest: ev.joinRequest });
    }
  }

  /** One-shot report fetch for spectators who arrive after the game ended. */
  private async fetchReport(): Promise<void> {
    try {
      const res = await fetch(`${this.base.replace(/\/+$/, '')}/v1/rooms/${this.roomId}/report`);
      if (!res.ok) return;
      const report = (await res.json()) as MatchReport;
      if (this.view.report == null) this.patch({ report });
    } catch {
      // Non-fatal: the aside simply stays without a report.
    }
  }

  private handleError(): void {
    const es = this.es;
    // readyState CLOSED = fatal (bad room / server gone): the browser will not
    // retry. CONNECTING = a transient drop it's already retrying.
    if (!es || es.readyState === EventSource.CLOSED) {
      if (this.view.snapshot) {
        // We had a live view; the feed just ended.
        this.patch({ connection: 'closed' });
      } else {
        this.patch({
          phase: 'error',
          connection: 'closed',
          error: 'Couldn’t connect to this room. It may not exist, or the server is unavailable.',
        });
      }
      return;
    }
    this.patch({ connection: 'reconnecting' });
  }

  private patch(partial: Partial<WatchView>): void {
    this.view = { ...this.view, ...partial };
    this.emit();
  }

  private emit(): void {
    this.onChange(this.view);
  }
}
