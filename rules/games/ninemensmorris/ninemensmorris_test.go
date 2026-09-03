package ninemensmorris

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/agents-arena/agents-arena/rules/spec"
)

// pos builds a state: men on the board, hands, and the seat to move.
func pos(next string, handW, handB int, men map[int]string) state {
	var st state
	for p, seat := range men {
		st.Board[p] = seat
	}
	st.Next = next
	st.HandW = handW
	st.HandB = handB
	return st
}

func place(to int) json.RawMessage {
	b, _ := json.Marshal(move{To: to})
	return b
}

func placeTake(to, remove int) json.RawMessage {
	b, _ := json.Marshal(move{To: to, Remove: &remove})
	return b
}

func slide(from, to int) json.RawMessage {
	b, _ := json.Marshal(move{From: &from, To: to})
	return b
}

func slideTake(from, to, remove int) json.RawMessage {
	b, _ := json.Marshal(move{From: &from, To: to, Remove: &remove})
	return b
}

func TestOpeningPosition(t *testing.T) {
	g := New()
	st := g.Init("").(state)
	if st.Next != "W" || st.HandW != menPerSide || st.HandB != menPerSide {
		t.Errorf("opening state = %q %d/%d", st.Next, st.HandW, st.HandB)
	}
	if n := len(g.LegalMoves(st)); n != points {
		t.Errorf("opening legal moves = %d, want %d (one per empty point)", n, points)
	}
	if g.Terminal(st) != nil {
		t.Error("an empty board should not be terminal")
	}
}

func TestBoardTopologyIsSymmetricAndComplete(t *testing.T) {
	// Adjacency must be mutual, and every point must sit on exactly two mills:
	// one along each of its ring and its spoke.
	for p := 0; p < points; p++ {
		for _, n := range neighbours[p] {
			if !adjacent(n, p) {
				t.Errorf("%d lists %d as a neighbour but not the other way round", p, n)
			}
		}
		lines := 0
		for _, m := range mills {
			if m[0] == p || m[1] == p || m[2] == p {
				lines++
			}
		}
		if lines != 2 {
			t.Errorf("point %d belongs to %d mills, want 2", p, lines)
		}
	}
	if len(mills) != 16 {
		t.Errorf("mills = %d, want 16", len(mills))
	}
}

func TestPlacementPhaseRules(t *testing.T) {
	g := New()
	st := g.Init("")
	if err := g.Validate(st, place(0), "W"); err != nil {
		t.Errorf("placing on an empty point: %v", err)
	}
	if err := g.Validate(st, slide(0, 1), "W"); err == nil ||
		err.Error() != "place a man before moving one" {
		t.Errorf("sliding during placement = %v", err)
	}
	after := g.Apply(st, place(0)).(state)
	if after.HandW != menPerSide-1 || after.Board[0] != "W" || after.Next != "B" {
		t.Fatalf("after placing: hand %d board[0] %q next %q", after.HandW, after.Board[0], after.Next)
	}
	if err := g.Validate(after, place(0), "B"); err == nil || err.Error() != "point occupied" {
		t.Errorf("placing on an occupied point = %v", err)
	}
}

func TestClosingAMillRemovesAMan(t *testing.T) {
	g := New()
	// White has two of the top row and a man in hand; placing the third closes
	// the mill 0-1-2 and must name a black man to remove.
	st := pos("W", 1, 1, map[int]string{0: "W", 1: "W", 9: "B", 10: "B"})
	if err := g.Validate(st, place(2), "W"); err == nil ||
		!strings.Contains(err.Error(), "name the man to remove") {
		t.Errorf("closing a mill without a removal = %v", err)
	}
	if err := g.Validate(st, placeTake(2, 9), "W"); err != nil {
		t.Errorf("closing a mill with a removal: %v", err)
	}
	if err := g.Validate(st, placeTake(2, 0), "W"); err == nil ||
		err.Error() != "no opposing man on that point" {
		t.Errorf("removing your own man = %v", err)
	}
	after := g.Apply(st, placeTake(2, 9)).(state)
	if after.Board[2] != "W" || after.Board[9] != "" {
		t.Errorf("after the mill: [2]=%q [9]=%q", after.Board[2], after.Board[9])
	}
	if after.Idle != 0 {
		t.Errorf("idle = %d, want 0 — a mill is progress", after.Idle)
	}
}

func TestRemovalWithoutAMillIsRefused(t *testing.T) {
	g := New()
	st := pos("W", 5, 5, map[int]string{0: "W", 9: "B"})
	if err := g.Validate(st, placeTake(1, 9), "W"); err == nil ||
		err.Error() != "that move does not close a mill" {
		t.Errorf("removing without a mill = %v", err)
	}
}

