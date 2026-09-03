package hex

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/agents-arena/agents-arena/rules/spec"
)

func at(r, c int) int { return r*cols + c }

func mv(cell int) json.RawMessage {
	b, _ := json.Marshal(move{Cell: cell})
	return b
}

// board builds a position from 11 rows of 11 runes: '.' empty, R/B stones.
func board(t *testing.T, next string, rowsIn ...string) state {
	t.Helper()
	if len(rowsIn) != rows {
		t.Fatalf("need %d rows, got %d", rows, len(rowsIn))
	}
	var st state
	for r, row := range rowsIn {
		if len(row) != cols {
			t.Fatalf("row %d: need %d cells, got %d", r, cols, len(row))
		}
		for c, ch := range row {
			if ch != '.' {
				st.Board[at(r, c)] = string(ch)
			}
		}
	}
	st.Next = next
	st.Last = -1
	return st
}

func blank() []string {
	out := make([]string, rows)
	for i := range out {
		out[i] = strings.Repeat(".", cols)
	}
	return out
}

func put(rowsIn []string, r, c int, seat string) {
	rowsIn[r] = rowsIn[r][:c] + seat + rowsIn[r][c+1:]
}

func TestOpeningPosition(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	if st.Next != "R" || st.Last != -1 {
		t.Errorf("opening state = %q / %d, want R / -1", st.Next, st.Last)
	}
	if n := len(g.LegalMoves(st)); n != size {
		t.Errorf("opening legal moves = %d, want %d", n, size)
	}
	if g.Terminal(st) != nil {
		t.Error("an empty board should not be terminal")
	}
}

func TestNeighboursAreTheHexSix(t *testing.T) {
	// A cell in the middle has six neighbours; the north-west and south-east
	// diagonals are NOT among them, which is what makes this Hex and not chess.
	mid := at(5, 5)
	got := map[int]bool{}
	for _, n := range neighbours(mid) {
		got[n] = true
	}
	want := []int{at(5, 4), at(5, 6), at(4, 5), at(6, 5), at(4, 6), at(6, 4)}
	if len(got) != len(want) {
		t.Fatalf("neighbours(mid) = %d cells, want 6", len(got))
	}
	for _, w := range want {
		if !got[w] {
			t.Errorf("missing neighbour %d", w)
		}
	}
	for _, notNeighbour := range []int{at(4, 4), at(6, 6)} {
		if got[notNeighbour] {
			t.Errorf("cell %d should not be adjacent on a hex grid", notNeighbour)
		}
	}
	// On a rhombus the two acute corners have two neighbours and the two obtuse
	// ones have three; an edge cell has four.
	if n := len(neighbours(at(0, 0))); n != 2 {
		t.Errorf("acute corner has %d neighbours, want 2", n)
	}
	if n := len(neighbours(at(0, cols-1))); n != 3 {
		t.Errorf("obtuse corner has %d neighbours, want 3", n)
	}
	if n := len(neighbours(at(0, 5))); n != 4 {
		t.Errorf("top edge has %d neighbours, want 4", n)
	}
}

func TestStraightConnectionWins(t *testing.T) {
	g := New()
	// Red fills row 5 except the last cell: not connected until it lands.
	rowsIn := blank()
	for c := 0; c < cols-1; c++ {
		put(rowsIn, 5, c, "R")
	}
	st := board(t, "R", rowsIn...)
	if g.Terminal(st) != nil {
		t.Fatal("an unfinished chain should not win")
	}
	after := g.Apply(st, mv(at(5, cols-1)))
	res := g.Terminal(after)
	if res == nil || res.Winner != "R" || res.Reason != "connected left to right" {
		t.Fatalf("result = %+v, want a red win", res)
	}
	if g.ToMove(after) != "" {
		t.Error("a finished game still reports a side to move")
	}
	if n := len(g.LegalMoves(after)); n != 0 {
		t.Errorf("a finished game offers %d moves", n)
	}
}

func TestBlueConnectsTopToBottom(t *testing.T) {
	g := New()
	rowsIn := blank()
	for r := 0; r < rows-1; r++ {
		put(rowsIn, r, 3, "B")
	}
	st := board(t, "B", rowsIn...)
	if g.Terminal(st) != nil {
		t.Fatal("an unfinished chain should not win")
	}
	after := g.Apply(st, mv(at(rows-1, 3)))
	res := g.Terminal(after)
	if res == nil || res.Winner != "B" || res.Reason != "connected top to bottom" {
		t.Fatalf("result = %+v, want a blue win", res)
	}
}

func TestDiagonalChainConnects(t *testing.T) {
	// A staircase using the north-east adjacency: (r, c) touches (r-1, c+1).
	rowsIn := blank()
	r, c := rows-1, 0
	for c < cols {
		put(rowsIn, r, c, "R")
		if r > 0 {
			r--
		}
		c++
	}
	st := board(t, "B", rowsIn...)
	if !connected(st.Board, "R") {
		t.Error("a north-east staircase should connect red's edges")
	}
}

