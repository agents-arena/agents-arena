// Package checkers implements English draughts (American checkers) as an arena
// game: an 8x8 board on the dark squares, seats R (red, moves first) and B,
// mandatory captures, multi-jumps taken one hop per move, and promotion to king
// on the far row.
package checkers

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

const (
	cols = 8
	rows = 8
	size = cols * rows // 64

	// idleLimit is the no-progress draw: 80 plies (40 moves each) with no
	// capture and no man moved means neither side can force anything.
	idleLimit = 80
)

// Piece codes as they appear on the wire: lowercase men, uppercase kings.
const (
	redMan    = "r"
	redKing   = "R"
	blackMan  = "b"
	blackKing = "B"
)

// state is the internal representation. "" denotes an empty square. Board is
// row-major with row 0 at the top; red starts at the bottom and moves up.
type state struct {
	Board [size]string `json:"-"`
	Next  string       `json:"-"`
	// Chain is the square of a piece that has just jumped and can jump again;
	// while it is set, only that piece may move and the turn does not pass.
	Chain int `json:"-"`
	// Idle counts plies since the last capture or man move.
	Idle int `json:"-"`
}

// move is the canonical move shape: the square a piece leaves and the square it
// lands on, both 0–63.
type move struct {
	From int `json:"from"`
	To   int `json:"to"`
}

type checkers struct{}

// New returns a new Checkers Rules implementation.
func New() spec.Rules {
	return checkers{}
}

func (checkers) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "checkers",
		Name:       "Checkers",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"R", "B"},
	}
}

// Init lays out the standard opening: twelve black men on the dark squares of
// the top three rows, twelve red men on the bottom three, red to move.
func (checkers) Init(seed string) any {
	var st state
	for i := 0; i < size; i++ {
		if !playable(i) {
			continue
		}
		switch r := i / cols; {
		case r < 3:
			st.Board[i] = blackMan
		case r > 4:
			st.Board[i] = redMan
		}
	}
	st.Next = "R"
	st.Chain = -1
	return st
}

func (g checkers) ToMove(s any) string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return ""
	}
	return st.Next
}

func (g checkers) Validate(s any, moveRaw json.RawMessage, seat string) error {
	st := s.(state)
	if g.Terminal(st) != nil {
		return errors.New("game over")
	}
	var m move
	if err := json.Unmarshal(moveRaw, &m); err != nil {
		return errors.New("square out of range")
	}
	if seat != st.Next {
		return errors.New("not your turn")
	}
	if m.From < 0 || m.From >= size || m.To < 0 || m.To >= size {
		return errors.New("square out of range")
	}
	if !ownedBy(st.Board[m.From], st.Next) {
		return errors.New("no piece of yours on that square")
	}
	if st.Chain >= 0 && m.From != st.Chain {
		return errors.New("must continue jumping with the piece on " + strconv.Itoa(st.Chain))
	}
	for _, legal := range moveList(st) {
		if legal == m {
			return nil
		}
	}
	// Distinguish the two mistakes agents actually make: ignoring a forced
	// capture, and simply moving somewhere the piece cannot go.
	if st.Chain < 0 && len(jumpsFor(st.Board, st.Next)) > 0 {
		return errors.New("captures are forced")
	}
	return errors.New("illegal move")
}

// Apply performs the move, removes a jumped piece, promotes on the far row, and
// passes the turn unless the same piece can jump again.
func (checkers) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)
	var m move
	// Best-effort; callers should only Apply after successful Validate.
	_ = json.Unmarshal(moveRaw, &m)

	next := state{Board: st.Board, Next: st.Next, Chain: -1, Idle: st.Idle}
	if m.From < 0 || m.From >= size || m.To < 0 || m.To >= size {
		return next
	}
	piece := next.Board[m.From]
	if piece == "" {
		return next
	}
	next.Board[m.From] = ""
	next.Board[m.To] = piece

	jumped := jumpedSquare(m)
	if jumped >= 0 {
		next.Board[jumped] = ""
	}

	promoted := false
	if isMan(piece) {
		if lastRow := promotionRow(st.Next); m.To/cols == lastRow {
			next.Board[m.To] = king(st.Next)
			promoted = true
		}
	}

	if jumped >= 0 || isMan(piece) {
		next.Idle = 0
	} else {
		next.Idle = st.Idle + 1
	}

	// A multi-jump continues with the same piece — but promotion ends the turn,
	// as in standard English draughts: a new king does not keep jumping.
	if jumped >= 0 && !promoted && len(jumpsFrom(next.Board, m.To)) > 0 {
		next.Chain = m.To
		return next
	}
	next.Next = other(st.Next)
	return next
}

