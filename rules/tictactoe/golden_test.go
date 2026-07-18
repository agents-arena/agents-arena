package tictactoe

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules"
)

type goldenCase struct {
	Name              string               `json:"name"`
	State             json.RawMessage      `json:"state"`
	Seat              string               `json:"seat"`
	Move              json.RawMessage      `json:"move"`
	ExpectValid       bool                 `json:"expectValid"`
	ExpectReason      string               `json:"expectReason,omitempty"`
	ExpectResultAfter *protocol.GameResult `json:"expectResultAfter"`
}

func loadGolden(t *testing.T) []goldenCase {
	t.Helper()
	// testdata is sibling to tictactoe/
	path := filepath.Join("..", "testdata", "tic-tac-toe.golden.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read golden: %v", err)
	}
	var cases []goldenCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("failed to parse golden: %v", err)
	}
	return cases
}

func TestGoldenVectors(t *testing.T) {
	g := New().(rules.Rules) // the registered impl
	cases := loadGolden(t)

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			st, err := g.Deserialize(c.State)
			if err != nil {
				t.Fatalf("deserialize failed: %v (state=%s)", err, c.State)
			}

			valErr := g.Validate(st, c.Move, c.Seat)
			valid := valErr == nil

			if valid != c.ExpectValid {
				t.Errorf("Validate valid=%v, want %v (err=%v)", valid, c.ExpectValid, valErr)
			}
			if !valid {
				if valErr == nil || valErr.Error() != c.ExpectReason {
					got := ""
					if valErr != nil {
						got = valErr.Error()
					}
					t.Errorf("reason=%q, want %q", got, c.ExpectReason)
				}
				return
			}

			// valid: apply and check terminal
			after := g.Apply(st, c.Move)
			gotRes := g.Terminal(after)

			if c.ExpectResultAfter == nil {
				if gotRes != nil {
					t.Errorf("unexpected terminal after apply: %+v", gotRes)
				}
				return
			}

			if gotRes == nil {
				t.Fatalf("expected terminal result after apply, got nil")
			}
			if gotRes.Kind != c.ExpectResultAfter.Kind {
				t.Errorf("result.kind=%q, want %q", gotRes.Kind, c.ExpectResultAfter.Kind)
			}
			if gotRes.Winner != c.ExpectResultAfter.Winner {
				t.Errorf("result.winner=%q, want %q", gotRes.Winner, c.ExpectResultAfter.Winner)
			}
			// reason optional in some expects
			if c.ExpectResultAfter.Reason != "" && gotRes.Reason != c.ExpectResultAfter.Reason {
				t.Errorf("result.reason=%q, want %q", gotRes.Reason, c.ExpectResultAfter.Reason)
			}
		})
	}
}

func TestLegalMovesShrinks(t *testing.T) {
	g := New().(rules.Rules)

	stIface := g.Init("")
	st := stIface.(state)

	moves0 := g.LegalMoves(st)
	if len(moves0) != 9 {
		t.Errorf("initial legal moves = %d, want 9", len(moves0))
	}

	// X plays 0
	st = g.Apply(st, json.RawMessage(`{"cell":0}`)).(state)
	moves1 := g.LegalMoves(st)
	if len(moves1) != 8 {
		t.Errorf("after 1 move legal = %d, want 8", len(moves1))
	}

	// O plays 4
	st = g.Apply(st, json.RawMessage(`{"cell":4}`)).(state)
	moves2 := g.LegalMoves(st)
	if len(moves2) != 7 {
		t.Errorf("after 2 moves legal = %d, want 7", len(moves2))
	}

	// ensure 0 and 4 gone
	for _, m := range moves2 {
		var mv move
		json.Unmarshal(m, &mv)
		if mv.Cell == 0 || mv.Cell == 4 {
			t.Errorf("occupied cell %d still in legal moves", mv.Cell)
		}
	}
}

func TestSerializeDeserializeRoundTripAndNulls(t *testing.T) {
	g := New().(rules.Rules)

	// initial: must have nulls in board
	initSt := g.Init("")
	ser := g.Serialize(initSt)
	wantInit := `{"board":[null,null,null,null,null,null,null,null,null],"next":"X"}`
	if string(ser) != wantInit {
		t.Errorf("initial serialize = %s, want %s", ser, wantInit)
	}

	// roundtrip initial
	st1, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize initial: %v", err)
	}
	ser2 := g.Serialize(st1)
	if string(ser2) != wantInit {
		t.Errorf("roundtrip serialize mismatch: %s", ser2)
	}

	// mixed board
	orig := state{
		Board: [9]string{"X", "", "O", "", "X", "", "O", "", ""},
		Next:  "O",
	}
	ser = g.Serialize(orig)
	// expect nulls not ""
	if string(ser) != `{"board":["X",null,"O",null,"X",null,"O",null,null],"next":"O"}` {
		t.Errorf("mixed serialize = %s", ser)
	}

	back, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize mixed: %v", err)
	}
	stBack := back.(state)
	if stBack.Next != "O" || stBack.Board[0] != "X" || stBack.Board[1] != "" || stBack.Board[2] != "O" {
		t.Errorf("roundtrip state wrong: %+v", stBack)
	}
	// re-serialize matches
	if string(g.Serialize(stBack)) != string(ser) {
		t.Error("re-serialize after roundtrip differs")
	}

	// terminal state serialize still has correct nulls
	termState := state{
		Board: [9]string{"X", "X", "X", "O", "O", "", "", "", ""},
		Next:  "X",
	}
	serTerm := g.Serialize(termState)
	// should contain nulls
	if string(serTerm) != `{"board":["X","X","X","O","O",null,null,null,null],"next":"X"}` {
		t.Errorf("term serialize = %s", serTerm)
	}
}

func TestRegisterAndRegistry(t *testing.T) {
	// self registered via init
	r, ok := rules.Get("tic-tac-toe")
	if !ok {
		t.Fatal("tic-tac-toe not registered")
	}
	if r.Meta().ID != "tic-tac-toe" {
		t.Error("meta id mismatch")
	}
	all := rules.All()
	found := false
	for _, x := range all {
		if x.Meta().ID == "tic-tac-toe" {
			found = true
			break
		}
	}
	if !found {
		t.Error("All() did not include tic-tac-toe")
	}
}
