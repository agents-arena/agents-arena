// Package dotsandboxes implements Dots and Boxes as an arena game: a 5x5 grid
// of dots (16 boxes), seats A and B, one edge drawn per turn, and completing a
// box both claims it and grants another turn.
package dotsandboxes

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

const (
	// dots is the grid size (dots per side); boxes are one fewer per side.
	dots     = 5
	boxCols  = dots - 1          // 4
	boxRows  = dots - 1          // 4
	numBoxes = boxRows * boxCols // 16
	// Horizontal edges come first (5 dot-rows x 4 segments), then vertical
	// edges (4 dot-rows x 5 segments), so an edge is one integer 0-39.
	numH     = dots * boxCols // 20
	numV     = boxRows * dots // 20
	numEdges = numH + numV    // 40
)

// state is the internal representation. Edges and Boxes hold the seat that drew
// or claimed them, or "" when untouched.
type state struct {
	Edges [numEdges]string `json:"-"`
	Boxes [numBoxes]string `json:"-"`
	Next  string           `json:"-"`
}

// move is the canonical move shape: draw one edge (0–39).
type move struct {
	Edge int `json:"edge"`
}

type dab struct{}

// New returns a new Dots and Boxes Rules implementation.
func New() spec.Rules {
	return dab{}
}

func (dab) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "dots-and-boxes",
		Name:       "Dots and Boxes",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"A", "B"},
	}
}

func (dab) Init(seed string) any {
	return state{Next: "A"}
}

func (g dab) ToMove(s any) string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (g dab) Validate(s any, moveRaw json.RawMessage, seat string) error {
	st := s.(state)
	if g.Terminal(st) != nil {
		return errors.New("game over")
	}
	var m move
	if err := json.Unmarshal(moveRaw, &m); err != nil {
		return errors.New("edge out of range")
	}
	if seat != st.Next {
		return errors.New("not your turn")
	}
	if m.Edge < 0 || m.Edge >= numEdges {
		return errors.New("edge out of range")
	}
	if st.Edges[m.Edge] != "" {
		return errors.New("edge already drawn")
	}
	return nil
}

// Apply draws the edge, claims any box it completes, and only passes the turn
// when nothing was completed — the extra-turn rule is what makes long chains
// worth setting up.
func (dab) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)

	next := state{Edges: st.Edges, Boxes: st.Boxes, Next: st.Next} // arrays copy by value
	if m.Edge < 0 || m.Edge >= numEdges || next.Edges[m.Edge] != "" {
		return next
	}
	next.Edges[m.Edge] = st.Next

	claimed := 0
	for _, box := range boxesTouching(m.Edge) {
		if next.Boxes[box] == "" && boxComplete(next.Edges, box) {
			next.Boxes[box] = st.Next
			claimed++
		}
	}
	if claimed == 0 {
		next.Next = other(st.Next)
	}
	return next
}

func (g dab) LegalMoves(s any) []json.RawMessage {
	st := s.(state)
	if g.Terminal(st) != nil {
		return []json.RawMessage{}
	}
	var out []json.RawMessage
	for e := 0; e < numEdges; e++ {
		if st.Edges[e] == "" {
			b, _ := json.Marshal(move{Edge: e})
			out = append(out, b)
		}
	}
	return out
}

func (dab) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	for e := 0; e < numEdges; e++ {
		if st.Edges[e] == "" {
			return nil
		}
	}
	a, b := scores(st.Boxes)
	switch {
	case a > b:
		return &protocol.GameResult{Kind: protocol.ResultWin, Winner: "A", Reason: "more boxes"}
	case b > a:
		return &protocol.GameResult{Kind: protocol.ResultWin, Winner: "B", Reason: "more boxes"}
	default:
		return &protocol.GameResult{Kind: protocol.ResultDraw, Reason: "boxes split evenly"}
	}
}

// Hints tell the side to move whether there are boxes free for the taking, and
// warn when every remaining edge hands the opponent a box. Advisory only.
func (g dab) Hints(s any) []string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return nil
	}
	free := 0
	safe := 0
	for e := 0; e < numEdges; e++ {
		if st.Edges[e] != "" {
			continue
		}
		if completes(st, e) {
			free++
			continue
		}
		if !givesAway(st, e) {
			safe++
		}
	}
	var out []string
	if free > 0 {
		out = append(out, "you can claim "+strconv.Itoa(free)+" box(es) now — each one keeps the turn")
	}
	if free == 0 && safe == 0 {
		out = append(out, "every edge you can draw opens a box for your opponent — give away the smallest chain")
	}
	return out
}

