package checkers

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/agents-arena/agents-arena/rules/spec"
)

func at(r, c int) int { return r*cols + c }

// board builds a position from 8 rows of 8 runes: '.' empty, r/R/b/B pieces.
func board(t *testing.T, next string, rowsIn ...string) state {
	t.Helper()
	if len(rowsIn) != rows {
		t.Fatalf("need %d rows, got %d", rows, len(rowsIn))
	}
	var st state
	for r, row := range rowsIn {
		if len(row) != cols {
			t.Fatalf("row %d: need %d squares, got %d", r, cols, len(row))
		}
		for c, ch := range row {
			if ch == '.' {
				continue
			}
			if !playable(at(r, c)) {
				t.Fatalf("row %d col %d is a light square", r, c)
			}
			st.Board[at(r, c)] = string(ch)
		}
	}
	st.Next = next
	st.Chain = -1
	return st
}

func mv(from, to int) json.RawMessage {
	b, _ := json.Marshal(move{From: from, To: to})
	return b
}

// has reports whether the legal-move list contains from→to.
func has(list []move, from, to int) bool {
	for _, m := range list {
		if m.From == from && m.To == to {
			return true
		}
	}
	return false
}

func TestOpeningPosition(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	if got := count(st.Board, "R"); got != 12 {
		t.Errorf("red pieces = %d, want 12", got)
	}
	if got := count(st.Board, "B"); got != 12 {
		t.Errorf("black pieces = %d, want 12", got)
	}
	if st.Next != "R" {
		t.Errorf("opening seat = %q, want R", st.Next)
	}
	for i := 0; i < size; i++ {
		if st.Board[i] != "" && !playable(i) {
			t.Fatalf("piece on light square %d", i)
		}
	}
	// Seven opening moves for red, as in every book on the game.
	if n := len(g.LegalMoves(st)); n != 7 {
		t.Errorf("opening legal moves = %d, want 7", n)
	}
}

func TestMenMoveForwardOnly(t *testing.T) {
	st := board(t, "R",
		"........",
		"........",
		"........",
		"....r...",
		"........",
		"........",
		"........",
		"........",
	)
	list := moveList(st)
	if len(list) != 2 {
		t.Fatalf("a lone red man has %d moves, want 2: %+v", len(list), list)
	}
	for _, m := range list {
		if m.To/cols != 2 {
			t.Errorf("red man moved to row %d — men only move up the board", m.To/cols)
		}
	}

	st = board(t, "B",
		"........",
		"........",
		"........",
		"....b...",
		"........",
		"........",
		"........",
		"........",
	)
	for _, m := range moveList(st) {
		if m.To/cols != 4 {
			t.Errorf("black man moved to row %d — men only move down the board", m.To/cols)
		}
	}
}

func TestKingsMoveBothWays(t *testing.T) {
	st := board(t, "R",
		"........",
		"........",
		"........",
		"....R...",
		"........",
		"........",
		"........",
		"........",
	)
	list := moveList(st)
	if len(list) != 4 {
		t.Fatalf("a lone red king has %d moves, want 4: %+v", len(list), list)
	}
}

func TestCapturesAreForced(t *testing.T) {
	g := New()
	// Red can jump the black man on (4,3); a quiet move elsewhere is illegal.
	st := board(t, "R",
		"........",
		"........",
		"........",
		"........",
		"...b....",
		"....r...",
		"........",
		"......r.",
	)
	list := moveList(st)
	if len(list) != 1 || !has(list, at(5, 4), at(3, 2)) {
		t.Fatalf("legal moves = %+v, want only the jump", list)
	}
	if err := g.Validate(st, mv(at(7, 6), at(6, 5)), "R"); err == nil || err.Error() != "captures are forced" {
		t.Errorf("quiet move while a jump exists = %v, want \"captures are forced\"", err)
	}
	after := g.Apply(st, mv(at(5, 4), at(3, 2))).(state)
	if after.Board[at(4, 3)] != "" {
		t.Error("the jumped man is still on the board")
	}
	if after.Board[at(3, 2)] != redMan {
		t.Errorf("landing square holds %q", after.Board[at(3, 2)])
	}
	if after.Next != "B" {
		t.Errorf("next = %q, want B — the jump was not extendable", after.Next)
	}
}

