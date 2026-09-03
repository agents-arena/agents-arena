// Package reversi implements Reversi (Othello) as an arena game: an 8×8 board,
// seats B (black, moves first) and W (white), placement moves that must flip at
// least one opposing disc, and automatic passing when a side has no legal move.
package reversi

import (
	"encoding/json"
	"errors"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

const (
	cols = 8
	rows = 8
	size = cols * rows // 64
)

// state is the internal representation. "" denotes an empty square.
// Board is row-major with row 0 at the top (index = row*8 + col).
type state struct {
	Board [size]string `json:"-"`
	Next  string       `json:"-"`
}

// move is the canonical move shape: place a disc on a square (0–63).
type move struct {
	Cell int `json:"cell"`
}

type reversi struct{}

// New returns a new Reversi Rules implementation.
func New() spec.Rules {
	return reversi{}
}

func (reversi) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "reversi",
		Name:       "Reversi",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"B", "W"},
	}
}

// Init returns the standard opening cross: white on d4/e5, black on e4/d5,
// black to move.
func (reversi) Init(seed string) any {
	var st state
	st.Board[3*cols+3] = "W"
	st.Board[3*cols+4] = "B"
	st.Board[4*cols+3] = "B"
	st.Board[4*cols+4] = "W"
	st.Next = "B"
	return st
}

func (g reversi) ToMove(s any) string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (g reversi) Validate(s any, moveRaw json.RawMessage, seat string) error {
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
	if len(flips(st.Board, m.Cell, st.Next)) == 0 {
		return errors.New("no discs flipped")
	}
	return nil
}

func (g reversi) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)

	next := state{Board: st.Board, Next: st.Next} // value copy of the array
	if captured := flips(st.Board, m.Cell, st.Next); len(captured) > 0 {
		next.Board[m.Cell] = st.Next
		for _, i := range captured {
			next.Board[i] = st.Next
		}
	}

	// Turn order with automatic passing: the opponent moves unless they have no
	// legal move, in which case the mover goes again. If neither side can move
	// the game is over and Next is cosmetic.
	opp := other(st.Next)
	switch {
	case hasMove(next.Board, opp):
		next.Next = opp
	case hasMove(next.Board, st.Next):
		next.Next = st.Next
	default:
		next.Next = opp
	}
	return next
}

func (g reversi) LegalMoves(s any) []json.RawMessage {
	st := s.(state)
	if g.Terminal(st) != nil {
		return []json.RawMessage{}
	}
	var out []json.RawMessage
	for i := 0; i < size; i++ {
		if st.Board[i] != "" {
			continue
		}
		if len(flips(st.Board, i, st.Next)) > 0 {
			b, _ := json.Marshal(move{Cell: i})
			out = append(out, b)
		}
	}
	return out
}

// Terminal ends the game as soon as neither side has a legal move — the board
// being full is just the most common way to get there. The winner is whoever
// owns more discs.
func (reversi) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	if hasMove(st.Board, "B") || hasMove(st.Board, "W") {
		return nil
	}
	b, w := counts(st.Board)
	switch {
	case b > w:
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: "B",
			Reason: "more discs",
		}
	case w > b:
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: "W",
			Reason: "more discs",
		}
	default:
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "equal discs",
		}
	}
}

// Hints warns the side to move when their opponent is about to be skipped —
// advisory only, it never changes legality.
func (g reversi) Hints(s any) []string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return nil
	}
	if !hasMove(st.Board, other(st.Next)) {
		return []string{other(st.Next) + " has no legal move — you move again after this one"}
	}
	return nil
}

func (reversi) Serialize(s any) json.RawMessage {
	st := s.(state)
	board := make([]any, size)
	for i := 0; i < size; i++ {
		if st.Board[i] == "" {
			board[i] = nil
		} else {
			board[i] = st.Board[i]
		}
	}
	b, w := counts(st.Board)
	data, _ := json.Marshal(struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
		B     int    `json:"b"`
		W     int    `json:"w"`
	}{
		Board: board,
		Next:  st.Next,
		B:     b,
		W:     w,
	})
	return data
}

func (reversi) Deserialize(data json.RawMessage) (any, error) {
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
	return st, nil
}

// directions are the eight ray directions as (dRow, dCol).
var directions = [8][2]int{
	{-1, -1}, {-1, 0}, {-1, 1},
	{0, -1}, {0, 1},
	{1, -1}, {1, 0}, {1, 1},
}

func other(seat string) string {
	if seat == "B" {
		return "W"
	}
	return "B"
}

// flips returns the indices captured by seat playing on cell — every opposing
// disc on a ray from cell that is bracketed by one of seat's own discs. Empty
// when the move is illegal (occupied square or nothing to flip).
func flips(b [size]string, cell int, seat string) []int {
	if cell < 0 || cell >= size || b[cell] != "" {
		return nil
	}
	opp := other(seat)
	row, col := cell/cols, cell%cols
	var out []int
	for _, d := range directions {
		var run []int
		r, c := row+d[0], col+d[1]
		for r >= 0 && r < rows && c >= 0 && c < cols && b[r*cols+c] == opp {
			run = append(run, r*cols+c)
			r += d[0]
			c += d[1]
		}
		if len(run) == 0 {
			continue
		}
		if r >= 0 && r < rows && c >= 0 && c < cols && b[r*cols+c] == seat {
			out = append(out, run...)
		}
	}
	return out
}

func hasMove(b [size]string, seat string) bool {
	for i := 0; i < size; i++ {
		if b[i] != "" {
			continue
		}
		if len(flips(b, i, seat)) > 0 {
			return true
		}
	}
	return false
}

func counts(b [size]string) (black, white int) {
	for _, v := range b {
		switch v {
		case "B":
			black++
		case "W":
			white++
		}
	}
	return black, white
}

func init() {
	spec.Register(New())
}
