package gomoku

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/agents-arena/agents-arena/rules/spec"
)

// at converts row/col to a board index, the way the tests read positions.
func at(r, c int) int { return r*cols + c }

// place builds a state with the given stones, seat to move, and no last move.
func place(next string, stones map[int]string) state {
	var st state
	for cell, seat := range stones {
		st.Board[cell] = seat
	}
	st.Next = next
	st.Last = -1
	return st
}

// line puts n stones of seat in a row from (r,c) stepping by (dr,dc).
func line(stones map[int]string, r, c, dr, dc, n int, seat string) map[int]string {
	for i := 0; i < n; i++ {
		stones[at(r+dr*i, c+dc*i)] = seat
	}
	return stones
}

func TestOpeningPosition(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	if st.Next != "B" || st.Last != -1 {
		t.Errorf("opening state = next %q last %d, want B / -1", st.Next, st.Last)
	}
	if n := len(g.LegalMoves(st)); n != size {
		t.Errorf("opening legal moves = %d, want %d", n, size)
	}
	if g.Terminal(st) != nil {
		t.Error("empty board should not be terminal")
	}
}

func TestApplyRecordsTheLastStone(t *testing.T) {
	g := New()
	after := g.Apply(g.Init(""), json.RawMessage(`{"cell":112}`)).(state)
	if after.Board[112] != "B" {
		t.Errorf("stone at 112 = %q, want B", after.Board[112])
	}
	if after.Last != 112 {
		t.Errorf("last = %d, want 112", after.Last)
	}
	if after.Next != "W" {
		t.Errorf("next = %q, want W", after.Next)
	}
	if n := len(g.LegalMoves(after)); n != size-1 {
		t.Errorf("legal moves = %d, want %d", n, size-1)
	}
}

func TestFiveInEveryDirectionWins(t *testing.T) {
	cases := []struct {
		name   string
		dr, dc int
		r, c   int
	}{
		{"horizontal", 0, 1, 4, 2},
		{"vertical", 1, 0, 2, 9},
		{"diagonal", 1, 1, 5, 5},
		{"anti-diagonal", 1, -1, 3, 12},
	}
	g := New()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// Four stones down, the fifth completes the line.
			stones := line(map[int]string{}, c.r, c.c, c.dr, c.dc, 4, "B")
			st := place("B", stones)
			fifth := at(c.r+c.dr*4, c.c+c.dc*4)
			if g.Terminal(st) != nil {
				t.Fatal("four in a row should not be terminal")
			}
			after := g.Apply(st, mustMove(t, fifth))
			res := g.Terminal(after)
			if res == nil || res.Kind != "win" || res.Winner != "B" {
				t.Fatalf("result = %+v, want a B win", res)
			}
			if res.Reason != "five in a row" {
				t.Errorf("reason = %q", res.Reason)
			}
			if g.ToMove(after) != "" {
				t.Error("finished game still has a side to move")
			}
			if n := len(g.LegalMoves(after)); n != 0 {
				t.Errorf("finished game offers %d moves", n)
			}
		})
	}
}

func TestOverlineStillWins(t *testing.T) {
	// Freestyle Gomoku has no overline rule: six in a row is a win, and so is
	// filling the gap in B B B _ B B.
	g := New()
	stones := line(map[int]string{}, 7, 2, 0, 1, 3, "B")
	stones[at(7, 6)] = "B"
	stones[at(7, 7)] = "B"
	st := place("B", stones)
	after := g.Apply(st, mustMove(t, at(7, 5)))
	res := g.Terminal(after)
	if res == nil || res.Winner != "B" {
		t.Fatalf("result = %+v, want a B win with six in a row", res)
	}
}

func TestFiveMustBeOneSeatsStones(t *testing.T) {
	// B B W B B is not a win for anyone.
	g := New()
	stones := map[int]string{
		at(7, 3): "B", at(7, 4): "B", at(7, 5): "W", at(7, 6): "B", at(7, 7): "B",
	}
	if res := g.Terminal(place("W", stones)); res != nil {
		t.Errorf("mixed line reported %+v", res)
	}
}

func TestOccupiedAndOutOfRangeRejected(t *testing.T) {
	g := New()
	st := g.Apply(g.Init(""), mustMove(t, 112))
	for _, tc := range []struct {
		move, reason string
	}{
		{`{"cell":112}`, "cell occupied"},
		{`{"cell":225}`, "cell out of range"},
		{`{"cell":-1}`, "cell out of range"},
		{`"nope"`, "cell out of range"},
	} {
		err := g.Validate(st, json.RawMessage(tc.move), "W")
		if err == nil || err.Error() != tc.reason {
			t.Errorf("Validate(%s) = %v, want %q", tc.move, err, tc.reason)
		}
	}
	if err := g.Validate(st, mustMove(t, 0), "B"); err == nil || err.Error() != "not your turn" {
		t.Errorf("out-of-turn Validate = %v", err)
	}
}

