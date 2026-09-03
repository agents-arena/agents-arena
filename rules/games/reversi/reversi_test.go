package reversi

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/agents-arena/agents-arena/rules/spec"
)

// testBoard builds a board from 8 rows of 8 runes, row 0 = top. '.' is empty.
func testBoard(t *testing.T, cells ...string) [size]string {
	t.Helper()
	if len(cells) != rows {
		t.Fatalf("need %d rows, got %d", rows, len(cells))
	}
	var b [size]string
	for r, row := range cells {
		if len(row) != cols {
			t.Fatalf("row %d: need %d cells, got %d", r, cols, len(row))
		}
		for c, ch := range row {
			if ch != '.' {
				b[r*cols+c] = string(ch)
			}
		}
	}
	return b
}

func TestInitIsTheStandardCross(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	if st.Board[27] != "W" || st.Board[28] != "B" || st.Board[35] != "B" || st.Board[36] != "W" {
		t.Errorf("opening cross wrong: %q %q %q %q", st.Board[27], st.Board[28], st.Board[35], st.Board[36])
	}
	if got := g.ToMove(st); got != "B" {
		t.Errorf("ToMove = %q, want B", got)
	}
	if n := len(g.LegalMoves(st)); n != 4 {
		t.Errorf("opening legal moves = %d, want 4", n)
	}
}

func TestApplyFlipsBracketedDiscs(t *testing.T) {
	g := New()
	st := g.Init("")
	// B plays d3 (row 2, col 3): the white disc on d4 is bracketed by d5.
	after := g.Apply(st, json.RawMessage(`{"cell":19}`)).(state)
	if after.Board[19] != "B" {
		t.Errorf("placed disc = %q, want B", after.Board[19])
	}
	if after.Board[27] != "B" {
		t.Errorf("d4 = %q, want flipped to B", after.Board[27])
	}
	if after.Board[36] != "W" {
		t.Errorf("e5 = %q, want untouched W", after.Board[36])
	}
	if after.Next != "W" {
		t.Errorf("next = %q, want W", after.Next)
	}
}

func TestFlipsAlongEveryRay(t *testing.T) {
	// One white disc bracketed by black, once per ray direction. "?" marks the
	// square black plays; it is empty on the board.
	cases := []struct {
		name string
		rows []string
		cell int
	}{
		{"north", []string{"...B....", "...W....", "...?....", "........", "........", "........", "........", "........"}, 2*cols + 3},
		{"south", []string{"...?....", "...W....", "...B....", "........", "........", "........", "........", "........"}, 3},
		{"east", []string{"...?WB..", "........", "........", "........", "........", "........", "........", "........"}, 3},
		{"west", []string{"...BW?..", "........", "........", "........", "........", "........", "........", "........"}, 5},
		{"southeast", []string{"...?....", "....W...", ".....B..", "........", "........", "........", "........", "........"}, 3},
		{"northwest", []string{".B......", "..W.....", "...?....", "........", "........", "........", "........", "........"}, 2*cols + 3},
		{"northeast", []string{"......B.", ".....W..", "....?...", "........", "........", "........", "........", "........"}, 2*cols + 4},
		{"southwest", []string{"....?...", "...W....", "..B.....", "........", "........", "........", "........", "........"}, 4},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rowsIn := make([]string, len(c.rows))
			for i, r := range c.rows {
				rowsIn[i] = strings.ReplaceAll(r, "?", ".")
			}
			b := testBoard(t, rowsIn...)
			got := flips(b, c.cell, "B")
			if len(got) != 1 {
				t.Fatalf("flips = %v, want exactly one capture", got)
			}
			if b[got[0]] != "W" {
				t.Errorf("captured %d holds %q, want W", got[0], b[got[0]])
			}
			// The same square is worthless to white — it flips nothing.
			if f := flips(b, c.cell, "W"); len(f) != 0 {
				t.Errorf("white flips %v from the same square, want none", f)
			}
		})
	}
}

func TestMoveMustFlipSomething(t *testing.T) {
	g := New()
	st := g.Init("")
	// a1 touches nothing.
	if err := g.Validate(st, json.RawMessage(`{"cell":0}`), "B"); err == nil || err.Error() != "no discs flipped" {
		t.Errorf("Validate = %v, want \"no discs flipped\"", err)
	}
	// A square that merely touches the cross diagonally brackets nothing (c6 =
	// row 2, col 2), even though its neighbours c5/d5 are the legal moves.
	if err := g.Validate(st, json.RawMessage(`{"cell":18}`), "B"); err == nil || err.Error() != "no discs flipped" {
		t.Errorf("Validate c6 = %v, want \"no discs flipped\"", err)
	}
}

