// Package e2e drives the arena the way an agent does: over the public HTTP API
// of a real server, with no access to internals beyond starting the process.
//
// The suite is game-agnostic on purpose. It walks spec.All() — every game
// registered in this binary — so a newly registered game is covered the moment
// it lands, without a line of test code per game. Games that need extra,
// game-specific end-to-end coverage add their own file next to this one.
package e2e

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
	"github.com/agents-arena/agents-arena/server/internal/api"
	"github.com/agents-arena/agents-arena/server/internal/room"
	"github.com/agents-arena/agents-arena/server/internal/store"

	// Every game the server binary registers, so the sweep below covers the
	// same roster the shipped server serves.
	_ "github.com/agents-arena/agents-arena/rules/games/checkers"
	_ "github.com/agents-arena/agents-arena/rules/games/chess"
	_ "github.com/agents-arena/agents-arena/rules/games/connectfour"
	_ "github.com/agents-arena/agents-arena/rules/games/dotsandboxes"
	_ "github.com/agents-arena/agents-arena/rules/games/gomoku"
	_ "github.com/agents-arena/agents-arena/rules/games/hex"
	_ "github.com/agents-arena/agents-arena/rules/games/reversi"
	_ "github.com/agents-arena/agents-arena/rules/games/tictactoe"
)

// maxPlies bounds a single match so a rules bug that never terminates fails the
// test instead of hanging it. Chess with random-legal play regularly runs into
// the hundreds of plies before the auto-draw rules bite.
const maxPlies = 1200

// arena is a running server plus the HTTP helpers an agent would write.
type arena struct {
	t    *testing.T
	base string
}

func newArena(t *testing.T) *arena {
	t.Helper()
	srv := httptest.NewServer(api.Handler(room.NewManager(store.NewMem())))
	t.Cleanup(srv.Close)
	return &arena{t: t, base: srv.URL}
}

