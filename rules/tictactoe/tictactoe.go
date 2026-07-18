package tictactoe

import (
	"encoding/json"
	"errors"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules"
)

// State is the internal representation. "" denotes an empty cell.
type state struct {
	Board [9]string `json:"-"`
	Next  string    `json:"-"`
}

// Move is the canonical move shape.
type move struct {
	Cell int `json:"cell"`
}

var lines = [][3]int{
	{0, 1, 2}, {3, 4, 5}, {6, 7, 8},
	{0, 3, 6}, {1, 4, 7}, {2, 5, 8},
	{0, 4, 8}, {2, 4, 6},
}

type ttt struct{}

// New returns a new tic-tac-toe Rules implementation.
func New() rules.Rules {
	return ttt{}
}

func (ttt) Meta() rules.GameMeta {
	return rules.GameMeta{
		ID:         "tic-tac-toe",
		Name:       "Tic-Tac-Toe",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"X", "O"},
	}
}

func (ttt) Init(seed string) any {
	return state{Next: "X"}
}

func (t ttt) ToMove(s any) string {
	st := s.(state)
	if t.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (t ttt) Validate(s any, moveRaw json.RawMessage, seat string) error {
	st := s.(state)
	if t.Terminal(st) != nil {
		return errors.New("game over")
	}
	var m move
	if err := json.Unmarshal(moveRaw, &m); err != nil {
		return errors.New("cell out of range")
	}
	if seat != st.Next {
		return errors.New("not your turn")
	}
	if m.Cell < 0 || m.Cell >= 9 {
		return errors.New("cell out of range")
	}
	if st.Board[m.Cell] != "" {
		return errors.New("cell occupied")
	}
	return nil
}

func (t ttt) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)

	next := state{
		Board: st.Board, // value copy of array
		Next:  st.Next,
	}
	if m.Cell >= 0 && m.Cell < 9 {
		next.Board[m.Cell] = st.Next
	}
	if st.Next == "X" {
		next.Next = "O"
	} else {
		next.Next = "X"
	}
	return next
}

func (t ttt) LegalMoves(s any) []json.RawMessage {
	st := s.(state)
	if t.Terminal(st) != nil {
		return []json.RawMessage{}
	}
	var out []json.RawMessage
	for i := 0; i < 9; i++ {
		if st.Board[i] == "" {
			b, _ := json.Marshal(move{Cell: i})
			out = append(out, b)
		}
	}
	return out
}

func (t ttt) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	if w := winningSeat(st.Board); w != "" {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: w,
			Reason: "three-in-a-row",
		}
	}
	if isFull(st.Board) {
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "board full",
		}
	}
	return nil
}

func (ttt) Serialize(s any) json.RawMessage {
	st := s.(state)
	board := make([]any, 9)
	for i := 0; i < 9; i++ {
		if st.Board[i] == "" {
			board[i] = nil
		} else {
			board[i] = st.Board[i]
		}
	}
	data, _ := json.Marshal(struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
	}{
		Board: board,
		Next:  st.Next,
	})
	return data
}

func (ttt) Deserialize(data json.RawMessage) (any, error) {
	if len(data) == 0 {
		return nil, errors.New("empty state data")
	}
	var raw struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if len(raw.Board) != 9 {
		return nil, errors.New("Invalid board in serialized state")
	}
	var st state
	for i, v := range raw.Board {
		switch val := v.(type) {
		case nil:
			st.Board[i] = ""
		case string:
			if val != "X" && val != "O" {
				return nil, errors.New("Invalid cell in serialized board")
			}
			st.Board[i] = val
		default:
			return nil, errors.New("Invalid cell in serialized board")
		}
	}
	if raw.Next != "X" && raw.Next != "O" {
		return nil, errors.New("Invalid next in serialized state")
	}
	st.Next = raw.Next
	return st, nil
}

func winningSeat(b [9]string) string {
	for _, l := range lines {
		a, b1, c := l[0], l[1], l[2]
		m := b[a]
		if m != "" && m == b[b1] && m == b[c] {
			return m
		}
	}
	return ""
}

func isFull(b [9]string) bool {
	for i := 0; i < 9; i++ {
		if b[i] == "" {
			return false
		}
	}
	return true
}

func init() {
	rules.Register(New())
}