func TestAutomaticPassKeepsTheTurn(t *testing.T) {
	g := New()
	// Black's move on the bottom row swallows both white discs there. The two
	// white stragglers are stranded — white has no legal reply — so black moves
	// again instead of the turn dying.
	st := state{
		Board: testBoard(t,
			"........",
			"....W...",
			"........",
			"........",
			"........",
			"........",
			"......W.",
			"....WWB.",
		),
		Next: "B",
	}
	if err := g.Validate(st, json.RawMessage(`{"cell":59}`), "B"); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	after := g.Apply(st, json.RawMessage(`{"cell":59}`)).(state)
	if hasMove(after.Board, "W") {
		t.Fatal("white should have no legal move in this position")
	}
	if after.Next != "B" {
		t.Errorf("next = %q, want B (white is skipped)", after.Next)
	}
	if res := g.Terminal(after); res != nil {
		t.Errorf("game should still be live while black can move: %+v", res)
	}
	if n := len(g.LegalMoves(after)); n == 0 {
		t.Error("black should still have moves after the skip")
	}
}

func TestHintsWarnWhenOpponentWillBeSkipped(t *testing.T) {
	g := New().(spec.Rules)
	h, ok := g.(spec.Hinter)
	if !ok {
		t.Fatal("reversi should implement spec.Hinter")
	}
	if got := h.Hints(g.Init("")); len(got) != 0 {
		t.Errorf("opening hints = %v, want none", got)
	}
	// White's two stragglers cannot move; black can, so black is warned that the
	// turn will come straight back.
	st := state{
		Board: testBoard(t,
			"........",
			"....W...",
			"........",
			"........",
			"........",
			"........",
			"......W.",
			"....BBBB",
		),
		Next: "B",
	}
	got := h.Hints(st)
	if len(got) != 1 || !strings.Contains(got[0], "no legal move") {
		t.Errorf("hints = %v, want a skip warning", got)
	}
}

func TestTerminalCountsDiscs(t *testing.T) {
	g := New()
	full := func(b, w int) state {
		var st state
		for i := 0; i < size; i++ {
			switch {
			case i < b:
				st.Board[i] = "B"
			case i < b+w:
				st.Board[i] = "W"
			}
		}
		st.Next = "B"
		return st
	}
	res := g.Terminal(full(40, 24))
	if res == nil || res.Kind != "win" || res.Winner != "B" {
		t.Errorf("40-24 = %+v, want a B win", res)
	}
	res = g.Terminal(full(24, 40))
	if res == nil || res.Kind != "win" || res.Winner != "W" {
		t.Errorf("24-40 = %+v, want a W win", res)
	}
	res = g.Terminal(full(32, 32))
	if res == nil || res.Kind != "draw" {
		t.Errorf("32-32 = %+v, want a draw", res)
	}
	if g.ToMove(full(32, 32)) != "" {
		t.Error("ToMove on a finished game should be empty")
	}
	if n := len(g.LegalMoves(full(32, 32))); n != 0 {
		t.Errorf("LegalMoves on a finished game = %d, want 0", n)
	}
}

func TestSerializeDeserializeRoundTrip(t *testing.T) {
	g := New()
	initSt := g.Init("")
	ser := g.Serialize(initSt)
	if !strings.Contains(string(ser), `"next":"B"`) {
		t.Errorf("initial serialize missing next B: %s", ser)
	}
	if !strings.Contains(string(ser), `"b":2`) || !strings.Contains(string(ser), `"w":2`) {
		t.Errorf("initial serialize missing 2-2 disc counts: %s", ser)
	}
	if n := strings.Count(string(ser), "null"); n != 60 {
		t.Errorf("initial serialize null count = %d, want 60", n)
	}

	back, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	if string(g.Serialize(back)) != string(ser) {
		t.Errorf("roundtrip mismatch: %s", g.Serialize(back))
	}

	after := g.Apply(initSt, json.RawMessage(`{"cell":19}`))
	ser2 := g.Serialize(after)
	back2, err := g.Deserialize(ser2)
	if err != nil {
		t.Fatalf("deserialize after move: %v", err)
	}
	st2 := back2.(state)
	if st2.Next != "W" || st2.Board[19] != "B" || st2.Board[27] != "B" {
		t.Errorf("roundtrip state wrong: next=%s [19]=%q [27]=%q", st2.Next, st2.Board[19], st2.Board[27])
	}
	if !strings.Contains(string(ser2), `"b":4`) || !strings.Contains(string(ser2), `"w":1`) {
		t.Errorf("serialize counts after d3 wrong: %s", ser2)
	}
}

func TestDeserializeRejectsBadState(t *testing.T) {
	g := New()
	bad := []string{
		``,
		`{"board":[],"next":"B"}`,
		`{"board":` + boardJSON("X") + `,"next":"B"}`,
		`{"board":` + boardJSON("") + `,"next":"G"}`,
	}
	for _, s := range bad {
		if _, err := g.Deserialize(json.RawMessage(s)); err == nil {
			t.Errorf("Deserialize(%.40q) = nil error, want a rejection", s)
		}
	}
}

// boardJSON renders 64 cells: all null, except cell 0 set to mark when non-empty.
func boardJSON(mark string) string {
	cells := make([]string, size)
	for i := range cells {
		cells[i] = "null"
	}
	if mark != "" {
		cells[0] = `"` + mark + `"`
	}
	return "[" + strings.Join(cells, ",") + "]"
}
