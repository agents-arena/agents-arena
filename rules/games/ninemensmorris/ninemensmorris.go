// Package ninemensmorris implements Nine Men's Morris as an arena game: 24
// points on three nested squares, seats W (white, moves first) and B, nine men
// each placed then moved, mills that let you remove an enemy man, and flying
// once a side is down to three.
package ninemensmorris

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

const (
	points = 24
	// menPerSide is how many men each seat places during the opening phase.
	menPerSide = 9
	// idleLimit is the no-progress draw: 50 plies with no mill formed.
	idleLimit = 50
)

// state is the internal representation. "" denotes an empty point.
//
// The 24 points are numbered ring by ring from the outside in, left to right
// and top to bottom:
//
//	0-----------1-----------2
//	|           |           |
//	|   3-------4-------5   |
//	|   |       |       |   |
//	|   |   6---7---8   |   |
//	|   |   |       |   |   |
//	9--10--11      12--13--14
//	|   |   |       |   |   |
//	|   |  15--16--17   |   |
//	|   |       |       |   |
//	|  18------19------20   |
//	|           |           |
//	21---------22----------23
type state struct {
	Board [points]string `json:"-"`
	Next  string         `json:"-"`
	// HandW and HandB are the men each seat has still to place.
	HandW int `json:"-"`
	HandB int `json:"-"`
	// Idle counts plies since the last mill.
	Idle int `json:"-"`
}

// move is the canonical move shape. From is absent while placing men, Remove is
// present exactly when the move closes a mill.
type move struct {
	From   *int `json:"from,omitempty"`
	To     int  `json:"to"`
	Remove *int `json:"remove,omitempty"`
}

type morris struct{}

// New returns a new Nine Men's Morris Rules implementation.
func New() spec.Rules {
	return morris{}
}

func (morris) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "nine-mens-morris",
		Name:       "Nine Men's Morris",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"W", "B"},
	}
}

func (morris) Init(seed string) any {
	return state{Next: "W", HandW: menPerSide, HandB: menPerSide}
}

func (g morris) ToMove(s any) string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (g morris) Validate(s any, moveRaw json.RawMessage, seat string) error {
	st := s.(state)
	if g.Terminal(st) != nil {
		return errors.New("game over")
	}
	var m move
	if err := json.Unmarshal(moveRaw, &m); err != nil {
		return errors.New("point out of range")
	}
	if seat != st.Next {
		return errors.New("not your turn")
	}
	if m.To < 0 || m.To >= points {
		return errors.New("point out of range")
	}
	if m.From != nil && (*m.From < 0 || *m.From >= points) {
		return errors.New("point out of range")
	}
	if m.Remove != nil && (*m.Remove < 0 || *m.Remove >= points) {
		return errors.New("point out of range")
	}

	if hand(st, st.Next) > 0 {
		// Placement phase: no man may be moved until every man is on the board.
		if m.From != nil {
			return errors.New("place a man before moving one")
		}
		if st.Board[m.To] != "" {
			return errors.New("point occupied")
		}
	} else {
		if m.From == nil {
			return errors.New("you have no men left to place")
		}
		if st.Board[*m.From] != st.Next {
			return errors.New("no man of yours on that point")
		}
		if st.Board[m.To] != "" {
			return errors.New("point occupied")
		}
		// Three men left may fly to any empty point; everyone else slides.
		if count(st.Board, st.Next) > 3 && !adjacent(*m.From, m.To) {
			return errors.New("points are not adjacent")
		}
	}

	after := placed(st, m)
	if millAt(after, m.To, st.Next) {
		if m.Remove == nil {
			return errors.New("your move closes a mill — name the man to remove")
		}
		return checkRemoval(after, *m.Remove, other(st.Next))
	}
	if m.Remove != nil {
		return errors.New("that move does not close a mill")
	}
	return nil
}

// checkRemoval applies the capture rule: a man inside a mill is safe unless
// every one of that seat's men is inside one.
func checkRemoval(b [points]string, target int, victim string) error {
	if b[target] != victim {
		return errors.New("no opposing man on that point")
	}
	if !inMill(b, target, victim) {
		return nil
	}
	for i := 0; i < points; i++ {
		if b[i] == victim && !inMill(b, i, victim) {
			return errors.New("that man is in a mill — take one that is not")
		}
	}
	return nil
}

