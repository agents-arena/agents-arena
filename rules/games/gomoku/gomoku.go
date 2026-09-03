// Package gomoku implements freestyle Gomoku as an arena game: a 15x15 board,
// seats B (black, moves first) and W, one stone placed per turn on any empty
// point, and five or more in a row wins.
package gomoku

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

const (
	cols   = 15
	rows   = 15
	size   = cols * rows // 225
	winRun = 5
)

// state is the internal representation. "" denotes an empty point.
// Board is row-major with row 0 at the top (index = row*15 + col).
type state struct {
	Board [size]string `json:"-"`
	Next  string       `json:"-"`
	// Last is the point of the most recent stone, or -1 before the first move.
	// It is wire state purely so spectators can highlight the last stone.
	Last int `json:"-"`
}

// move is the canonical move shape: place a stone on a point (0–224).
type move struct {
	Cell int `json:"cell"`
}

type gomoku struct{}

// New returns a new Gomoku Rules implementation.
func New() spec.Rules {
	return gomoku{}
}

func (gomoku) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "gomoku",
		Name:       "Gomoku",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"B", "W"},
	}
}

func (gomoku) Init(seed string) any {
	return state{Next: "B", Last: -1}
}

func (g gomoku) ToMove(s any) string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (g gomoku) Validate(s any, moveRaw json.RawMessage, seat string) error {
	st := s.(state)
	if g.Terminal(st) != nil {
		return errors.New("game over")
	}
	var m move
	if err := json.Unmarshal(moveRaw, &m); err != nil {
		return errors.New("cell out of range")
	}
	if seat != st.Next {
		return errors.New("not your turn")
	}
	if m.Cell < 0 || m.Cell >= size {
		return errors.New("cell out of range")
	}
	if st.Board[m.Cell] != "" {
		return errors.New("cell occupied")
	}
	return nil
}

func (gomoku) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)

	next := state{Board: st.Board, Next: st.Next, Last: st.Last} // array copies by value
	if m.Cell >= 0 && m.Cell < size && next.Board[m.Cell] == "" {
		next.Board[m.Cell] = st.Next
		next.Last = m.Cell
	}
	next.Next = other(st.Next)
	return next
}

func (g gomoku) LegalMoves(s any) []json.RawMessage {
	st := s.(state)
	if g.Terminal(st) != nil {
		return []json.RawMessage{}
	}
	var out []json.RawMessage
	for i := 0; i < size; i++ {
		if st.Board[i] == "" {
			b, _ := json.Marshal(move{Cell: i})
			out = append(out, b)
		}
	}
	return out
}

func (gomoku) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	if w := winningSeat(st.Board); w != "" {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: w,
			Reason: "five in a row",
		}
	}
	for i := 0; i < size; i++ {
		if st.Board[i] == "" {
			return nil
		}
	}
	return &protocol.GameResult{
		Kind:   protocol.ResultDraw,
		Reason: "board full",
	}
}

// Hints warns the side to move about points where their opponent would win
// immediately. Advisory only — it never changes legality.
func (g gomoku) Hints(s any) []string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return nil
	}
	threats := winningCells(st.Board, other(st.Next))
	if len(threats) == 0 {
		return nil
	}
	msg := other(st.Next) + " wins next move at "
	for i, c := range threats {
		if i == 3 {
			msg += ", …"
			break
		}
		if i > 0 {
			msg += ", "
		}
		msg += strconv.Itoa(c)
	}
	if len(threats) == 1 {
		return []string{msg + " — block it"}
	}
	return []string{msg + " — you cannot block them all"}
}

func (gomoku) Serialize(s any) json.RawMessage {
	st := s.(state)
	board := make([]any, size)
	for i := 0; i < size; i++ {
		if st.Board[i] == "" {
			board[i] = nil
		} else {
			board[i] = st.Board[i]
		}
	}
	var last any
	if st.Last >= 0 {
		last = st.Last
	}
	data, _ := json.Marshal(struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
		Last  any    `json:"last"`
	}{
		Board: board,
		Next:  st.Next,
		Last:  last,
	})
	return data
}

func (gomoku) Deserialize(data json.RawMessage) (any, error) {
	if len(data) == 0 {
		return nil, errors.New("empty state data")
	}
	var raw struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
		Last  *int   `json:"last"`
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
			if val != "B" && val != "W" {
				return nil, errors.New("Invalid cell in serialized board")
			}
			st.Board[i] = val
		default:
			return nil, errors.New("Invalid cell in serialized board")
		}
	}
	if raw.Next != "B" && raw.Next != "W" {
		return nil, errors.New("Invalid next in serialized state")
	}
	st.Next = raw.Next
	st.Last = -1
	if raw.Last != nil {
		if *raw.Last < 0 || *raw.Last >= size {
			return nil, errors.New("Invalid last in serialized state")
		}
		st.Last = *raw.Last
	}
	return st, nil
}

// directions are the four line orientations: E, S, SE, SW. Scanning only these
// covers every line, since the reverse of each is the same line read backwards.
var directions = [4][2]int{{0, 1}, {1, 0}, {1, 1}, {1, -1}}

func other(seat string) string {
	if seat == "B" {
		return "W"
	}
	return "B"
}

// runFrom returns how many of seat's stones run from (r,c) in direction d,
// counting the stone at (r,c) itself.
func runFrom(b [size]string, r, c, dr, dc int, seat string) int {
	n := 0
	for r >= 0 && r < rows && c >= 0 && c < cols && b[r*cols+c] == seat {
		n++
		r += dr
		c += dc
	}
	return n
}

// wins reports whether the stone at cell completes a line of winRun or more.
// Freestyle Gomoku has no overline restriction: six in a row wins too.
func wins(b [size]string, cell int, seat string) bool {
	if cell < 0 || cell >= size || b[cell] != seat {
		return false
	}
	r, c := cell/cols, cell%cols
	for _, d := range directions {
		// The stone itself is counted by both half-runs, hence the -1.
		n := runFrom(b, r, c, d[0], d[1], seat) + runFrom(b, r, c, -d[0], -d[1], seat) - 1
		if n >= winRun {
			return true
		}
	}
	return false
}

func winningSeat(b [size]string) string {
	for i := 0; i < size; i++ {
		if b[i] == "" {
			continue
		}
		if wins(b, i, b[i]) {
			return b[i]
		}
	}
	return ""
}

// winningCells lists the empty points where seat would complete a line now.
func winningCells(b [size]string, seat string) []int {
	var out []int
	for i := 0; i < size; i++ {
		if b[i] != "" {
			continue
		}
		nb := b
		nb[i] = seat
		if wins(nb, i, seat) {
			out = append(out, i)
		}
	}
	return out
}

func init() {
	spec.Register(New())
}