func TestMenInMillsAreProtectedUnlessAllAre(t *testing.T) {
	g := New()
	// Black's men on 9-10-11 are a mill; the man on 21 is not, so it is the
	// only legal target.
	st := pos("W", 1, 0, map[int]string{
		0: "W", 1: "W", 4: "W", 7: "W",
		9: "B", 10: "B", 11: "B", 21: "B",
	})
	if err := g.Validate(st, placeTake(2, 9), "W"); err == nil ||
		!strings.Contains(err.Error(), "in a mill") {
		t.Errorf("taking a man inside a mill = %v", err)
	}
	if err := g.Validate(st, placeTake(2, 21), "W"); err != nil {
		t.Errorf("taking the loose man: %v", err)
	}

	// With every black man inside a mill, the protection lifts.
	all := pos("W", 1, 0, map[int]string{
		0: "W", 1: "W", 4: "W", 7: "W",
		9: "B", 10: "B", 11: "B",
	})
	if err := g.Validate(all, placeTake(2, 9), "W"); err != nil {
		t.Errorf("taking from an all-mill position: %v", err)
	}
}

func TestMovementPhaseNeedsAdjacency(t *testing.T) {
	g := New()
	st := pos("W", 0, 0, map[int]string{
		0: "W", 4: "W", 9: "W", 21: "W",
		2: "B", 5: "B", 14: "B", 23: "B",
	})
	if err := g.Validate(st, slide(0, 1), "W"); err != nil {
		t.Errorf("sliding to an adjacent point: %v", err)
	}
	if err := g.Validate(st, slide(0, 22), "W"); err == nil ||
		err.Error() != "points are not adjacent" {
		t.Errorf("sliding across the board = %v", err)
	}
	if err := g.Validate(st, slide(2, 1), "W"); err == nil ||
		err.Error() != "no man of yours on that point" {
		t.Errorf("moving the opponent's man = %v", err)
	}
	if err := g.Validate(st, place(1), "W"); err == nil ||
		err.Error() != "you have no men left to place" {
		t.Errorf("placing with an empty hand = %v", err)
	}
}

func TestThreeMenMayFly(t *testing.T) {
	g := New()
	st := pos("W", 0, 0, map[int]string{
		0: "W", 4: "W", 21: "W",
		2: "B", 5: "B", 14: "B", 23: "B",
	})
	if err := g.Validate(st, slide(0, 19), "W"); err != nil {
		t.Errorf("flying with three men: %v", err)
	}
	// A fourth man grounds them again.
	grounded := pos("W", 0, 0, map[int]string{
		0: "W", 4: "W", 21: "W", 9: "W",
		2: "B", 5: "B", 14: "B", 23: "B",
	})
	if err := g.Validate(grounded, slide(0, 19), "W"); err == nil ||
		err.Error() != "points are not adjacent" {
		t.Errorf("flying with four men = %v", err)
	}
}

func TestLosingTheThirdManEndsTheGame(t *testing.T) {
	g := New()
	// Black is down to three; white slides 22 to 21, closing the mill 0-9-21,
	// and takes one of them.
	st := pos("W", 0, 0, map[int]string{
		0: "W", 9: "W", 22: "W", 12: "W",
		18: "B", 19: "B", 20: "B",
	})
	if err := g.Validate(st, slideTake(22, 21, 19), "W"); err != nil {
		t.Fatalf("the winning move was refused: %v", err)
	}
	after := g.Apply(st, slideTake(22, 21, 19)).(state)
	res := g.Terminal(after)
	if res == nil || res.Kind != "win" || res.Winner != "W" {
		t.Fatalf("result = %+v, want a white win", res)
	}
	if res.Reason != "reduced to two men" {
		t.Errorf("reason = %q", res.Reason)
	}
	if g.ToMove(after) != "" {
		t.Error("a finished game still reports a side to move")
	}
	if n := len(g.LegalMoves(after)); n != 0 {
		t.Errorf("a finished game offers %d moves", n)
	}
}

func TestBeingBlockedLosesTheGame(t *testing.T) {
	g := New()
	// White's four men are all walled in; with nowhere to go, white loses.
	st := pos("W", 0, 0, map[int]string{
		0: "W", 1: "W", 2: "W", 4: "W",
		9: "B", 14: "B", 7: "B", 3: "B", 5: "B",
	})
	if n := len(moveList(st)); n != 0 {
		t.Fatalf("test position leaves %d moves: %+v", n, moveList(st))
	}
	res := g.Terminal(st)
	if res == nil || res.Winner != "B" || res.Reason != "no moves left" {
		t.Fatalf("result = %+v, want a black win by blocking", res)
	}
}

