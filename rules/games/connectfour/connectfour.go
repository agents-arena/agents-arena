package connectfour

import (
	"encoding/json"
	"errors"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

const (
	cols = 7
	rows = 6
	size = cols * rows // 42
)

// State is the internal representation. "" denotes an empty cell.
// Board is row-major with row 0 at the top (index = row*7 + col).
// Gravity drops into the lowest empty row of a column (highest row index).
type state struct {
	Board [size]string `json:"-"`
	Next  string       `json:"-"`
}

// Move is the canonical move shape: drop a disc into a column (0–6).
type move struct {
	Column int `json:"column"`
}

type c4 struct{}

// New returns a new Connect Four Rules implementation.
func New() spec.Rules {
	return c4{}
}

func (c4) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "connect-four",
		Name:       "Connect Four",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"R", "Y"},
	}
}

func (c4) Init(seed string) any {
	return state{Next: "R"}
}

func (c c4) ToMove(s any) string {
	st := s.(state)
	if c.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (c c4) Validate(s any, moveRaw json.RawMessage, seat string) error {
	st := s.(state)
	if c.Terminal(st) != nil {
		return errors.New("game over")
	}
	var m move
	if err := json.Unmarshal(moveRaw, &m); err != nil {
		return errors.New("column out of range")
	}
	if seat != st.Next {
		return errors.New("not your turn")
	}
	if m.Column < 0 || m.Column >= cols {
		return errors.New("column out of range")
	}
	if dropRow(st.Board, m.Column) < 0 {
		return errors.New("column full")
	}
	return nil
}

func (c4) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)

	next := state{
		Board: st.Board, // value copy of array
		Next:  st.Next,
	}
	if m.Column >= 0 && m.Column < cols {
		if r := dropRow(next.Board, m.Column); r >= 0 {
			next.Board[r*cols+m.Column] = st.Next
		}
	}
	if st.Next == "R" {
		next.Next = "Y"
	} else {
		next.Next = "R"
	}
	return next
}

func (c c4) LegalMoves(s any) []json.RawMessage {
	st := s.(state)
	if c.Terminal(st) != nil {
		return []json.RawMessage{}
	}
	var out []json.RawMessage
	for col := 0; col < cols; col++ {
		if dropRow(st.Board, col) >= 0 {
			b, _ := json.Marshal(move{Column: col})
			out = append(out, b)
		}
	}
	return out
}

func (c4) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	if w := winningSeat(st.Board); w != "" {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: w,
			Reason: "four-in-a-row",
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

func (c4) Serialize(s any) json.RawMessage {
	st := s.(state)
	board := make([]any, size)
	for i := 0; i < size; i++ {
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

func (c4) Deserialize(data json.RawMessage) (any, error) {
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
	if len(raw.Board) != size {
		return nil, errors.New("Invalid board in serialized state")
	}
	var st state
	for i, v := range raw.Board {
		switch val := v.(type) {
		case nil:
			st.Board[i] = ""
		case string:
			if val != "R" && val != "Y" {
				return nil, errors.New("Invalid cell in serialized board")
			}
			st.Board[i] = val
		default:
			return nil, errors.New("Invalid cell in serialized board")
		}
	}
	if raw.Next != "R" && raw.Next != "Y" {
		return nil, errors.New("Invalid next in serialized state")
	}
	st.Next = raw.Next
	return st, nil
}

// dropRow returns the row index where a disc would land in col, or -1 if full.
// Row 0 is the top; discs fall toward row rows-1.
func dropRow(b [size]string, col int) int {
	for r := rows - 1; r >= 0; r-- {
		if b[r*cols+col] == "" {
			return r
		}
	}
	return -1
}

func winningSeat(b [size]string) string {
	dirs := [][2]int{{0, 1}, {1, 0}, {1, 1}, {1, -1}} // E, S, SE, SW
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			mark := b[r*cols+c]
			if mark == "" {
				continue
			}
			for _, d := range dirs {
				dr, dc := d[0], d[1]
				ok := true
				for k := 1; k < 4; k++ {
					rr, cc := r+dr*k, c+dc*k
					if rr < 0 || rr >= rows || cc < 0 || cc >= cols || b[rr*cols+cc] != mark {
						ok = false
						break
					}
				}
				if ok {
					return mark
				}
			}
		}
	}
	return ""
}

func isFull(b [size]string) bool {
	// Full ⇔ no column can take another disc, which is exactly the condition
	// under which LegalMoves is empty. (Asking dropRow rather than checking the
	// top row keeps Terminal and LegalMoves in agreement even for a board that
	// violates the gravity invariant, e.g. one hand-written into Deserialize.)
	for c := 0; c < cols; c++ {
		if dropRow(b, c) >= 0 {
			return false
		}
	}
	return true
}

func init() {
	spec.Register(New())
}
