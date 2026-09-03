// Package hex implements Hex as an arena game: an 11x11 rhombus, seats R (red,
// moves first, connecting left to right) and B (blue, connecting top to
// bottom), one stone placed per turn, and no draws — exactly one side finishes
// with a connected chain.
package hex

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

const (
	cols = 11
	rows = 11
	size = cols * rows // 121
)

// state is the internal representation. "" denotes an empty cell. Board is
// row-major with row 0 at the top.
type state struct {
	Board [size]string `json:"-"`
	Next  string       `json:"-"`
	// Last is the most recent stone, or -1 before the first move. Wire state so
	// spectators can highlight the move that just landed.
	Last int `json:"-"`
}

// move is the canonical move shape: place a stone on a cell (0–120).
type move struct {
	Cell int `json:"cell"`
}

type hex struct{}

// New returns a new Hex Rules implementation.
func New() spec.Rules {
	return hex{}
}

func (hex) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "hex",
		Name:       "Hex",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"R", "B"},
	}
}

func (hex) Init(seed string) any {
	return state{Next: "R", Last: -1}
}

func (g hex) ToMove(s any) string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (g hex) Validate(s any, moveRaw json.RawMessage, seat string) error {
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

func (hex) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)

	next := state{Board: st.Board, Next: st.Next, Last: st.Last}
	if m.Cell >= 0 && m.Cell < size && next.Board[m.Cell] == "" {
		next.Board[m.Cell] = st.Next
		next.Last = m.Cell
	}
	next.Next = other(st.Next)
	return next
}

func (g hex) LegalMoves(s any) []json.RawMessage {
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

// Terminal reports the winner once one side's stones connect their two edges.
// Hex cannot be drawn: a full board always contains exactly one such chain.
func (hex) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	if connected(st.Board, "R") {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: "R",
			Reason: "connected left to right",
		}
	}
	if connected(st.Board, "B") {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: "B",
			Reason: "connected top to bottom",
		}
	}
	return nil
}

// Hints warn the side to move when their opponent can finish next move.
// Advisory only — it never changes legality.
func (g hex) Hints(s any) []string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return nil
	}
	opp := other(st.Next)
	var threats []int
	for i := 0; i < size; i++ {
		if st.Board[i] != "" {
			continue
		}
		nb := st.Board
		nb[i] = opp
		if connected(nb, opp) {
			threats = append(threats, i)
		}
	}
	if len(threats) == 0 {
		return nil
	}
	msg := opp + " connects next move at "
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

func (hex) Serialize(s any) json.RawMessage {
	st := s.(state)
	board := make([]any, size)
	for i, v := range st.Board {
		if v == "" {
			board[i] = nil
		} else {
			board[i] = v
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
	}{Board: board, Next: st.Next, Last: last})
	return data
}

func (hex) Deserialize(data json.RawMessage) (any, error) {
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
			if val != "R" && val != "B" {
				return nil, errors.New("Invalid cell in serialized board")
			}
			st.Board[i] = val
		default:
			return nil, errors.New("Invalid cell in serialized board")
		}
	}
	if raw.Next != "R" && raw.Next != "B" {
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

func other(seat string) string {
	if seat == "R" {
		return "B"
	}
	return "R"
}

// neighbours returns the up-to-six cells adjacent to i on the hex grid. On a
// rhombus laid out row-major, the two diagonal neighbours are north-east and
// south-west; north-west and south-east are NOT adjacent.
func neighbours(i int) []int {
	r, c := i/cols, i%cols
	deltas := [6][2]int{{0, -1}, {0, 1}, {-1, 0}, {1, 0}, {-1, 1}, {1, -1}}
	out := make([]int, 0, 6)
	for _, d := range deltas {
		nr, nc := r+d[0], c+d[1]
		if nr >= 0 && nr < rows && nc >= 0 && nc < cols {
			out = append(out, nr*cols+nc)
		}
	}
	return out
}

// connected reports whether seat's stones link their two edges: red joins
// column 0 to column 10, blue joins row 0 to row 10.
func connected(b [size]string, seat string) bool {
	// Seed the search from the seat's home edge: red's first column, blue's
	// first row.
	var queue []int
	seen := make([]bool, size)
	for i := 0; i < cols; i++ {
		start := i // blue's home edge is row 0
		if seat == "R" {
			start = i * cols // red's home edge is column 0
		}
		if b[start] == seat {
			seen[start] = true
			queue = append(queue, start)
		}
	}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if seat == "R" && cur%cols == cols-1 {
			return true
		}
		if seat == "B" && cur/cols == rows-1 {
			return true
		}
		for _, n := range neighbours(cur) {
			if !seen[n] && b[n] == seat {
				seen[n] = true
				queue = append(queue, n)
			}
		}
	}
	return false
}

func init() {
	spec.Register(New())
}