func (g checkers) LegalMoves(s any) []json.RawMessage {
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

// Terminal ends the game when the side to move cannot move — whether because
// its pieces are gone or because they are all blocked — or when neither side
// has made progress for a long time.
func (checkers) Terminal(s any) *protocol.GameResult {
	st := s.(state)
	if len(moveList(st)) == 0 {
		reason := "no moves left"
		if count(st.Board, st.Next) == 0 {
			reason = "no pieces left"
		}
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: other(st.Next),
			Reason: reason,
		}
	}
	if st.Idle >= idleLimit {
		return &protocol.GameResult{Kind: protocol.ResultDraw, Reason: "no progress"}
	}
	return nil
}

// Hints tell the side to move when its choices are constrained — the two things
// that most often trip up an agent picking moves from the board rather than
// from /legal. Advisory only.
func (g checkers) Hints(s any) []string {
	st := s.(state)
	if g.Terminal(st) != nil {
		return nil
	}
	var out []string
	if st.Chain >= 0 {
		out = append(out, "you must keep jumping with the piece on "+strconv.Itoa(st.Chain))
	} else if len(jumpsFor(st.Board, st.Next)) > 0 {
		out = append(out, "captures are forced — only jumps are legal this turn")
	}
	if left := idleLimit - st.Idle; left <= 20 {
		out = append(out, "no capture or man move for "+strconv.Itoa(st.Idle)+
			" plies — the game is drawn in "+strconv.Itoa(left))
	}
	return out
}

func (checkers) Serialize(s any) json.RawMessage {
	st := s.(state)
	board := make([]any, size)
	for i, v := range st.Board {
		if v == "" {
			board[i] = nil
		} else {
			board[i] = v
		}
	}
	var chain any
	if st.Chain >= 0 {
		chain = st.Chain
	}
	data, _ := json.Marshal(struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
		Chain any    `json:"chain"`
		Idle  int    `json:"idle"`
	}{Board: board, Next: st.Next, Chain: chain, Idle: st.Idle})
	return data
}

func (checkers) Deserialize(data json.RawMessage) (any, error) {
	if len(data) == 0 {
		return nil, errors.New("empty state data")
	}
	var raw struct {
		Board []any  `json:"board"`
		Next  string `json:"next"`
		Chain *int   `json:"chain"`
		Idle  int    `json:"idle"`
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
			switch val {
			case redMan, redKing, blackMan, blackKing:
			default:
				return nil, errors.New("Invalid piece in serialized board")
			}
			if !playable(i) {
				return nil, errors.New("Invalid piece on a light square")
			}
			st.Board[i] = val
		default:
			return nil, errors.New("Invalid piece in serialized board")
		}
	}
	if raw.Next != "R" && raw.Next != "B" {
		return nil, errors.New("Invalid next in serialized state")
	}
	st.Next = raw.Next
	st.Chain = -1
	if raw.Chain != nil {
		if *raw.Chain < 0 || *raw.Chain >= size || !ownedBy(st.Board[*raw.Chain], st.Next) {
			return nil, errors.New("Invalid chain in serialized state")
		}
		st.Chain = *raw.Chain
	}
	if raw.Idle < 0 {
		return nil, errors.New("Invalid idle in serialized state")
	}
	st.Idle = raw.Idle
	return st, nil
}

// --- board helpers ------------------------------------------------------------

// playable reports whether a square is one of the 32 dark squares in play.
func playable(i int) bool { return (i/cols+i%cols)%2 == 1 }