func TestHintsWarnAboutAnImmediateLoss(t *testing.T) {
	g := New().(spec.Rules)
	h, ok := g.(spec.Hinter)
	if !ok {
		t.Fatal("gomoku should implement spec.Hinter")
	}
	if got := h.Hints(g.Init("")); len(got) != 0 {
		t.Errorf("opening hints = %v, want none", got)
	}

	// W has four in a row with both ends open: B is told, and told it is lost.
	stones := line(map[int]string{}, 7, 5, 0, 1, 4, "W")
	got := h.Hints(place("B", stones))
	if len(got) != 1 {
		t.Fatalf("hints = %v, want one warning", got)
	}
	if !strings.Contains(got[0], "cannot block them all") {
		t.Errorf("hint = %q, want the double-threat wording", got[0])
	}

	// Blocked on one side: a single threat, and the hint names the point.
	stones[at(7, 4)] = "B"
	got = h.Hints(place("B", stones))
	if len(got) != 1 || !strings.Contains(got[0], "block it") {
		t.Fatalf("hints = %v, want a single-threat warning", got)
	}
	if !strings.Contains(got[0], "114") { // row 7, col 9
		t.Errorf("hint = %q, want it to name point 114", got[0])
	}
}

func TestDrawOnAFullBoard(t *testing.T) {
	g := New()
	// Colouring by ((r + 2c) % 4) < 2 caps every run — horizontal, vertical and
	// both diagonals — at two stones, so a full board has no five anywhere.
	var st state
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if (r+2*c)%4 < 2 {
				st.Board[at(r, c)] = "B"
			} else {
				st.Board[at(r, c)] = "W"
			}
		}
	}
	st.Next = "B"
	st.Last = size - 1
	res := g.Terminal(st)
	if res == nil || res.Kind != "draw" || res.Reason != "board full" {
		t.Fatalf("result = %+v, want a board-full draw", res)
	}
	if err := g.Validate(st, mustMove(t, 0), "B"); err == nil || err.Error() != "game over" {
		t.Errorf("Validate on a finished game = %v", err)
	}
}

func TestSerializeDeserializeRoundTrip(t *testing.T) {
	g := New()
	ser := g.Serialize(g.Init(""))
	if !strings.Contains(string(ser), `"next":"B"`) || !strings.Contains(string(ser), `"last":null`) {
		t.Errorf("opening serialize = %.80s…", ser)
	}
	if n := strings.Count(string(ser), "null"); n != size+1 { // 225 points + last
		t.Errorf("opening serialize null count = %d, want %d", n, size+1)
	}
	back, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	if string(g.Serialize(back)) != string(ser) {
		t.Error("opening roundtrip differs")
	}

	after := g.Apply(g.Init(""), mustMove(t, 112))
	ser2 := g.Serialize(after)
	if !strings.Contains(string(ser2), `"last":112`) {
		t.Errorf("serialize after a move = %.80s…", ser2)
	}
	back2, err := g.Deserialize(ser2)
	if err != nil {
		t.Fatalf("deserialize after move: %v", err)
	}
	st := back2.(state)
	if st.Board[112] != "B" || st.Next != "W" || st.Last != 112 {
		t.Errorf("roundtrip lost state: %q %q %d", st.Board[112], st.Next, st.Last)
	}
	if string(g.Serialize(st)) != string(ser2) {
		t.Error("re-serialize after roundtrip differs")
	}
}

func TestDeserializeRejectsBadState(t *testing.T) {
	g := New()
	full := func(mark string, extra string) string {
		cells := make([]string, size)
		for i := range cells {
			cells[i] = "null"
		}
		if mark != "" {
			cells[0] = `"` + mark + `"`
		}
		return `{"board":[` + strings.Join(cells, ",") + `],"next":"B"` + extra + `}`
	}
	bad := []string{
		``,
		`{"board":[],"next":"B"}`,
		full("X", ""),
		`{"board":[],"next":"G"}`,
		full("", `,"last":225`),
		full("", `,"last":-2`),
	}
	for _, s := range bad {
		if _, err := g.Deserialize(json.RawMessage(s)); err == nil {
			t.Errorf("Deserialize(%.40q) accepted a bad state", s)
		}
	}
	// A state with no "last" at all is fine — that is a fresh board.
	st, err := g.Deserialize(json.RawMessage(full("", "")))
	if err != nil {
		t.Fatalf("deserialize without last: %v", err)
	}
	if st.(state).Last != -1 {
		t.Errorf("missing last became %d, want -1", st.(state).Last)
	}
}

func mustMove(t *testing.T, cell int) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(move{Cell: cell})
	if err != nil {
		t.Fatalf("marshal move: %v", err)
	}
	return b
}
