package dotsandboxes

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/agents-arena/agents-arena/rules/spec"
)

// draw applies a sequence of edges through the real Rules, so the tests exercise
// Apply's turn and claim logic rather than a private shortcut.
func draw(t *testing.T, st state, edges ...int) state {
	t.Helper()
	g := New()
	for _, e := range edges {
		mv, _ := json.Marshal(move{Edge: e})
		if err := g.Validate(st, mv, st.Next); err != nil {
			t.Fatalf("edge %d refused: %v", e, err)
		}
		st = g.Apply(st, mv).(state)
	}
	return st
}

func TestOpeningPosition(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	if st.Next != "A" {
		t.Errorf("opening seat = %q, want A", st.Next)
	}
	if n := len(g.LegalMoves(st)); n != numEdges {
		t.Errorf("opening legal moves = %d, want %d", n, numEdges)
	}
	if g.Terminal(st) != nil {
		t.Error("an empty grid should not be terminal")
	}
}

func TestEdgeIndexingCoversTheGrid(t *testing.T) {
	// Every edge belongs to one or two boxes, and every box names four distinct
	// edges that name it back.
	seen := map[int]int{}
	for box := 0; box < numBoxes; box++ {
		edges := boxEdges(box)
		uniq := map[int]bool{}
		for _, e := range edges {
			if e < 0 || e >= numEdges {
				t.Fatalf("box %d has out-of-range edge %d", box, e)
			}
			uniq[e] = true
			seen[e]++
			found := false
			for _, b := range boxesTouching(e) {
				if b == box {
					found = true
				}
			}
			if !found {
				t.Errorf("edge %d does not report box %d", e, box)
			}
		}
		if len(uniq) != 4 {
			t.Errorf("box %d has duplicate edges: %v", box, edges)
		}
	}
	for e := 0; e < numEdges; e++ {
		n := len(boxesTouching(e))
		if n != 1 && n != 2 {
			t.Errorf("edge %d touches %d boxes", e, n)
		}
		if seen[e] != n {
			t.Errorf("edge %d claimed by %d boxes, touches %d", e, seen[e], n)
		}
	}
}

func TestClosingABoxClaimsItAndKeepsTheTurn(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	// A draws three sides of box 0; each of those passes the turn, so the
	// sequence alternates and B ends up with the fourth side available.
	st = draw(t, st, hEdge(0, 0), hEdge(3, 3), hEdge(1, 0), vEdge(3, 0), vEdge(0, 0))
	if st.Next != "B" {
		t.Fatalf("seat = %q, want B on move", st.Next)
	}
	if got := drawnSides(st.Edges, 0); got != 3 {
		t.Fatalf("box 0 has %d sides, want 3", got)
	}
	after := draw(t, st, vEdge(0, 1))
	if after.Boxes[0] != "B" {
		t.Errorf("box 0 claimed by %q, want B", after.Boxes[0])
	}
	if after.Next != "B" {
		t.Errorf("next = %q, want B again — closing a box keeps the turn", after.Next)
	}
	a, b := scores(after.Boxes)
	if a != 0 || b != 1 {
		t.Errorf("scores = A %d / B %d, want 0/1", a, b)
	}
}

func TestOneEdgeCanCloseTwoBoxes(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	// Open boxes 0 and 1 on three sides each, sharing the vertical edge between
	// them, then close both with that single edge.
	shared := vEdge(0, 1)
	edges := []int{
		hEdge(0, 0), hEdge(1, 0), vEdge(0, 0), // box 0 minus `shared`
		hEdge(0, 1), hEdge(1, 1), vEdge(0, 2), // box 1 minus `shared`
	}
	st = draw(t, st, edges...)
	mover := st.Next
	after := draw(t, st, shared)
	if after.Boxes[0] != mover || after.Boxes[1] != mover {
		t.Errorf("boxes = %q/%q, want both %q", after.Boxes[0], after.Boxes[1], mover)
	}
	if after.Next != mover {
		t.Errorf("next = %q, want %q", after.Next, mover)
	}
}

func TestRejections(t *testing.T) {
	g := New()
	st := draw(t, g.Init("").(state), 0)
	for _, tc := range []struct{ move, reason string }{
		{`{"edge":0}`, "edge already drawn"},
		{`{"edge":40}`, "edge out of range"},
		{`{"edge":-1}`, "edge out of range"},
		{`"nope"`, "edge out of range"},
	} {
		if err := g.Validate(st, json.RawMessage(tc.move), "B"); err == nil || err.Error() != tc.reason {
			t.Errorf("Validate(%s) = %v, want %q", tc.move, err, tc.reason)
		}
	}
	if err := g.Validate(st, json.RawMessage(`{"edge":5}`), "A"); err == nil || err.Error() != "not your turn" {
		t.Errorf("out-of-turn Validate = %v", err)
	}
}

