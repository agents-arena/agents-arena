package room

import (
	"encoding/json"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

// hintingRules is a minimal Rules + Hinter stub used to verify Snapshot.Hints
// wiring without depending on chess being compiled yet.
type hintingRules struct {
	id    string
	seats []string
	hints []string
}

func registerStub(r *hintingRules) {
	spec.Register(r)
}

func (h *hintingRules) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         h.id,
		Name:       "Hint Stub",
		MinPlayers: len(h.seats),
		MaxPlayers: len(h.seats),
		Seats:      append([]string(nil), h.seats...),
	}
}

func (h *hintingRules) Init(seed string) any {
	return map[string]any{"n": 0}
}

func (h *hintingRules) ToMove(state any) string {
	if len(h.seats) == 0 {
		return ""
	}
	return h.seats[0]
}

func (h *hintingRules) Validate(state any, move json.RawMessage, seat string) error {
	return nil
}

func (h *hintingRules) Apply(state any, move json.RawMessage) any {
	return state
}

func (h *hintingRules) LegalMoves(state any) []json.RawMessage {
	return nil
}

func (h *hintingRules) Terminal(state any) *protocol.GameResult {
	return nil
}

func (h *hintingRules) Serialize(state any) json.RawMessage {
	b, _ := json.Marshal(state)
	return b
}

func (h *hintingRules) Deserialize(data json.RawMessage) (any, error) {
	var v any
	err := json.Unmarshal(data, &v)
	return v, err
}

// Hints implements spec.Hinter.
func (h *hintingRules) Hints(state any) []string {
	return append([]string(nil), h.hints...)
}