func other(seat string) string {
	if seat == "R" {
		return "B"
	}
	return "R"
}

func isMan(piece string) bool  { return piece == redMan || piece == blackMan }
func isKing(piece string) bool { return piece == redKing || piece == blackKing }

// seatOf returns the seat that owns a piece, or "" for an empty square.
func seatOf(piece string) string {
	switch piece {
	case redMan, redKing:
		return "R"
	case blackMan, blackKing:
		return "B"
	}
	return ""
}

func ownedBy(piece, seat string) bool { return piece != "" && seatOf(piece) == seat }

func king(seat string) string {
	if seat == "R" {
		return redKing
	}
	return blackKing
}

// promotionRow is the row a man of seat must reach to be crowned: red starts at
// the bottom and is crowned on row 0, black the other way round.
func promotionRow(seat string) int {
	if seat == "R" {
		return 0
	}
	return rows - 1
}

// forward returns the row directions a piece may travel: one for a man, both
// for a king.
func forward(piece string) []int {
	if isKing(piece) {
		return []int{-1, 1}
	}
	if piece == redMan {
		return []int{-1} // red moves up the board
	}
	return []int{1}
}

func count(b [size]string, seat string) int {
	n := 0
	for _, p := range b {
		if seatOf(p) == seat {
			n++
		}
	}
	return n
}

// jumpedSquare returns the square a jump passes over, or -1 for a simple move.
func jumpedSquare(m move) int {
	fr, fc := m.From/cols, m.From%cols
	tr, tc := m.To/cols, m.To%cols
	if abs(tr-fr) != 2 || abs(tc-fc) != 2 {
		return -1
	}
	return (fr+tr)/2*cols + (fc+tc)/2
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// stepsFrom lists the simple diagonal moves available to the piece on from.
func stepsFrom(b [size]string, from int) []move {
	piece := b[from]
	if piece == "" {
		return nil
	}
	r, c := from/cols, from%cols
	var out []move
	for _, dr := range forward(piece) {
		for _, dc := range []int{-1, 1} {
			nr, nc := r+dr, c+dc
			if nr < 0 || nr >= rows || nc < 0 || nc >= cols {
				continue
			}
			if b[nr*cols+nc] == "" {
				out = append(out, move{From: from, To: nr*cols + nc})
			}
		}
	}
	return out
}

// jumpsFrom lists the captures available to the piece on from.
func jumpsFrom(b [size]string, from int) []move {
	piece := b[from]
	if piece == "" {
		return nil
	}
	opp := other(seatOf(piece))
	r, c := from/cols, from%cols
	var out []move
	for _, dr := range forward(piece) {
		for _, dc := range []int{-1, 1} {
			mr, mc := r+dr, c+dc     // the square jumped over
			lr, lc := r+2*dr, c+2*dc // the landing square
			if lr < 0 || lr >= rows || lc < 0 || lc >= cols {
				continue
			}
			if seatOf(b[mr*cols+mc]) != opp {
				continue
			}
			if b[lr*cols+lc] != "" {
				continue
			}
			out = append(out, move{From: from, To: lr*cols + lc})
		}
	}
	return out
}

func jumpsFor(b [size]string, seat string) []move {
	var out []move
	for i := 0; i < size; i++ {
		if ownedBy(b[i], seat) {
			out = append(out, jumpsFrom(b, i)...)
		}
	}
	return out
}

// moveList is the single source of legality: a chain in progress restricts play
// to that piece's jumps, an available capture makes captures compulsory, and
// otherwise simple moves are on.
func moveList(st state) []move {
	if st.Chain >= 0 {
		return jumpsFrom(st.Board, st.Chain)
	}
	if jumps := jumpsFor(st.Board, st.Next); len(jumps) > 0 {
		return jumps
	}
	var out []move
	for i := 0; i < size; i++ {
		if ownedBy(st.Board[i], st.Next) {
			out = append(out, stepsFrom(st.Board, i)...)
		}
	}
	return out
}

func init() {
	spec.Register(New())
}