func TestBrokenChainDoesNotConnect(t *testing.T) {
	// The same row with one gap: adjacent-but-one is not adjacent.
	rowsIn := blank()
	for c := 0; c < cols; c++ {
		if c == 5 {
			continue
		}
		put(rowsIn, 5, c, "R")
	}
	st := board(t, "R", rowsIn...)
	if connected(st.Board, "R") {
		t.Error("a chain with a hole in it should not connect")
	}
	// The wrong diagonal does not join either.
	rowsIn = blank()
	put(rowsIn, 4, 4, "R")
	put(rowsIn, 5, 5, "R")
	st = board(t, "R", rowsIn...)
	seen := false
	for _, n := range neighbours(at(4, 4)) {
		if n == at(5, 5) {
			seen = true
		}
	}
	if seen {
		t.Error("(4,4) and (5,5) must not be adjacent")
	}
}

func TestHexIsNeverDrawn(t *testing.T) {
	// Fill the board with a pattern and check exactly one side has connected —
	// the defining property of Hex.
	var st state
	for i := 0; i < size; i++ {
		if (i/cols+i%cols)%3 == 0 {
			st.Board[i] = "B"
		} else {
			st.Board[i] = "R"
		}
	}
	st.Next = "R"
	r, b := connected(st.Board, "R"), connected(st.Board, "B")
	if r == b {
		t.Fatalf("a full board must have exactly one winner: red %v, blue %v", r, b)
	}
	if res := New().Terminal(st); res == nil || res.Kind != "win" {
		t.Fatalf("result = %+v, want a win", res)
	}
}

func TestRejections(t *testing.T) {
	g := New()
	st := g.Apply(g.Init(""), mv(at(5, 5)))
	for _, tc := range []struct{ move, reason string }{
		{`{"cell":60}`, "cell occupied"},
		{`{"cell":121}`, "cell out of range"},
		{`{"cell":-1}`, "cell out of range"},
		{`"nope"`, "cell out of range"},
	} {
		if err := g.Validate(st, json.RawMessage(tc.move), "B"); err == nil || err.Error() != tc.reason {
			t.Errorf("Validate(%s) = %v, want %q", tc.move, err, tc.reason)
		}
	}
	if err := g.Validate(st, mv(0), "R"); err == nil || err.Error() != "not your turn" {
		t.Errorf("out-of-turn Validate = %v", err)
	}
}

func TestHintsWarnAboutAnImminentConnection(t *testing.T) {
	g := New().(spec.Rules)
	h, ok := g.(spec.Hinter)
	if !ok {
		t.Fatal("hex should implement spec.Hinter")
	}
	if got := h.Hints(g.Init("")); len(got) != 0 {
		t.Errorf("opening hints = %v, want none", got)
	}

	// Red is one cell from connecting; blue is told exactly which one.
	rowsIn := blank()
	for c := 0; c < cols; c++ {
		if c == 5 {
			continue
		}
		put(rowsIn, 5, c, "R")
	}
	st := board(t, "B", rowsIn...)
	got := h.Hints(st)
	if len(got) != 1 || !strings.Contains(got[0], "block it") {
		t.Fatalf("hints = %v, want a single-threat warning", got)
	}
	if !strings.Contains(got[0], strings.TrimSpace(itoa(at(5, 5)))) {
		t.Errorf("hint = %q, want it to name cell %d", got[0], at(5, 5))
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestSerializeDeserializeRoundTrip(t *testing.T) {
	g := New()
	ser := g.Serialize(g.Init(""))
	if !strings.Contains(string(ser), `"next":"R"`) || !strings.Contains(string(ser), `"last":null`) {
		t.Errorf("opening serialize = %.80s…", ser)
	}
	back, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	if string(g.Serialize(back)) != string(ser) {
		t.Error("opening roundtrip differs")
	}

	after := g.Apply(g.Init(""), mv(at(5, 5)))
	ser2 := g.Serialize(after)
	if !strings.Contains(string(ser2), `"last":60`) {
		t.Errorf("serialize after a move = %.90s…", ser2)
	}
	back2, err := g.Deserialize(ser2)
	if err != nil {
		t.Fatalf("deserialize after move: %v", err)
	}
	st := back2.(state)
	if st.Board[at(5, 5)] != "R" || st.Next != "B" || st.Last != at(5, 5) {
		t.Errorf("roundtrip lost state: %q %q %d", st.Board[at(5, 5)], st.Next, st.Last)
	}
}

func TestDeserializeRejectsBadState(t *testing.T) {
	g := New()
	cells := func(first string) string {
		out := make([]string, size)
		for i := range out {
			out[i] = "null"
		}
		if first != "" {
			out[0] = `"` + first + `"`
		}
		return "[" + strings.Join(out, ",") + "]"
	}
	bad := []string{
		``,
		`{"board":[],"next":"R"}`,
		`{"board":` + cells("X") + `,"next":"R"}`,
		`{"board":` + cells("") + `,"next":"Z"}`,
		`{"board":` + cells("") + `,"next":"R","last":121}`,
	}
	for _, s := range bad {
		if _, err := g.Deserialize(json.RawMessage(s)); err == nil {
			t.Errorf("Deserialize(%.50q) accepted a bad state", s)
		}
	}
}