func (morris) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)
	if m.To < 0 || m.To >= points {
		return st
	}

	next := state{Board: st.Board, Next: st.Next, HandW: st.HandW, HandB: st.HandB, Idle: st.Idle}
	if m.From != nil {
		if *m.From < 0 || *m.From >= points {
			return st
		}
		next.Board[*m.From] = ""
	} else if st.Next == "W" {
		next.HandW--
	} else {
		next.HandB--
	}
	next.Board[m.To] = st.Next

	if millAt(next.Board, m.To, st.Next) && m.Remove != nil &&
		*m.Remove >= 0 && *m.Remove < points {
		next.Board[*m.Remove] = ""
		next.Idle = 0
	} else {
		next.Idle = st.Idle + 1
	}

	next.Next = other(st.Next)
	return next
}

func (g morris) LegalMoves(s any) []json.RawMessage {
	st := s.(state)
	if g.Terminal(st) != nil {
		return []json.RawMessage{}
	}
	var out []json.RawMessage
	for _, m := range moveList(st) {
		b, _ := json.Marshal(m)
		out = append(out, b)
	}
	return out
}

// Terminal ends the game when a side is ground down to two men or has nowhere
// to go — both only possible once the men are all on the board — or when
// neither side has closed a mill for a long time.
func (g morris) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	if hand(st, st.Next) == 0 && hand(st, other(st.Next)) == 0 {
		if count(st.Board, st.Next) < 3 {
			return &protocol.GameResult{
				Kind:   protocol.ResultWin,
				Winner: other(st.Next),
				Reason: "reduced to two men",
			}
		}
		if len(moveList(st)) == 0 {
			return &protocol.GameResult{
				Kind:   protocol.ResultWin,
				Winner: other(st.Next),
				Reason: "no moves left",
			}
		}
	}
	if st.Idle >= idleLimit {
		return &protocol.GameResult{Kind: protocol.ResultDraw, Reason: "no mills"}
	}
	return nil
}

// Hints tell the side to move which phase they are in and warn about the
// approaching draw. Advisory only.
func (g morris) Hints(s any) []string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return nil
	}
	var out []string
	switch {
	case hand(st, st.Next) > 0:
		out = append(out, "placement phase — "+strconv.Itoa(hand(st, st.Next))+
			" men still in hand; a move is {\"to\":point}")
	case count(st.Board, st.Next) == 3:
		out = append(out, "you are down to three men — you may fly to any empty point")
	}
	if left := idleLimit - st.Idle; left <= 10 {
		out = append(out, "no mill closed for "+strconv.Itoa(st.Idle)+
			" plies — the game is drawn in "+strconv.Itoa(left))
	}
	return out
}

func (morris) Serialize(s any) json.RawMessage {
	st := s.(state)
	board := make([]any, points)
	for i, v := range st.Board {
		if v == "" {
			board[i] = nil
		} else {
			board[i] = v
		}
	}
	data, _ := json.Marshal(struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
		HandW int    `json:"handW"`
		HandB int    `json:"handB"`
		Idle  int    `json:"idle"`
	}{Board: board, Next: st.Next, HandW: st.HandW, HandB: st.HandB, Idle: st.Idle})
	return data
}