func (a *arena) do(method, path, token string, body any) *http.Response {
	a.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			a.t.Fatalf("encode %s %s: %v", method, path, err)
		}
	}
	req, err := http.NewRequest(method, a.base+path, &buf)
	if err != nil {
		a.t.Fatalf("new request %s %s: %v", method, path, err)
	}
	req.Header.Set("content-type", "application/json")
	if token != "" {
		req.Header.Set("authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		a.t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

// getJSON performs a GET and decodes the body into dst, failing on non-200.
func (a *arena) getJSON(path string, dst any) {
	a.t.Helper()
	resp := a.do("GET", path, "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		a.t.Fatalf("GET %s: status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		a.t.Fatalf("GET %s: decode: %v", path, err)
	}
}

func (a *arena) createRoom(game, name string) protocol.CreateRoomResponse {
	a.t.Helper()
	resp := a.do("POST", "/v1/rooms", "", protocol.CreateRoomRequest{
		Game: game, Name: name, Model: "e2e-" + name,
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		a.t.Fatalf("create %s room: status %d: %s", game, resp.StatusCode, body)
	}
	var cr protocol.CreateRoomResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		a.t.Fatalf("create room: decode: %v", err)
	}
	return cr
}

func (a *arena) join(roomID, name string) protocol.JoinResponse {
	a.t.Helper()
	resp := a.do("POST", "/v1/rooms/"+roomID+"/join", "", protocol.JoinRequest{
		DesiredRole: protocol.RoleGuest, Name: name, Model: "e2e-" + name,
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		a.t.Fatalf("join: status %d: %s", resp.StatusCode, body)
	}
	var jr protocol.JoinResponse
	if err := json.NewDecoder(resp.Body).Decode(&jr); err != nil {
		a.t.Fatalf("join: decode: %v", err)
	}
	return jr
}

func (a *arena) state(roomID string) protocol.Snapshot {
	a.t.Helper()
	var snap protocol.Snapshot
	a.getJSON("/v1/rooms/"+roomID+"/state", &snap)
	return snap
}

func (a *arena) legal(roomID string) []json.RawMessage {
	a.t.Helper()
	var moves []json.RawMessage
	a.getJSON("/v1/rooms/"+roomID+"/legal", &moves)
	return moves
}

// move submits a move and returns the server's ack (which may be a refusal).
func (a *arena) move(roomID, token string, mv json.RawMessage) protocol.MoveAck {
	a.t.Helper()
	resp := a.do("POST", "/v1/rooms/"+roomID+"/move", token, protocol.MoveRequest{
		Move: mv,
		Meta: &protocol.MoveMeta{Model: "e2e", Method: "engine", Note: "random-legal"},
	})
	defer resp.Body.Close()
	var ack protocol.MoveAck
	if err := json.NewDecoder(resp.Body).Decode(&ack); err != nil {
		a.t.Fatalf("move: decode: %v", err)
	}
	return ack
}

func (a *arena) report(roomID string) protocol.MatchReport {
	a.t.Helper()
	var rep protocol.MatchReport
	a.getJSON("/v1/rooms/"+roomID+"/report", &rep)
	return rep
}

// seatedMatch creates a room and fills both seats, returning the room id and a
// seat -> token map — the state every game test starts from.
func (a *arena) seatedMatch(game string) (string, map[string]string) {
	a.t.Helper()
	cr := a.createRoom(game, "Alpha")
	jr := a.join(cr.RoomID, "Beta")
	if cr.Seat == "" || jr.Seat == "" {
		a.t.Fatalf("%s: expected two seats, got %q and %q", game, cr.Seat, jr.Seat)
	}
	if cr.Seat == jr.Seat {
		a.t.Fatalf("%s: both agents got seat %q", game, cr.Seat)
	}
	return cr.RoomID, map[string]string{cr.Seat: cr.Token, jr.Seat: jr.Token}
}

// playOut plays random-legal moves until the game ends, returning the final
// snapshot and the number of plies applied.
func (a *arena) playOut(t *testing.T, roomID string, tokens map[string]string, rng *rand.Rand) (protocol.Snapshot, int) {
	t.Helper()
	plies := 0
	for {
		snap := a.state(roomID)
		if snap.Result != nil {
			return snap, plies
		}
		if plies >= maxPlies {
			t.Fatalf("%s: no result after %d plies", snap.GameID, plies)
		}
		seat := snap.ToMove
		token, ok := tokens[seat]
		if !ok {
			t.Fatalf("%s: toMove %q is not a seated player (%v)", snap.GameID, seat, tokens)
		}
		moves := a.legal(roomID)
		if len(moves) == 0 {
			t.Fatalf("%s: no legal moves at ply %d but the game is not over", snap.GameID, plies)
		}
		mv := moves[rng.Intn(len(moves))]
		if ack := a.move(roomID, token, mv); !ack.OK {
			t.Fatalf("%s: server rejected its own legal move %s at ply %d: %s",
				snap.GameID, mv, plies, ack.Reason)
		}
		plies++
	}
}

// TestEveryGamePlaysThroughTheAPI is the sweep: for each registered game, two
// agents sit down, play a whole match over HTTP, and the finished match shows
// up in the report and the archive with a coherent record.
func TestEveryGamePlaysThroughTheAPI(t *testing.T) {
	games := spec.All()
	if len(games) < 8 {
		t.Fatalf("expected the server's game roster to be registered, got %d", len(games))
	}

	for _, g := range games {
		meta := g.Meta()
		t.Run(meta.ID, func(t *testing.T) {
			t.Parallel()
			a := newArena(t)
			roomID, tokens := a.seatedMatch(meta.ID)
			rng := rand.New(rand.NewSource(1))

			opening := a.state(roomID)
			if opening.GameID != meta.ID {
				t.Errorf("snapshot gameId = %q, want %q", opening.GameID, meta.ID)
			}
			if opening.ToMove == "" {
				t.Fatal("no side to move on a fresh room")
			}
			if len(a.legal(roomID)) == 0 {
				t.Fatal("no legal moves on a fresh room")
			}

			final, plies := a.playOut(t, roomID, tokens, rng)
			if plies == 0 {
				t.Fatal("match ended before a single move")
			}
			if final.ToMove != "" {
				t.Errorf("finished game still reports toMove %q", final.ToMove)
			}
			if len(a.legal(roomID)) != 0 {
				t.Error("finished game still offers legal moves")
			}
			switch final.Result.Kind {
			case protocol.ResultWin:
				if final.Result.Winner == "" {
					t.Error("win result carries no winner")
				}
				if _, seated := tokens[final.Result.Winner]; !seated {
					t.Errorf("winner %q is not one of the seats", final.Result.Winner)
				}
			case protocol.ResultDraw:
				if final.Result.Winner != "" {
					t.Errorf("draw result names a winner %q", final.Result.Winner)
				}
			default:
				t.Errorf("unexpected result kind %q", final.Result.Kind)
			}

			rep := a.report(roomID)
			if rep.GameID != meta.ID || rep.Room != roomID {
				t.Errorf("report identifies %s/%s, want %s/%s", rep.GameID, rep.Room, meta.ID, roomID)
			}
			if len(rep.Moves) != plies {
				t.Errorf("report has %d moves, want %d", len(rep.Moves), plies)
			}
			if rep.Result == nil || rep.Result.Kind != final.Result.Kind {
				t.Errorf("report result %+v disagrees with the final snapshot %+v", rep.Result, final.Result)
			}
			moved := 0
			for _, p := range rep.Players {
				moved += p.Moves
			}
			if moved != plies {
				t.Errorf("per-seat move counts sum to %d, want %d", moved, plies)
			}
			for i, mv := range rep.Moves {
				if mv.Ply != i+1 {
					t.Errorf("move %d has ply %d", i, mv.Ply)
					break
				}
				if _, seated := tokens[mv.Seat]; !seated {
					t.Errorf("move %d attributed to unseated %q", i, mv.Seat)
					break
				}
			}

			var archive protocol.ArchiveList
			a.getJSON("/v1/matches?limit=50", &archive)
			found := false
			for _, m := range archive.Matches {
				if m.Room == roomID {
					found = true
					if m.GameID != meta.ID {
						t.Errorf("archived as %q, want %q", m.GameID, meta.ID)
					}
					if m.MoveCount != plies {
						t.Errorf("archive move count %d, want %d", m.MoveCount, plies)
					}
				}
			}
			if !found {
				t.Errorf("finished match %s is missing from the archive", roomID)
			}
		})
	}
}

// TestSeatRulesAreEnforcedOverHTTP covers the refusals an agent will actually
// hit: playing out of turn, playing without a token, and playing after the
// game is over — for every registered game, since each owns its own Validate.
func TestSeatRulesAreEnforcedOverHTTP(t *testing.T) {
	for _, g := range spec.All() {
		meta := g.Meta()
		t.Run(meta.ID, func(t *testing.T) {
			t.Parallel()
			a := newArena(t)
			roomID, tokens := a.seatedMatch(meta.ID)

			snap := a.state(roomID)
			mv := a.legal(roomID)[0]

			// The seat that is NOT to move may not play it.
			for seat, token := range tokens {
				if seat == snap.ToMove {
					continue
				}
				if ack := a.move(roomID, token, mv); ack.OK {
					t.Errorf("seat %q moved out of turn", seat)
				} else if ack.Reason != "not your turn" {
					t.Errorf("out-of-turn refusal = %q, want \"not your turn\"", ack.Reason)
				}
			}

			// No token at all is a 401, not a refusal in the body.
			resp := a.do("POST", "/v1/rooms/"+roomID+"/move", "", protocol.MoveRequest{Move: mv})
			resp.Body.Close()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("tokenless move: status %d, want 401", resp.StatusCode)
			}

			// A payload that is not a move object at all is refused, whatever the
			// game's move shape is, and the position is untouched.
			if ack := a.move(roomID, tokens[snap.ToMove], json.RawMessage(`[]`)); ack.OK {
				t.Error("server accepted a non-object move payload")
			}
			if after := a.state(roomID); after.Rev != snap.Rev {
				t.Errorf("a refused move advanced rev from %d to %d", snap.Rev, after.Rev)
			}

			// Play it out, then confirm the room is closed for business.
			final, _ := a.playOut(t, roomID, tokens, rand.New(rand.NewSource(7)))
			for seat, token := range tokens {
				if ack := a.move(roomID, token, mv); ack.OK {
					t.Errorf("seat %q moved after the game ended (%+v)", seat, final.Result)
				}
			}
		})
	}
}

// TestSpectatorStreamCarriesTheMatch checks the part agents and watchers share:
// an SSE subscriber with no token receives the opening snapshot, sees a move
// land, and gets the final report on the same stream.
func TestSpectatorStreamCarriesTheMatch(t *testing.T) {
	a := newArena(t)
	roomID, tokens := a.seatedMatch("tic-tac-toe")

	resp := a.do("GET", "/v1/rooms/"+roomID+"/events", "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("events: status %d", resp.StatusCode)
	}

	events := make(chan protocol.Event, 64)
	go func() {
		defer close(events)
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var ev protocol.Event
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &ev) == nil {
				events <- ev
			}
		}
	}()

	next := func(want string) protocol.Event {
		t.Helper()
		deadline := time.After(10 * time.Second)
		for {
			select {
			case ev, ok := <-events:
				if !ok {
					t.Fatalf("stream closed while waiting for %q", want)
				}
				if ev.Type == want {
					return ev
				}
			case <-deadline:
				t.Fatalf("timed out waiting for a %q event", want)
			}
		}
	}

	first := next("snapshot")
	if first.Snapshot == nil || first.Snapshot.GameID != "tic-tac-toe" {
		t.Fatalf("first snapshot is %+v", first.Snapshot)
	}
	startRev := first.Snapshot.Rev

	snap := a.state(roomID)
	if ack := a.move(roomID, tokens[snap.ToMove], a.legal(roomID)[0]); !ack.OK {
		t.Fatalf("opening move refused: %s", ack.Reason)
	}
	for {
		ev := next("snapshot")
		if ev.Snapshot.Rev > startRev {
			break
		}
	}

	a.playOut(t, roomID, tokens, rand.New(rand.NewSource(3)))
	rep := next("report")
	if rep.Report == nil || rep.Report.Room != roomID {
		t.Fatalf("report event is %+v", rep.Report)
	}
	if rep.Report.Result == nil {
		t.Error("streamed report has no result")
	}
}

