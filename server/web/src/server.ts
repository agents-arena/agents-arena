// Resolves the arena-server base URL and wraps the REST calls the spectator UI
// makes directly (create a room, archive, leaderboard, and the SSE URL). The
// live game feed itself is an EventSource opened in watch-controller.ts.

import type {
  ArchiveList,
  ArchivedMatch,
  CreateRoomResponse,
  Leaderboard,
} from './types.js';

/** Drop any trailing slash so we can join paths with a single leading slash. */
function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Where the API lives, in priority order:
 *   1. `?server=<url>` query param — lets one deploy point at any server.
 *   2. `VITE_ARENA_SERVER` build-time env — a baked-in default target.
 *   3. Same-origin (`location.origin`) — in dev, Vite proxies /v1 + /healthz
 *      to the Go server, so same-origin "just works".
 */
export function serverBase(): string {
  const fromQuery = new URLSearchParams(location.search).get('server');
  if (fromQuery) return trimSlash(fromQuery);

  const fromEnv = import.meta.env.VITE_ARENA_SERVER;
  if (fromEnv) return trimSlash(fromEnv);

  return trimSlash(location.origin);
}

/** SSE endpoint for a room's live event stream. */
export function eventsUrl(base: string, roomId: string): string {
  return `${trimSlash(base)}/v1/rooms/${encodeURIComponent(roomId)}/events`;
}

/** Pull a human-readable message out of an error JSON body, best effort. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body) {
      const msg = (body as { error?: unknown }).error;
      if (typeof msg === 'string' && msg) return msg;
    }
  } catch {
    // fall through to a status-based message
  }
  return `Server responded ${res.status}.`;
}

/**
 * Create a fresh room for `game` (host seat is reserved server-side). Returns
 * the created room including its id, which the caller uses to navigate into the
 * watch view. Throws with a readable message on failure.
 *
 * Optional `reasoning` (`self` | `open`) is sent in the POST body when provided.
 */
export async function createRoom(
  base: string,
  game: string,
  reasoning?: 'self' | 'open',
): Promise<CreateRoomResponse> {
  const body: { game: string; spectate: boolean; reasoning?: 'self' | 'open' } = {
    game,
    // spectate: the web creator takes NO seat, so both seats stay open for the
    // two agents it hands the room to.
    spectate: true,
  };
  if (reasoning !== undefined) body.reasoning = reasoning;

  let res: Response;
  try {
    res = await fetch(`${trimSlash(base)}/v1/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the arena server. Is it running?');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as CreateRoomResponse;
}

/** List archived matches (GET /v1/matches). */
export async function listMatches(
  base: string,
  opts?: { game?: string; limit?: number; offset?: number },
): Promise<ArchiveList> {
  const params = new URLSearchParams();
  if (opts?.game) params.set('game', opts.game);
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const url = `${trimSlash(base)}/v1/matches${qs ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Could not reach the arena server. Is it running?');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as ArchiveList;
}

/** Fetch one archived match by room id (GET /v1/matches/{room}). */
export async function getMatch(base: string, room: string): Promise<ArchivedMatch> {
  let res: Response;
  try {
    res = await fetch(`${trimSlash(base)}/v1/matches/${encodeURIComponent(room)}`);
  } catch {
    throw new Error('Could not reach the arena server. Is it running?');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as ArchivedMatch;
}

/** Fetch leaderboard standings (GET /v1/leaderboard). */
export async function getLeaderboard(base: string): Promise<Leaderboard> {
  let res: Response;
  try {
    res = await fetch(`${trimSlash(base)}/v1/leaderboard`);
  } catch {
    throw new Error('Could not reach the arena server. Is it running?');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as Leaderboard;
}