func (morris) Deserialize(data json.RawMessage) (any, error) {
	if len(data) == 0 {
		return nil, errors.New("empty state data")
	}
	var raw struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
		HandW int    `json:"handW"`
		HandB int    `json:"handB"`
		Idle  int    `json:"idle"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if len(raw.Board) != points {
		return nil, errors.New("Invalid board in serialized state")
	}
	var st state
	for i, v := range raw.Board {
		switch val := v.(type) {
		case nil:
			st.Board[i] = ""
		case string:
			if val != "W" && val != "B" {
				return nil, errors.New("Invalid point in serialized board")
			}
			st.Board[i] = val
		default:
			return nil, errors.New("Invalid point in serialized board")
		}
	}
	if raw.Next != "W" && raw.Next != "B" {
		return nil, errors.New("Invalid next in serialized state")
	}
	if raw.HandW < 0 || raw.HandW > menPerSide || raw.HandB < 0 || raw.HandB > menPerSide {
		return nil, errors.New("Invalid hand count in serialized state")
	}
	if raw.Idle < 0 {
		return nil, errors.New("Invalid idle in serialized state")
	}
	st.Next = raw.Next
	st.HandW = raw.HandW
	st.HandB = raw.HandB
	st.Idle = raw.Idle
	// A seat can never have more men in play plus in hand than it started with.
	for _, seat := range []string{"W", "B"} {
		if count(st.Board, seat)+hand(st, seat) > menPerSide {
			return nil, errors.New("Invalid man count in serialized state")
		}
	}
	return st, nil
}

// --- board topology -----------------------------------------------------------

// mills are the sixteen three-in-a-row lines of the board.
var mills = [16][3]int{
	{0, 1, 2}, {3, 4, 5}, {6, 7, 8},
	{9, 10, 11}, {12, 13, 14},
	{15, 16, 17}, {18, 19, 20}, {21, 22, 23},
	{0, 9, 21}, {3, 10, 18}, {6, 11, 15},
	{1, 4, 7}, {16, 19, 22},
	{8, 12, 17}, {5, 13, 20}, {2, 14, 23},
}

// neighbours lists the points joined to each point by a line segment.
var neighbours = [points][]int{
	0:  {1, 9},
	1:  {0, 2, 4},
	2:  {1, 14},
	3:  {4, 10},
	4:  {1, 3, 5, 7},
	5:  {4, 13},
	6:  {7, 11},
	7:  {4, 6, 8},
	8:  {7, 12},
	9:  {0, 10, 21},
	10: {3, 9, 11, 18},
	11: {6, 10, 15},
	12: {8, 13, 17},
	13: {5, 12, 14, 20},
	14: {2, 13, 23},
	15: {11, 16},
	16: {15, 17, 19},
	17: {12, 16, 20},
	18: {10, 19},
	19: {16, 18, 20, 22},
	20: {13, 17, 19},
	21: {9, 22},
	22: {19, 21, 23},
	23: {14, 22},
}

func adjacent(a, b int) bool {
	if a < 0 || a >= points {
		return false
	}
	for _, n := range neighbours[a] {
		if n == b {
			return true
		}
	}
	return false
}

func other(seat string) string {
	if seat == "W" {
		return "B"
	}
	return "W"
}

func hand(st state, seat string) int {
	if seat == "W" {
		return st.HandW
	}
	return st.HandB
}

func count(b [points]string, seat string) int {
	n := 0
	for _, v := range b {
		if v == seat {
			n++
		}
	}
	return n
}

// millAt reports whether point p is part of a completed mill for seat.
func millAt(b [points]string, p int, seat string) bool {
	for _, m := range mills {
		if m[0] != p && m[1] != p && m[2] != p {
			continue
		}
		if b[m[0]] == seat && b[m[1]] == seat && b[m[2]] == seat {
			return true
		}
	}
	return false
}

func inMill(b [points]string, p int, seat string) bool { return millAt(b, p, seat) }

// placed returns the board as it stands after the man has moved or been placed,
// but before any removal — the position a mill is judged on.
func placed(st state, m move) [points]string {
	b := st.Board
	if m.From != nil && *m.From >= 0 && *m.From < points {
		b[*m.From] = ""
	}
	if m.To >= 0 && m.To < points {
		b[m.To] = st.Next
	}
	return b
}

// removable lists the opposing men this position allows to be taken.
func removable(b [points]string, victim string) []int {
	var open, all []int
	for i := 0; i < points; i++ {
		if b[i] != victim {
			continue
		}
		all = append(all, i)
		if !inMill(b, i, victim) {
			open = append(open, i)
		}
	}
	if len(open) > 0 {
		return open
	}
	return all
}

// moveList enumerates every legal move, including the choice of which man to
// remove when the move closes a mill — so /legal is a complete menu.
func moveList(st state) []move {
	var out []move
	add := func(from *int, to int) {
		after := placed(st, move{From: from, To: to})
		if millAt(after, to, st.Next) {
			for _, r := range removable(after, other(st.Next)) {
				rr := r
				out = append(out, move{From: from, To: to, Remove: &rr})
			}
			return
		}
		out = append(out, move{From: from, To: to})
	}

	if hand(st, st.Next) > 0 {
		for to := 0; to < points; to++ {
			if st.Board[to] == "" {
				add(nil, to)
			}
		}
		return out
	}

	flying := count(st.Board, st.Next) == 3
	for from := 0; from < points; from++ {
		if st.Board[from] != st.Next {
			continue
		}
		if flying {
			for to := 0; to < points; to++ {
				if st.Board[to] == "" {
					f := from
					add(&f, to)
				}
			}
			continue
		}
		for _, to := range neighbours[from] {
			if st.Board[to] == "" {
				f := from
				add(&f, to)
			}
		}
	}
	return out
}

func init() {
	spec.Register(New())
}
