package chess

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	path := filepath.Join("testdata", "chess.golden.json")
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
