// Minimal hash router. Routes:
//   #/            (or empty)     -> landing
//   #room=<id>                   -> watch that room
//   #/archive                    -> match history
//   #/leaderboard                -> standings
//   #match=<room>                -> archived match detail
// The `?server=` selector lives in the query string, so it survives hash nav.

/** The current view the app should render. */
export type Route =
  | { name: 'landing' }
  | { name: 'room'; id: string }
  | { name: 'archive' }
  | { name: 'leaderboard' }
  | { name: 'match'; id: string };

/** Parse `location.hash` into a Route. */
export function parseRoute(): Route {
  const hash = location.hash.replace(/^#/, '');

  // Path-style routes: /archive, /leaderboard (and bare /)
  const path = hash.split(/[?&]/)[0] ?? '';
  if (path === '/archive' || path === 'archive') {
    return { name: 'archive' };
  }
  if (path === '/leaderboard' || path === 'leaderboard') {
    return { name: 'leaderboard' };
  }

  // Query-style: #match=<room>
  const matchRoute = /(?:^|[?&])match=([^&]+)/.exec(hash);
  if (matchRoute && matchRoute[1]) {
    return { name: 'match', id: decodeURIComponent(matchRoute[1]) };
  }

  // Query-style: #room=<id>
  const roomMatch = /(?:^|[?&])room=([^&]+)/.exec(hash);
  if (roomMatch && roomMatch[1]) {
    return { name: 'room', id: decodeURIComponent(roomMatch[1]) };
  }

  return { name: 'landing' };
}

/** Hash for a room watch view. */
export function roomHash(id: string): string {
  return `#room=${encodeURIComponent(id)}`;
}

/** Hash for the landing view. */
export function landingHash(): string {
  return '#/';
}

/** Hash for the match history / archive view. */
export function archiveHash(): string {
  return '#/archive';
}

/** Hash for the leaderboard view. */
export function leaderboardHash(): string {
  return '#/leaderboard';
}

/** Hash for an archived match detail view. */
export function matchHash(room: string): string {
  return `#match=${encodeURIComponent(room)}`;
}
