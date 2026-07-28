package connectfour

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
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
	path := filepath.Join("testdata", "connect-four.golden.json")
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
	g := New().(spec.Rules)
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
			if c.ExpectResultAfter.Reason != "" && gotRes.Reason != c.ExpectResultAfter.Reason {
				t.Errorf("result.reason=%q, want %q", gotRes.Reason, c.ExpectResultAfter.Reason)
			}
		})
	}
}

func TestLegalMovesShrinks(t *testing.T) {
	g := New().(spec.Rules)

	st := g.Init("").(state)
	moves0 := g.LegalMoves(st)
	if len(moves0) != 7 {
		t.Errorf("initial legal moves = %d, want 7", len(moves0))
	}

	// Fill column 0 completely (6 drops).
	for i := 0; i < 6; i++ {
		seat := g.ToMove(st)
		if err := g.Validate(st, json.RawMessage(`{"column":0}`), seat); err != nil {
			t.Fatalf("fill col0 ply %d: %v", i, err)
		}
		st = g.Apply(st, json.RawMessage(`{"column":0}`)).(state)
	}
	moves := g.LegalMoves(st)
	if len(moves) != 6 {
		t.Errorf("after filling col0 legal = %d, want 6", len(moves))
	}
	for _, m := range moves {
		var mv move
		_ = json.Unmarshal(m, &mv)
		if mv.Column == 0 {
			t.Errorf("full column 0 still in legal moves")
		}
	}
}

func TestSerializeDeserializeRoundTripAndNulls(t *testing.T) {
	g := New().(spec.Rules)

	initSt := g.Init("")
	ser := g.Serialize(initSt)
	if !strings.Contains(string(ser), `"next":"R"`) {
		t.Errorf("initial serialize missing next R: %s", ser)
	}
	nullCount := strings.Count(string(ser), "null")
	if nullCount != 42 {
		t.Errorf("initial serialize null count = %d, want 42", nullCount)
	}

	st1, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize initial: %v", err)
	}
	ser2 := g.Serialize(st1)
	if string(ser2) != string(ser) {
		t.Errorf("roundtrip serialize mismatch: %s", ser2)
	}

	// One disc on the bottom of column 3.
	after := g.Apply(initSt, json.RawMessage(`{"column":3}`)).(state)
	ser = g.Serialize(after)
	back, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize mixed: %v", err)
	}
	stBack := back.(state)
	if stBack.Next != "Y" || stBack.Board[5*7+3] != "R" {
		t.Errorf("roundtrip state wrong: next=%s board[38]=%q", stBack.Next, stBack.Board[5*7+3])
	}
	if string(g.Serialize(stBack)) != string(ser) {
		t.Error("re-serialize after roundtrip differs")
	}
}

func TestGravityStacksInColumn(t *testing.T) {
	g := New().(spec.Rules)
	st := g.Init("").(state)
	st = g.Apply(st, json.RawMessage(`{"column":2}`)).(state) // R bottom
	st = g.Apply(st, json.RawMessage(`{"column":2}`)).(state) // Y above
	if st.Board[5*7+2] != "R" || st.Board[4*7+2] != "Y" {
		t.Errorf("gravity failed: row5=%q row4=%q", st.Board[5*7+2], st.Board[4*7+2])
	}
}

func TestRegisterAndRegistry(t *testing.T) {
	r, ok := spec.Get("connect-four")
	if !ok {
		t.Fatal("connect-four not registered")
	}
	if r.Meta().ID != "connect-four" {
		t.Error("meta id mismatch")
	}
	all := spec.All()
	found := false
	for _, x := range all {
		if x.Meta().ID == "connect-four" {
			found = true
			break
		}
	}
	if !found {
		t.Error("All() did not include connect-four")
	}
}