func TestMultiJumpKeepsTheTurnAndConstrainsTheMover(t *testing.T) {
	g := New()
	// Two black men lined up so one red man jumps twice.
	st := board(t, "R",
		"........",
		"........",
		"...b....",
		"........",
		"...b....",
		"....r...",
		"........",
		"......r.",
	)
	after := g.Apply(st, mv(at(5, 4), at(3, 2))).(state)
	if after.Next != "R" {
		t.Fatalf("next = %q, want R — the chain continues", after.Next)
	}
	if after.Chain != at(3, 2) {
		t.Fatalf("chain = %d, want %d", after.Chain, at(3, 2))
	}
	list := moveList(after)
	if len(list) != 1 || !has(list, at(3, 2), at(1, 4)) {
		t.Fatalf("mid-chain legal moves = %+v, want only the second jump", list)
	}
	// The other red man may not move while the chain is unfinished.
	err := g.Validate(after, mv(at(7, 6), at(6, 5)), "R")
	if err == nil || !strings.Contains(err.Error(), "must continue jumping") {
		t.Errorf("moving another piece mid-chain = %v", err)
	}
	final := g.Apply(after, mv(at(3, 2), at(1, 4))).(state)
	if final.Next != "B" {
		t.Errorf("next = %q, want B once the chain is done", final.Next)
	}
	if count(final.Board, "B") != 0 {
		t.Errorf("black still has %d pieces after a double jump", count(final.Board, "B"))
	}
}

func TestPromotionCrownsAndEndsTheTurn(t *testing.T) {
	g := New()
	// A red man jumps onto the crown row while another jump would be available
	// from there: standard English rules stop the turn at the crowning.
	st := board(t, "R",
		"........",
		"..b.b...",
		".....r..",
		"........",
		"........",
		"........",
		"........",
		"........",
	)
	after := g.Apply(st, mv(at(2, 5), at(0, 3))).(state)
	if after.Board[at(0, 3)] != redKing {
		t.Fatalf("piece on the crown row = %q, want a king", after.Board[at(0, 3)])
	}
	if len(jumpsFrom(after.Board, at(0, 3))) == 0 {
		t.Fatal("the test position should still offer a jump from the crown row")
	}
	if after.Chain != -1 || after.Next != "B" {
		t.Errorf("chain = %d next = %q, want the turn to end at the crowning", after.Chain, after.Next)
	}
}

func TestNoMovesLosesTheGame(t *testing.T) {
	g := New()
	// Red's last man is boxed into the corner by black.
	st := board(t, "R",
		"........",
		"........",
		"........",
		"........",
		"........",
		"..b.....",
		".b......",
		"r.......",
	)
	res := g.Terminal(st)
	if res == nil || res.Kind != "win" || res.Winner != "B" {
		t.Fatalf("result = %+v, want a B win", res)
	}
	if res.Reason != "no moves left" {
		t.Errorf("reason = %q, want \"no moves left\"", res.Reason)
	}

	// With nothing on the board at all, the reason says so.
	empty := board(t, "R",
		"........",
		"........",
		"........",
		"........",
		"........",
		"........",
		"........",
		"..b.....",
	)
	res = g.Terminal(empty)
	if res == nil || res.Winner != "B" || res.Reason != "no pieces left" {
		t.Fatalf("result = %+v, want a B win with no pieces left", res)
	}
	if g.ToMove(empty) != "" {
		t.Error("a finished game still reports a side to move")
	}
	if n := len(g.LegalMoves(empty)); n != 0 {
		t.Errorf("a finished game offers %d moves", n)
	}
}

func TestIdleCounterDrawsTheGame(t *testing.T) {
	g := New()
	st := board(t, "R",
		"........",
		"........",
		"...R....",
		"........",
		"........",
		"....B...",
		"........",
		"........",
	)
	// King moves are not progress: the counter climbs.
	after := g.Apply(st, mv(at(2, 3), at(1, 2))).(state)
	if after.Idle != 1 {
		t.Errorf("idle after a king move = %d, want 1", after.Idle)
	}
	st.Idle = idleLimit
	res := g.Terminal(st)
	if res == nil || res.Kind != "draw" || res.Reason != "no progress" {
		t.Fatalf("result at the idle limit = %+v, want a no-progress draw", res)
	}

	// A man move resets it.
	manMove := board(t, "R",
		"........",
		"........",
		"........",
		"....r...",
		"........",
		"........",
		"........",
		"........",
	)
	manMove.Idle = 30
	if got := g.Apply(manMove, mv(at(3, 4), at(2, 3))).(state).Idle; got != 0 {
		t.Errorf("idle after a man move = %d, want 0", got)
	}
}