func (dab) Serialize(s any) json.RawMessage {
	st := s.(state)
	edges := make([]any, numEdges)
	for i, v := range st.Edges {
		if v == "" {
			edges[i] = nil
		} else {
			edges[i] = v
		}
	}
	boxes := make([]any, numBoxes)
	for i, v := range st.Boxes {
		if v == "" {
			boxes[i] = nil
		} else {
			boxes[i] = v
		}
	}
	a, b := scores(st.Boxes)
	data, _ := json.Marshal(struct {
		Edges []any  `json:"edges"`
		Boxes []any  `json:"boxes"`
		Next  string `json:"next"`
		A     int    `json:"a"`
		B     int    `json:"b"`
	}{Edges: edges, Boxes: boxes, Next: st.Next, A: a, B: b})
	return data
}

func (dab) Deserialize(data json.RawMessage) (any, error) {
	if len(data) == 0 {
		return nil, errors.New("empty state data")
	}
	var raw struct {
		Edges []any  `json:"edges"`
		Boxes []any  `json:"boxes"`
		Next  string `json:"next"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if len(raw.Edges) != numEdges {
		return nil, errors.New("Invalid edges in serialized state")
	}
	if len(raw.Boxes) != numBoxes {
		return nil, errors.New("Invalid boxes in serialized state")
	}
	var st state
	for i, v := range raw.Edges {
		seat, err := seatOrEmpty(v)
		if err != nil {
			return nil, errors.New("Invalid edge in serialized state")
		}
		st.Edges[i] = seat
	}
	for i, v := range raw.Boxes {
		seat, err := seatOrEmpty(v)
		if err != nil {
			return nil, errors.New("Invalid box in serialized state")
		}
		st.Boxes[i] = seat
	}
	if raw.Next != "A" && raw.Next != "B" {
		return nil, errors.New("Invalid next in serialized state")
	}
	st.Next = raw.Next

	// A claimed box must actually be closed, and a closed box must be claimed —
	// otherwise Apply and Terminal would disagree about the score.
	for box := 0; box < numBoxes; box++ {
		if boxComplete(st.Edges, box) != (st.Boxes[box] != "") {
			return nil, errors.New("Invalid box ownership in serialized state")
		}
	}
	return st, nil
}

func seatOrEmpty(v any) (string, error) {
	switch val := v.(type) {
	case nil:
		return "", nil
	case string:
		if val != "A" && val != "B" {
			return "", errors.New("bad seat")
		}
		return val, nil
	default:
		return "", errors.New("bad seat")
	}
}

func other(seat string) string {
	if seat == "A" {
		return "B"
	}
	return "A"
}

// hEdge is the index of the horizontal edge on dot-row r, column c.
func hEdge(r, c int) int { return r*boxCols + c }

// vEdge is the index of the vertical edge on box-row r, dot-column c.
func vEdge(r, c int) int { return numH + r*dots + c }

// boxEdges returns the four edges that enclose a box: top, bottom, left, right.
func boxEdges(box int) [4]int {
	r, c := box/boxCols, box%boxCols
	return [4]int{hEdge(r, c), hEdge(r+1, c), vEdge(r, c), vEdge(r, c+1)}
}

// boxesTouching returns the one or two boxes an edge borders.
func boxesTouching(edge int) []int {
	var out []int
	if edge < numH {
		r, c := edge/boxCols, edge%boxCols
		if r > 0 {
			out = append(out, (r-1)*boxCols+c) // box above
		}
		if r < boxRows {
			out = append(out, r*boxCols+c) // box below
		}
		return out
	}
	v := edge - numH
	r, c := v/dots, v%dots
	if c > 0 {
		out = append(out, r*boxCols+(c-1)) // box to the left
	}
	if c < boxCols {
		out = append(out, r*boxCols+c) // box to the right
	}
	return out
}

func boxComplete(edges [numEdges]string, box int) bool {
	for _, e := range boxEdges(box) {
		if edges[e] == "" {
			return false
		}
	}
	return true
}

func drawnSides(edges [numEdges]string, box int) int {
	n := 0
	for _, e := range boxEdges(box) {
		if edges[e] != "" {
			n++
		}
	}
	return n
}

// completes reports whether drawing edge would close at least one box.
func completes(st state, edge int) bool {
	for _, box := range boxesTouching(edge) {
		if drawnSides(st.Edges, box) == 3 {
			return true
		}
	}
	return false
}

// givesAway reports whether drawing edge would leave a box on three sides —
// handing the opponent a free box (and the turn back).
func givesAway(st state, edge int) bool {
	for _, box := range boxesTouching(edge) {
		if drawnSides(st.Edges, box) == 2 {
			return true
		}
	}
	return false
}

func scores(boxes [numBoxes]string) (a, b int) {
	for _, v := range boxes {
		switch v {
		case "A":
			a++
		case "B":
			b++
		}
	}
	return a, b
}

func init() {
	spec.Register(New())
}