func TestNoMillsDrawsTheGame(t *testing.T) {
	g := New()
	st := pos("W", 0, 0, map[int]string{
		0: "W", 4: "W", 9: "W", 21: "W",
		2: "B", 5: "B", 14: "B", 23: "B",
	})
	st.Idle = idleLimit
	res := g.Terminal(st)
	if res == nil || res.Kind != "draw" || res.Reason != "no mills" {
		t.Fatalf("result = %+v, want a no-mill draw", res)
	}
	// A quiet move climbs the counter; a mill resets it (covered above).
	st.Idle = 3
	if got := g.Apply(st, slide(0, 1)).(state).Idle; got != 4 {
		t.Errorf("idle after a quiet move = %d, want 4", got)
	}
}

func TestLegalMovesEnumerateRemovals(t *testing.T) {
	g := New()
	// Placing on 2 closes a mill; black has two loose men, so /legal must offer
	// both removals as separate moves.
	st := pos("W", 1, 0, map[int]string{0: "W", 1: "W", 9: "B", 12: "B", 20: "B"})
	var withMill int
	for _, raw := range g.LegalMoves(st) {
		var m move
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("legal move %s: %v", raw, err)
		}
		if m.To == 2 {
			if m.Remove == nil {
				t.Errorf("mill-closing move %s has no removal", raw)
			}
			withMill++
		}
		if err := g.Validate(st, raw, "W"); err != nil {
			t.Errorf("advertised move %s refused: %v", raw, err)
		}
	}
	if withMill != 3 {
		t.Errorf("mill-closing moves = %d, want 3 (one per removable man)", withMill)
	}
}

func TestHints(t *testing.T) {
	g := New().(spec.Rules)
	h, ok := g.(spec.Hinter)
	if !ok {
		t.Fatal("nine-mens-morris should implement spec.Hinter")
	}
	got := h.Hints(g.Init(""))
	if len(got) != 1 || !strings.Contains(got[0], "placement phase") {
		t.Fatalf("opening hints = %v, want the placement hint", got)
	}
	flying := pos("W", 0, 0, map[int]string{0: "W", 4: "W", 21: "W", 2: "B", 5: "B", 14: "B"})
	got = h.Hints(flying)
	if len(got) != 1 || !strings.Contains(got[0], "fly") {
		t.Fatalf("hints = %v, want the flying hint", got)
	}
	idle := flying
	idle.Idle = idleLimit - 4
	got = h.Hints(idle)
	if len(got) != 2 || !strings.Contains(got[1], "drawn in 4") {
		t.Fatalf("hints = %v, want the draw countdown too", got)
	}
}

func TestSerializeDeserializeRoundTrip(t *testing.T) {
	g := New()
	ser := g.Serialize(g.Init(""))
	for _, want := range []string{`"next":"W"`, `"handW":9`, `"handB":9`, `"idle":0`} {
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

	mid := g.Apply(g.Init(""), place(4))
	ser2 := g.Serialize(mid)
	if !strings.Contains(string(ser2), `"handW":8`) {
		t.Errorf("serialize after a placement = %s", ser2)
	}
	back2, err := g.Deserialize(ser2)
	if err != nil {
		t.Fatalf("deserialize mid-game: %v", err)
	}
	if string(g.Serialize(back2)) != string(ser2) {
		t.Error("mid-game roundtrip differs")
	}
}

func TestDeserializeRejectsBadState(t *testing.T) {
	g := New()
	cells := func(overrides map[int]string) string {
		out := make([]string, points)
		for i := range out {
			out[i] = "null"
		}
		for i, v := range overrides {
			out[i] = `"` + v + `"`
		}
		return "[" + strings.Join(out, ",") + "]"
	}
	full := map[int]string{}
	for i := 0; i < 10; i++ {
		full[i] = "W"
	}
	bad := []string{
		``,
		`{"board":[],"next":"W","handW":9,"handB":9,"idle":0}`,
		`{"board":` + cells(map[int]string{0: "X"}) + `,"next":"W","handW":9,"handB":9,"idle":0}`,
		`{"board":` + cells(nil) + `,"next":"Z","handW":9,"handB":9,"idle":0}`,
		`{"board":` + cells(nil) + `,"next":"W","handW":10,"handB":9,"idle":0}`,
		`{"board":` + cells(nil) + `,"next":"W","handW":9,"handB":9,"idle":-1}`,
		// Ten white men on the board plus men in hand is more than nine.
		`{"board":` + cells(full) + `,"next":"W","handW":1,"handB":9,"idle":0}`,
	}
	for _, s := range bad {
		if _, err := g.Deserialize(json.RawMessage(s)); err == nil {
			t.Errorf("Deserialize(%.60q) accepted a bad state", s)
		}
	}
}