func TestHints(t *testing.T) {
	g := New().(spec.Rules)
	h, ok := g.(spec.Hinter)
	if !ok {
		t.Fatal("checkers should implement spec.Hinter")
	}
	if got := h.Hints(g.Init("")); len(got) != 0 {
		t.Errorf("opening hints = %v, want none", got)
	}

	forced := board(t, "R",
		"........",
		"........",
		"........",
		"........",
		"...b....",
		"....r...",
		"........",
		"........",
	)
	got := h.Hints(forced)
	if len(got) != 1 || !strings.Contains(got[0], "captures are forced") {
		t.Fatalf("hints = %v, want the forced-capture warning", got)
	}

	chain := forced
	chain.Chain = at(5, 4)
	got = h.Hints(chain)
	if len(got) != 1 || !strings.Contains(got[0], "keep jumping") {
		t.Fatalf("hints = %v, want the chain warning", got)
	}

	idle := board(t, "R",
		"........",
		"........",
		"...R....",
		"........",
		"........",
		"....B...",
		"........",
		"........",
	)
	idle.Idle = idleLimit - 5
	got = h.Hints(idle)
	if len(got) != 1 || !strings.Contains(got[0], "drawn in 5") {
		t.Fatalf("hints = %v, want the draw countdown", got)
	}
}

func TestRejections(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	for _, tc := range []struct{ move, reason string }{
		{`{"from":64,"to":0}`, "square out of range"},
		{`{"from":-1,"to":0}`, "square out of range"},
		{`{"from":0,"to":9}`, "no piece of yours on that square"},  // light square, empty
		{`{"from":1,"to":10}`, "no piece of yours on that square"}, // a black man
		{`{"from":40,"to":24}`, "illegal move"},                    // red man, two rows, no jump
		{`"nope"`, "square out of range"},
	} {
		err := g.Validate(st, json.RawMessage(tc.move), "R")
		if err == nil || err.Error() != tc.reason {
			t.Errorf("Validate(%s) = %v, want %q", tc.move, err, tc.reason)
		}
	}
	if err := g.Validate(st, mv(at(5, 0), at(4, 1)), "B"); err == nil || err.Error() != "not your turn" {
		t.Errorf("out-of-turn Validate = %v", err)
	}
}

func TestSerializeDeserializeRoundTrip(t *testing.T) {
	g := New()
	ser := g.Serialize(g.Init(""))
	for _, want := range []string{`"next":"R"`, `"chain":null`, `"idle":0`} {
		if !strings.Contains(string(ser), want) {
			t.Errorf("opening serialize missing %s", want)
		}
	}
	back, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	if string(g.Serialize(back)) != string(ser) {
		t.Error("opening roundtrip differs")
	}

	chain := board(t, "R",
		"........",
		"........",
		"...b....",
		"........",
		"...b....",
		"....r...",
		"........",
		"........",
	)
	mid := g.Apply(chain, mv(at(5, 4), at(3, 2))).(state)
	ser2 := g.Serialize(mid)
	if !strings.Contains(string(ser2), `"chain":26`) {
		t.Errorf("mid-chain serialize = %s", ser2)
	}
	back2, err := g.Deserialize(ser2)
	if err != nil {
		t.Fatalf("deserialize mid-chain: %v", err)
	}
	if back2.(state).Chain != at(3, 2) {
		t.Errorf("chain lost in the roundtrip: %d", back2.(state).Chain)
	}
	if string(g.Serialize(back2)) != string(ser2) {
		t.Error("mid-chain roundtrip differs")
	}
}

func TestDeserializeRejectsBadState(t *testing.T) {
	g := New()
	cells := func(overrides map[int]string) string {
		out := make([]string, size)
		for i := range out {
			out[i] = "null"
		}
		for i, v := range overrides {
			out[i] = `"` + v + `"`
		}
		return "[" + strings.Join(out, ",") + "]"
	}
	bad := []string{
		``,
		`{"board":[],"next":"R","chain":null,"idle":0}`,
		`{"board":` + cells(map[int]string{1: "x"}) + `,"next":"R","chain":null,"idle":0}`,
		// A piece parked on a light square could never arise in play.
		`{"board":` + cells(map[int]string{0: "r"}) + `,"next":"R","chain":null,"idle":0}`,
		`{"board":` + cells(nil) + `,"next":"Z","chain":null,"idle":0}`,
		// A chain pointing at a square with none of the mover's pieces on it.
		`{"board":` + cells(map[int]string{1: "b"}) + `,"next":"R","chain":1,"idle":0}`,
		`{"board":` + cells(nil) + `,"next":"R","chain":null,"idle":-1}`,
	}
	for _, s := range bad {
		if _, err := g.Deserialize(json.RawMessage(s)); err == nil {
			t.Errorf("Deserialize(%.60q) accepted a bad state", s)
		}
	}
}
