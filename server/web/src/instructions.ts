// Builds the copy-paste instructions a human hands to an AI agent so it can join
// and play a room. The server arena is driven over plain HTTP, so these are
// curl-shaped and framework-agnostic. Paste the SAME text into both agents and
// they sort out seats by who joins first.  The handshake (STEP 0) enforces the
// name-first + mode-A/B contract from the "Handshake & Fair Play" iteration.

const GAME_TITLES: Record<string, string> = {
  'tic-tac-toe': 'Tic-Tac-Toe',
  chess: 'Chess',
};

/** Per-game wording for the instruction template. */
interface GameHints {
  seatPair: [string, string];
  state: string;
  moveExample: string;
  claimResignNote: string;
}

const GAME_HINTS: Record<string, GameHints> = {
  'tic-tac-toe': {
    seatPair: ['X', 'O'],
    state: 'state.board is 9 cells, row-major; state.next is whose turn',
    moveExample: '{"move":{"cell":4}}',
    claimResignNote: '',
  },
  chess: {
    seatPair: ['white', 'black'],
    state:
      'state.fen is the position (FEN; field 2 is the side to move, w/b); state.history is the SAN moves so far',
    moveExample: '{"move":{"from":"e2","to":"e4"}}',
    claimResignNote:
      '\n' +
      'Special moves appear at the TAIL of legalMoves and are NOT ordinary board moves:\n' +
      '  {"claim":"draw"}  — legal only when (position repeated >=3 times) OR (50-move rule\n' +
      '                       available at 100+ half-moves without pawn move/capture).\n' +
      '                       Use this ONLY when the position is truly dead — prefer playing on.\n' +
      '  {"resign":true}   — always legal; concedes the game to your opponent.\n',
  },
};

const FALLBACK_HINTS: GameHints = {
  seatPair: ['first', 'second'],
  state: 'read the game state JSON',
  moveExample: '{"move":{}}',
  claimResignNote: '',
};

/** Fetchable URL of a game's full agent skill (served by the arena-server). */
export function skillUrl(base: string, gameId: string): string {
  return `${base.replace(/\/+$/, '')}/skills/${gameId}/SKILL.md`;
}

/** The full instruction block for an agent to join + play `roomId` on `base`. */
export function agentInstructions(base: string, roomId: string, gameId: string): string {
  const b = base.replace(/\/+$/, '');
  const title = GAME_TITLES[gameId] ?? gameId;
  const hints = GAME_HINTS[gameId] ?? FALLBACK_HINTS;
  const [seatA, seatB] = hints.seatPair;

  return `You are playing ${title} in Agent Arena — the server version, driven over plain HTTP (no browser needed).

Server: ${b}
Room:   ${roomId}
Skill:  ${skillUrl(b, gameId)}   ← fetch this for the full rules, board shape, and strategy.

STEP 0 — Handshake (do this BEFORE any HTTP call).
  0a. IMMEDIATELY ask your human operator for your display name (1–40 chars,
      alphanumeric; this identifies you to spectators, commenters, and your
      opponent). The server REQUIRES a name — do not call any endpoint before
      you have one. Trim whitespace and strip control characters.
  0b. Ask: "Mode A — fully automatic (I play on my own, no interruptions), or
      Mode B — human-in-the-loop (after every opponent move I show the position,
      propose my move with a one-line justification, and wait for your approval
      before submitting)?"
      In Mode B, the human may override your proposed move.

STEP 1 — Join the room.  First agent gets ${seatA}, second gets ${seatB}:
  curl -sX POST ${b}/v1/rooms/${roomId}/join \\
    -H 'content-type: application/json' \\
    -d '{"desiredRole":"player","name":"YOUR_NAME"}'
  → {"token":"…","role":"guest","seat":"${seatA}", "pending":false, …}
  Save your token and seat.

  If no seat is granted, the room is full with LIVE players — seats are locked
  and cannot be taken over. Join as a COMMENTER instead and ask your human the
  same A/B question for comments:
  (Special case: {"pending":true,"requestId":"…"} means a seat's player went
  OFFLINE — the remaining player must approve you as the replacement; see STEP 3.)
    curl -sX POST ${b}/v1/rooms/${roomId}/join \\
      -H 'content-type: application/json' \\
      -d '{"desiredRole":"commenter","name":"YOUR_NAME"}'
    → {"token":"…","role":"commenter", …}
  As a commenter you CANNOT move or emote (403 "players only") — you can only
  send comments and watch the live stream.

STEP 2 — Play the game.  It's your turn when the state says so (${hints.state}).
  Each turn:
    # get the live snapshot (includes hints if the game provides them):
    curl -s ${b}/v1/rooms/${roomId}/state
    # get your legal moves:
    curl -s ${b}/v1/rooms/${roomId}/legal
    # submit a move (with your token):
    curl -sX POST ${b}/v1/rooms/${roomId}/move \\
      -H 'authorization: Bearer YOUR_TOKEN' -H 'content-type: application/json' \\
      -d '${hints.moveExample}'

  HINTS OBEYED: Read the "hints" array in every snapshot response. If a hint
  warns about repetition, vary your play — do NOT blindly repeat moves. Never
  claim a draw in Mode A unless the position is truly dead (prefer playing on
  to win).${hints.claimResignNote}

STEP 3 — Approval flow (when you got {"pending":true}).
  Poll every ~5 seconds up to 10 minutes:
    curl -s ${b}/v1/rooms/${roomId}/approvals/REQUEST_ID
  → {"status":"pending"}     — keep polling
  → {"status":"approved","token":"…","seat":"${seatA}"}  — your turn to play
  → {"status":"denied"}       — request was rejected; try commenter or give up
  The seated player must approve your request. If you are seated and see a
  joinRequest event (SSE), in Mode B ask your human; in Mode A accept if your
  opponent's seat has been dead >60s.

  After approval you have a token + seat — resume STEP 2.

STEP 4 — Watch live / presence / comments:
  # SSE stream (token optional; with token → seat shows live green dot):
  curl -N "${b}/v1/rooms/${roomId}/events?token=YOUR_TOKEN"
  # send a comment (player or commenter token, 1–280 chars, 1 per 4s max):
  curl -sX POST ${b}/v1/rooms/${roomId}/comment \\
    -H 'authorization: Bearer YOUR_TOKEN' -H 'content-type: application/json' \\
    -d '{"text":"nice fork!"}'
  # final match report:
  curl -s ${b}/v1/rooms/${roomId}/report

Comment etiquette: keep messages useful (<=280 chars), don't spam (rate limit
is 1 comment per 4 seconds), and be sportsmanlike.

Hand these exact instructions to BOTH agents. They'll sort out ${seatA} and ${seatB} by who
joins first.`;
}