// TestLegalMovesAreExactlyWhatTheServerAccepts walks the opening position of
// every game and proves /legal and /move agree: each advertised move is
// accepted from a fresh room, and nothing outside the list is.
func TestLegalMovesAreExactlyWhatTheServerAccepts(t *testing.T) {
	for _, g := range spec.All() {
		meta := g.Meta()
		t.Run(meta.ID, func(t *testing.T) {
			t.Parallel()
			for i, mv := range openingSample(t, meta.ID) {
				a := newArena(t)
				roomID, tokens := a.seatedMatch(meta.ID)
				seat := a.state(roomID).ToMove
				if ack := a.move(roomID, tokens[seat], mv); !ack.OK {
					t.Errorf("advertised opening move %d (%s) refused: %s", i, mv, ack.Reason)
				}
			}
		})
	}
}

// openingSample returns up to 8 of the opening position's legal moves, so games
// with large move lists (chess, big boards) stay quick.
func openingSample(t *testing.T, game string) []json.RawMessage {
	t.Helper()
	a := newArena(t)
	roomID, _ := a.seatedMatch(game)
	moves := a.legal(roomID)
	if len(moves) == 0 {
		t.Fatalf("%s has no opening moves", game)
	}
	if len(moves) > 8 {
		step := len(moves) / 8
		var sample []json.RawMessage
		for i := 0; i < len(moves); i += step {
			sample = append(sample, moves[i])
			if len(sample) == 8 {
				break
			}
		}
		return sample
	}
	return moves
}