func TestHints(t *testing.T) {
	g := New().(spec.Rules)
	h, ok := g.(spec.Hinter)
	if !ok {
		t.Fatal("dots-and-boxes should implement spec.Hinter")
	}
	if got := h.Hints(g.Init("")); len(got) != 0 {
		t.Errorf("opening hints = %v, want none", got)
	}

	// A box on three sides: the side to move is told there is a box to claim.
	var st state
	st.Next = "A"
	st.Edges[hEdge(0, 0)] = "A"
	st.Edges[hEdge(1, 0)] = "B"
	st.Edges[vEdge(0, 0)] = "A"
	got := h.Hints(st)
	if len(got) != 1 || !strings.Contains(got[0], "claim 1 box") {
		t.Fatalf("hints = %v, want a claimable-box hint", got)
	}

	// A grid where every remaining edge opens a box: the zugzwang warning.
	var z state
	z.Next = "B"
	for e := 0; e < numEdges; e++ {
		z.Edges[e] = "A"
	}
	// Rub out every vertical edge of the top box-row: those four boxes drop to
	// two sides each, so no remaining edge closes anything and each one leaves a
	// three-sided box for the opponent.
	for c := 0; c < dots; c++ {
		z.Edges[vEdge(0, c)] = ""
	}
	for b := 0; b < numBoxes; b++ {
		if boxComplete(z.Edges, b) {
			z.Boxes[b] = "A"
		}
	}
	got = h.Hints(z)
	if len(got) != 1 || !strings.Contains(got[0], "opens a box") {
		t.Fatalf("hints = %v, want the zugzwang warning", got)
	}
}

func TestTerminalScoresTheBoxes(t *testing.T) {
	g := New()
	full := func(a, b int) state {
		var st state
		for e := 0; e < numEdges; e++ {
			st.Edges[e] = "A"
		}
		for i := 0; i < numBoxes; i++ {
			switch {
			case i < a:
				st.Boxes[i] = "A"
			case i < a+b:
				st.Boxes[i] = "B"
			}
		}
		st.Next = "A"
		return st
	}
	if res := g.Terminal(full(9, 7)); res == nil || res.Winner != "A" || res.Reason != "more boxes" {
		t.Errorf("9-7 = %+v, want an A win", res)
	}
	if res := g.Terminal(full(7, 9)); res == nil || res.Winner != "B" {
		t.Errorf("7-9 = %+v, want a B win", res)
	}
	res := g.Terminal(full(8, 8))
	if res == nil || res.Kind != "draw" || res.Reason != "boxes split evenly" {
		t.Errorf("8-8 = %+v, want a draw", res)
	}
	if g.ToMove(full(8, 8)) != "" {
		t.Error("a finished grid still reports a side to move")
	}
	if n := len(g.LegalMoves(full(8, 8))); n != 0 {
		t.Errorf("a finished grid offers %d moves", n)
	}
}

func TestSerializeDeserializeRoundTrip(t *testing.T) {
	g := New()
	ser := g.Serialize(g.Init(""))
	for _, want := range []string{`"next":"A"`, `"a":0`, `"b":0`} {
		if !strings.Contains(string(ser), want) {
			t.Errorf("opening serialize missing %s: %s", want, ser)
		}
	}
	back, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	if string(g.Serialize(back)) != string(ser) {
		t.Error("opening roundtrip differs")
	}

	st := draw(t, g.Init("").(state),
		hEdge(0, 0), hEdge(3, 3), hEdge(1, 0), vEdge(3, 0), vEdge(0, 0), vEdge(0, 1))
	ser2 := g.Serialize(st)
	if !strings.Contains(string(ser2), `"b":1`) {
		t.Errorf("serialize after a claim = %s", ser2)
	}
	back2, err := g.Deserialize(ser2)
	if err != nil {
		t.Fatalf("deserialize mid-game: %v", err)
	}
	if string(g.Serialize(back2)) != string(ser2) {
		t.Error("mid-game roundtrip differs")
	}
}

func TestDeserializeRejectsInconsistentState(t *testing.T) {
	g := New()
	nulls := func(n int) string { return "[" + strings.TrimSuffix(strings.Repeat("null,", n), ",") + "]" }
	base := `{"edges":` + nulls(numEdges) + `,"boxes":` + nulls(numBoxes) + `,"next":"A"}`
	if _, err := g.Deserialize(json.RawMessage(base)); err != nil {
		t.Fatalf("empty grid should deserialize: %v", err)
	}
	bad := []string{
		``,
		`{"edges":[],"boxes":` + nulls(numBoxes) + `,"next":"A"}`,
		`{"edges":` + nulls(numEdges) + `,"boxes":[],"next":"A"}`,
		`{"edges":` + nulls(numEdges) + `,"boxes":` + nulls(numBoxes) + `,"next":"Z"}`,
		// A box claimed without its four edges drawn — Apply could never produce
		// this, and Terminal would score a grid nobody closed.
		`{"edges":` + nulls(numEdges) + `,"boxes":["A"` + strings.Repeat(",null", numBoxes-1) + `],"next":"A"}`,
	}
	for _, s := range bad {
		if _, err := g.Deserialize(json.RawMessage(s)); err == nil {
			t.Errorf("Deserialize(%.50q) accepted a bad state", s)
		}
	}
}
