// Package bot is a headless game-playing loop driven entirely by the server
// HTTP API — the reference "terminal agent". It ships smart heuristics for
// tic-tac-toe, Connect Four, Reversi, Gomoku, Dots and Boxes, Checkers and
// Hex, and falls back to random-legal picks for any game that exposes the
// /v1/rooms/{id}/legal endpoint (chess, etc.).
//
// Reasoning-mode contract: under a room's declared reasoning mode "self"
// (protocol.ReasoningSelf), a bot must not use external solvers, engines, or
// tablebases to choose its move — it must reason itself. Agents can read
// protocol.Snapshot.Reasoning to check the room's declared mode if they need
// to gate behavior. These reference bots (in-process heuristics and
// random-legal chess picker) are simple algorithms with no external solver
// calls, so they are always honestly labeled Method: "engine" regardless of
// the room's reasoning mode.
package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/agents-arena/agents-arena/agent/client"
	protocol "github.com/agents-arena/agents-arena/protocol"
)

// --- tic-tac-toe state & heuristics -------------------------------------------

type tttState struct {
	Board [9]*string `json:"board"`
	Next  string     `json:"next"`
}

var lines = [8][3]int{
	{0, 1, 2}, {3, 4, 5}, {6, 7, 8},
	{0, 3, 6}, {1, 4, 7}, {2, 5, 8},
	{0, 4, 8}, {2, 4, 6},
}

func board(snap protocol.Snapshot) ([9]string, error) {
	var s tttState
	if err := json.Unmarshal(snap.State, &s); err != nil {
		return [9]string{}, err
	}
	var b [9]string
	for i, c := range s.Board {
		if c != nil {
			b[i] = *c
		}
	}
	return b, nil
}

func empties(b [9]string) []int {
	var e []int
	for i, v := range b {
		if v == "" {
			e = append(e, i)
		}
	}
	return e
}

func winsWith(b [9]string, cell int, seat string) bool {
	c := b
	c[cell] = seat
	for _, ln := range lines {
		if c[ln[0]] == seat && c[ln[1]] == seat && c[ln[2]] == seat {
			return true
		}
	}
	return false
}

func threat(b [9]string, seat string) bool {
	for _, ln := range lines {
		cnt, empty := 0, false
		for _, i := range ln {
			switch b[i] {
			case seat:
				cnt++
			case "":
				empty = true
			}
		}
		if cnt == 2 && empty {
			return true
		}
	}
	return false
}

func other(seat string) string {
	if seat == "X" {
		return "O"
	}
	return "X"
}

func choose(b [9]string, seat string) int {
	opp := other(seat)
	e := empties(b)
	for _, c := range e {
		if winsWith(b, c, seat) {
			return c
		}
	}
	for _, c := range e {
		if winsWith(b, c, opp) {
			return c
		}
	}
	if b[4] == "" {
		return 4
	}
	for _, c := range []int{0, 2, 6, 8} {
		if b[c] == "" {
			return c
		}
	}
	if len(e) > 0 {
		return e[0]
	}
	return -1
}

// --- Connect Four state & heuristics ------------------------------------------

const (
	c4Cols = 7
	c4Rows = 6
	c4Size = c4Cols * c4Rows
)

type c4Wire struct {
	Board [c4Size]*string `json:"board"`
	Next  string          `json:"next"`
}

func c4Board(snap protocol.Snapshot) ([c4Size]string, error) {
	var s c4Wire
	if err := json.Unmarshal(snap.State, &s); err != nil {
		return [c4Size]string{}, err
	}
	var b [c4Size]string
	for i, c := range s.Board {
		if c != nil {
			b[i] = *c
		}
	}
	return b, nil
}

func c4Other(seat string) string {
	if seat == "R" {
		return "Y"
	}
	return "R"
}

func c4DropRow(b [c4Size]string, col int) int {
	for r := c4Rows - 1; r >= 0; r-- {
		if b[r*c4Cols+col] == "" {
			return r
		}
	}
	return -1
}

func c4OpenColumns(b [c4Size]string) []int {
	var out []int
	for c := 0; c < c4Cols; c++ {
		if c4DropRow(b, c) >= 0 {
			out = append(out, c)
		}
	}
	return out
}

func c4Wins(b [c4Size]string, seat string) bool {
	dirs := [][2]int{{0, 1}, {1, 0}, {1, 1}, {1, -1}}
	for r := 0; r < c4Rows; r++ {
		for c := 0; c < c4Cols; c++ {
			if b[r*c4Cols+c] != seat {
				continue
			}
			for _, d := range dirs {
				ok := true
				for k := 1; k < 4; k++ {
					rr, cc := r+d[0]*k, c+d[1]*k
					if rr < 0 || rr >= c4Rows || cc < 0 || cc >= c4Cols || b[rr*c4Cols+cc] != seat {
						ok = false
						break
					}
				}
				if ok {
					return true
				}
			}
		}
	}
	return false
}

// c4Drop returns b with seat's disc dropped into col. Callers must know col is open.
func c4Drop(b [c4Size]string, col int, seat string) [c4Size]string {
	nb := b
	nb[c4DropRow(nb, col)*c4Cols+col] = seat
	return nb
}

// c4Choose picks a column: win now, else block the opponent's win, else the
// most central column that doesn't hand the opponent a win on top of our disc.
func c4Choose(b [c4Size]string, seat string) int {
	opp := c4Other(seat)
	open := c4OpenColumns(b)
	if len(open) == 0 {
		return -1
	}
	for _, col := range open {
		if c4Wins(c4Drop(b, col, seat), seat) {
			return col
		}
	}
	for _, col := range open {
		if c4Wins(c4Drop(b, col, opp), opp) {
			return col
		}
	}
	// A column is "safe" unless dropping here uncovers a winning square for the
	// opponent directly above. Prefer safe columns; if every column is poisoned
	// the position is lost anyway, so fall back to the same center preference.
	safe := func(col int) bool {
		after := c4Drop(b, col, seat)
		if c4DropRow(after, col) < 0 {
			return true // that column is now full — nothing lands on top
		}
		return !c4Wins(c4Drop(after, col, opp), opp)
	}
	center := []int{3, 2, 4, 1, 5, 0, 6}
	for _, onlySafe := range []bool{true, false} {
		for _, pref := range center {
			for _, col := range open {
				if col == pref && (!onlySafe || safe(col)) {
					return col
				}
			}
		}
	}
	return open[0]
}

// --- reversi state & heuristics -----------------------------------------------

const (
	rvCols = 8
	rvRows = 8
	rvSize = rvCols * rvRows
)

// rvSquareValue scores every square positionally: corners are permanent, the
// X- and C-squares next to an empty corner usually give one away, and edges beat
// the interior. Row 0 is the top row, matching the wire board.
var rvSquareValue = [rvSize]int{
	120, -20, 20, 5, 5, 20, -20, 120,
	-20, -40, -5, -5, -5, -5, -40, -20,
	20, -5, 15, 3, 3, 15, -5, 20,
	5, -5, 3, 3, 3, 3, -5, 5,
	5, -5, 3, 3, 3, 3, -5, 5,
	20, -5, 15, 3, 3, 15, -5, 20,
	-20, -40, -5, -5, -5, -5, -40, -20,
	120, -20, 20, 5, 5, 20, -20, 120,
}

// rvCornerOf maps each X- and C-square to the corner it guards.
var rvCornerOf = map[int]int{
	1: 0, 8: 0, 9: 0,
	6: 7, 15: 7, 14: 7,
	48: 56, 57: 56, 49: 56,
	62: 63, 55: 63, 54: 63,
}

var rvDirections = [8][2]int{
	{-1, -1}, {-1, 0}, {-1, 1},
	{0, -1}, {0, 1},
	{1, -1}, {1, 0}, {1, 1},
}

type rvWire struct {
	Board [rvSize]*string `json:"board"`
	Next  string          `json:"next"`
}

func rvBoard(snap protocol.Snapshot) ([rvSize]string, error) {
	var s rvWire
	if err := json.Unmarshal(snap.State, &s); err != nil {
		return [rvSize]string{}, err
	}
	var b [rvSize]string
	for i, c := range s.Board {
		if c != nil {
			b[i] = *c
		}
	}
	return b, nil
}

func rvOther(seat string) string {
	if seat == "B" {
		return "W"
	}
	return "B"
}

// rvFlips returns the discs seat would capture by playing cell — empty when the
// move is illegal.
func rvFlips(b [rvSize]string, cell int, seat string) []int {
	if cell < 0 || cell >= rvSize || b[cell] != "" {
		return nil
	}
	opp := rvOther(seat)
	row, col := cell/rvCols, cell%rvCols
	var out []int
	for _, d := range rvDirections {
		var run []int
		r, c := row+d[0], col+d[1]
		for r >= 0 && r < rvRows && c >= 0 && c < rvCols && b[r*rvCols+c] == opp {
			run = append(run, r*rvCols+c)
			r += d[0]
			c += d[1]
		}
		if len(run) > 0 && r >= 0 && r < rvRows && c >= 0 && c < rvCols && b[r*rvCols+c] == seat {
			out = append(out, run...)
		}
	}
	return out
}

func rvLegal(b [rvSize]string, seat string) []int {
	var out []int
	for i := 0; i < rvSize; i++ {
		if b[i] == "" && len(rvFlips(b, i, seat)) > 0 {
			out = append(out, i)
		}
	}
	return out
}

// rvPlay returns b with seat's disc on cell and every bracketed disc flipped.
func rvPlay(b [rvSize]string, cell int, seat string) [rvSize]string {
	nb := b
	captured := rvFlips(b, cell, seat)
	if len(captured) == 0 {
		return nb
	}
	nb[cell] = seat
	for _, i := range captured {
		nb[i] = seat
	}
	return nb
}

func rvCount(b [rvSize]string, seat string) int {
	n := 0
	for _, v := range b {
		if v == seat {
			n++
		}
	}
	return n
}

func rvEmpties(b [rvSize]string) int {
	n := 0
	for _, v := range b {
		if v == "" {
			n++
		}
	}
	return n
}

// rvChoose picks a square. Corners are taken on sight; otherwise the bot scores
// each move by square value, the opponent's resulting mobility, and — only in
// the endgame, where the count is what actually settles the match — the discs
// it flips. Squares next to an empty corner are penalised because they usually
// hand that corner over.
func rvChoose(b [rvSize]string, seat string) int {
	legal := rvLegal(b, seat)
	if len(legal) == 0 {
		return -1
	}
	opp := rvOther(seat)
	endgame := rvEmpties(b) <= 12

	best, bestScore := legal[0], 0
	for i, cell := range legal {
		after := rvPlay(b, cell, seat)
		score := rvSquareValue[cell]
		if corner, guarded := rvCornerOf[cell]; guarded && b[corner] == "" {
			score -= 40
		}
		// Every move the opponent keeps is a move they can use against us.
		score -= 6 * len(rvLegal(after, opp))
		if endgame {
			score += 3 * rvCount(after, seat)
		} else {
			// Flipping less early leaves a smaller, safer frontier.
			score -= len(rvFlips(b, cell, seat))
		}
		if i == 0 || score > bestScore {
			best, bestScore = cell, score
		}
	}
	return best
}

// --- gomoku state & heuristics ------------------------------------------------

const (
	gmCols = 15
	gmRows = 15
	gmSize = gmCols * gmRows
	gmWin  = 5
)

var gmDirs = [4][2]int{{0, 1}, {1, 0}, {1, 1}, {1, -1}}

type gmWire struct {
	Board [gmSize]*string `json:"board"`
	Next  string          `json:"next"`
	Last  *int            `json:"last"`
}

func gmBoard(snap protocol.Snapshot) ([gmSize]string, error) {
	var s gmWire
	if err := json.Unmarshal(snap.State, &s); err != nil {
		return [gmSize]string{}, err
	}
	var b [gmSize]string
	for i, c := range s.Board {
		if c != nil {
			b[i] = *c
		}
	}
	return b, nil
}

func gmOther(seat string) string {
	if seat == "B" {
		return "W"
	}
	return "B"
}

// gmLineScore rates the line seat would own through cell in one direction: how
// many stones join up, and how many of the two ends stay open. An open four
// wins next move; a closed three is nearly worthless.
func gmLineScore(b [gmSize]string, cell int, dr, dc int, seat string) int {
	r, c := cell/gmCols, cell%gmCols
	run := 1
	open := 0
	for _, sign := range []int{1, -1} {
		rr, cc := r+dr*sign, c+dc*sign
		for rr >= 0 && rr < gmRows && cc >= 0 && cc < gmCols && b[rr*gmCols+cc] == seat {
			run++
			rr += dr * sign
			cc += dc * sign
		}
		if rr >= 0 && rr < gmRows && cc >= 0 && cc < gmCols && b[rr*gmCols+cc] == "" {
			open++
		}
	}
	switch {
	case run >= gmWin:
		return 1000000
	case run == 4 && open >= 1:
		return 10000
	case run == 3 && open == 2:
		return 1000
	case run == 3 && open == 1:
		return 100
	case run == 2 && open == 2:
		return 50
	case run == 2 && open == 1:
		return 10
	default:
		return open
	}
}

// gmValue scores a candidate point for seat: what it builds, plus what it
// denies. Denial is weighted just under construction, so the bot blocks a live
// four but still prefers completing its own five.
func gmValue(b [gmSize]string, cell int, seat string) int {
	opp := gmOther(seat)
	mine, theirs := 0, 0
	for _, d := range gmDirs {
		mine += gmLineScore(b, cell, d[0], d[1], seat)
		theirs += gmLineScore(b, cell, d[0], d[1], opp)
	}
	// Centre tie-break: nearer the middle is worth a hair more.
	r, c := cell/gmCols, cell%gmCols
	centre := 14 - (gmAbs(r-7) + gmAbs(c-7))
	return 2*mine + theirs + centre
}

func gmAbs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// gmCandidates lists empty points within two of a stone — the only points worth
// considering once anything is on the board.
func gmCandidates(b [gmSize]string) []int {
	empty := true
	for _, v := range b {
		if v != "" {
			empty = false
			break
		}
	}
	if empty {
		return []int{7*gmCols + 7} // the centre opening
	}
	var out []int
	for i := 0; i < gmSize; i++ {
		if b[i] != "" {
			continue
		}
		r, c := i/gmCols, i%gmCols
		near := false
		for dr := -2; dr <= 2 && !near; dr++ {
			for dc := -2; dc <= 2; dc++ {
				rr, cc := r+dr, c+dc
				if rr >= 0 && rr < gmRows && cc >= 0 && cc < gmCols && b[rr*gmCols+cc] != "" {
					near = true
					break
				}
			}
		}
		if near {
			out = append(out, i)
		}
	}
	return out
}

// gmWinsAt reports whether seat playing cell completes five or more in a row.
func gmWinsAt(b [gmSize]string, cell int, seat string) bool {
	if cell < 0 || cell >= gmSize || b[cell] != "" {
		return false
	}
	r, c := cell/gmCols, cell%gmCols
	for _, d := range gmDirs {
		run := 1
		for _, sign := range []int{1, -1} {
			rr, cc := r+d[0]*sign, c+d[1]*sign
			for rr >= 0 && rr < gmRows && cc >= 0 && cc < gmCols && b[rr*gmCols+cc] == seat {
				run++
				rr += d[0] * sign
				cc += d[1] * sign
			}
		}
		if run >= gmWin {
			return true
		}
	}
	return false
}

// gmWinCount counts the empty points where seat would complete five right now.
// Two or more is a double threat: the opponent can only answer one of them.
func gmWinCount(b [gmSize]string, seat string) int {
	n := 0
	for i := 0; i < gmSize; i++ {
		if b[i] == "" && gmWinsAt(b, i, seat) {
			n++
		}
	}
	return n
}

// gmWith returns b with seat's stone on cell.
func gmWith(b [gmSize]string, cell int, seat string) [gmSize]string {
	nb := b
	nb[cell] = seat
	return nb
}

// gmChoose picks a point, in priority order: win now; stop an immediate loss;
// create a double threat (two winning points at once, which cannot all be
// blocked); pre-empt the opponent doing the same; otherwise take the
// highest-scoring point near the action.
//
// Without the double-threat steps two of these bots simply block each other's
// fours forever and fill all 225 points to a draw — mutual blocking is stable,
// and only an unanswerable fork breaks it.
func gmChoose(b [gmSize]string, seat string) int {
	opp := gmOther(seat)
	cands := gmCandidates(b)
	if len(cands) == 0 {
		return -1
	}
	for _, cell := range cands {
		if gmWinsAt(b, cell, seat) {
			return cell
		}
	}
	for _, cell := range cands {
		if gmWinsAt(b, cell, opp) {
			return cell
		}
	}
	for _, cell := range cands {
		if gmWinCount(gmWith(b, cell, seat), seat) >= 2 {
			return cell
		}
	}
	for _, cell := range cands {
		if gmWinCount(gmWith(b, cell, opp), opp) >= 2 {
			return cell
		}
	}
	best, bestScore := cands[0], 0
	for i, cell := range cands {
		if v := gmValue(b, cell, seat); i == 0 || v > bestScore {
			best, bestScore = cell, v
		}
	}
	return best
}

// --- dots and boxes state & heuristics ----------------------------------------

const (
	dbDots   = 5
	dbBoxCol = dbDots - 1               // 4
	dbBoxRow = dbDots - 1               // 4
	dbBoxes  = dbBoxRow * dbBoxCol      // 16
	dbNumH   = dbDots * dbBoxCol        // 20
	dbEdges  = dbNumH + dbBoxRow*dbDots // 40
)

type dbWire struct {
	Edges [dbEdges]*string `json:"edges"`
	Boxes [dbBoxes]*string `json:"boxes"`
	Next  string           `json:"next"`
}

// dbGrid is the drawn/undrawn state of every edge.
type dbGrid [dbEdges]bool

func dbBoard(snap protocol.Snapshot) (dbGrid, error) {
	var s dbWire
	if err := json.Unmarshal(snap.State, &s); err != nil {
		return dbGrid{}, err
	}
	var g dbGrid
	for i, e := range s.Edges {
		g[i] = e != nil
	}
	return g, nil
}

func dbH(r, c int) int { return r*dbBoxCol + c }
func dbV(r, c int) int { return dbNumH + r*dbDots + c }

func dbBoxEdges(box int) [4]int {
	r, c := box/dbBoxCol, box%dbBoxCol
	return [4]int{dbH(r, c), dbH(r+1, c), dbV(r, c), dbV(r, c+1)}
}

func dbBoxesTouching(edge int) []int {
	var out []int
	if edge < dbNumH {
		r, c := edge/dbBoxCol, edge%dbBoxCol
		if r > 0 {
			out = append(out, (r-1)*dbBoxCol+c)
		}
		if r < dbBoxRow {
			out = append(out, r*dbBoxCol+c)
		}
		return out
	}
	v := edge - dbNumH
	r, c := v/dbDots, v%dbDots
	if c > 0 {
		out = append(out, r*dbBoxCol+(c-1))
	}
	if c < dbBoxCol {
		out = append(out, r*dbBoxCol+c)
	}
	return out
}

func dbSides(g dbGrid, box int) int {
	n := 0
	for _, e := range dbBoxEdges(box) {
		if g[e] {
			n++
		}
	}
	return n
}

// dbClaims counts the boxes drawing edge would close.
func dbClaims(g dbGrid, edge int) int {
	n := 0
	for _, box := range dbBoxesTouching(edge) {
		if dbSides(g, box) == 3 {
			n++
		}
	}
	return n
}

// dbOpens counts the boxes drawing edge would leave on three sides — each one a
// free box for the opponent.
func dbOpens(g dbGrid, edge int) int {
	n := 0
	for _, box := range dbBoxesTouching(edge) {
		if dbSides(g, box) == 2 {
			n++
		}
	}
	return n
}

// dbChainSize measures how much a sacrifice really costs: from each box the
// edge opens, walk through neighbouring boxes that are also nearly closed, since
// the opponent takes the whole chain in one visit.
func dbChainSize(g dbGrid, edge int) int {
	after := g
	after[edge] = true
	seen := map[int]bool{}
	var queue []int
	for _, box := range dbBoxesTouching(edge) {
		if dbSides(after, box) == 3 {
			queue = append(queue, box)
		}
	}
	size := 0
	for len(queue) > 0 {
		box := queue[0]
		queue = queue[1:]
		if seen[box] {
			continue
		}
		seen[box] = true
		size++
		// Taking this box opens its remaining edge; anything behind it falls too.
		for _, e := range dbBoxEdges(box) {
			if after[e] {
				continue
			}
			for _, nb := range dbBoxesTouching(e) {
				if nb != box && !seen[nb] && dbSides(after, nb) >= 2 {
					queue = append(queue, nb)
				}
			}
		}
	}
	return size
}

// dbChoose picks an edge: close a box if one is there (taking the double when
// offered), otherwise play a safe edge, and if every edge is a sacrifice, give
// away the shortest chain.
func dbChoose(g dbGrid, _ string) int {
	free := -1
	freeClaims := 0
	safe := -1
	sacrifice := -1
	sacrificeCost := 0
	for e := 0; e < dbEdges; e++ {
		if g[e] {
			continue
		}
		if claims := dbClaims(g, e); claims > 0 {
			if claims > freeClaims {
				free, freeClaims = e, claims
			}
			continue
		}
		if dbOpens(g, e) == 0 {
			if safe < 0 {
				safe = e
			}
			continue
		}
		if cost := dbChainSize(g, e); sacrifice < 0 || cost < sacrificeCost {
			sacrifice, sacrificeCost = e, cost
		}
	}
	switch {
	case free >= 0:
		return free
	case safe >= 0:
		return safe
	default:
		return sacrifice
	}
}

// --- checkers state & heuristics ----------------------------------------------

const ckSize = 64

type ckWire struct {
	Board [ckSize]*string `json:"board"`
	Next  string          `json:"next"`
	Chain *int            `json:"chain"`
}

// ckPos is what the bot needs from a snapshot: the pieces and whose move it is.
type ckPos struct {
	board [ckSize]string
	chain int
}

func ckBoard(snap protocol.Snapshot) (ckPos, error) {
	var w ckWire
	if err := json.Unmarshal(snap.State, &w); err != nil {
		return ckPos{}, err
	}
	p := ckPos{chain: -1}
	for i, c := range w.Board {
		if c != nil {
			p.board[i] = *c
		}
	}
	if w.Chain != nil {
		p.chain = *w.Chain
	}
	return p, nil
}

type ckMove struct {
	From int `json:"from"`
	To   int `json:"to"`
}

func ckSeatOf(piece string) string {
	switch piece {
	case "r", "R":
		return "R"
	case "b", "B":
		return "B"
	}
	return ""
}

func ckOther(seat string) string {
	if seat == "R" {
		return "B"
	}
	return "R"
}

func ckIsKing(piece string) bool { return piece == "R" || piece == "B" }

// ckDirs are the row directions a piece may travel: kings both ways, men
// forwards only — red up the board, black down it.
func ckDirs(piece string) []int {
	if ckIsKing(piece) {
		return []int{-1, 1}
	}
	if piece == "r" {
		return []int{-1}
	}
	return []int{1}
}

func ckJumpsFrom(b [ckSize]string, from int) []ckMove {
	piece := b[from]
	if piece == "" {
		return nil
	}
	opp := ckOther(ckSeatOf(piece))
	r, c := from/8, from%8
	var out []ckMove
	for _, dr := range ckDirs(piece) {
		for _, dc := range []int{-1, 1} {
			mr, mc := r+dr, c+dc
			lr, lc := r+2*dr, c+2*dc
			if lr < 0 || lr > 7 || lc < 0 || lc > 7 {
				continue
			}
			if ckSeatOf(b[mr*8+mc]) != opp || b[lr*8+lc] != "" {
				continue
			}
			out = append(out, ckMove{From: from, To: lr*8 + lc})
		}
	}
	return out
}

func ckStepsFrom(b [ckSize]string, from int) []ckMove {
	piece := b[from]
	if piece == "" {
		return nil
	}
	r, c := from/8, from%8
	var out []ckMove
	for _, dr := range ckDirs(piece) {
		for _, dc := range []int{-1, 1} {
			nr, nc := r+dr, c+dc
			if nr < 0 || nr > 7 || nc < 0 || nc > 7 {
				continue
			}
			if b[nr*8+nc] == "" {
				out = append(out, ckMove{From: from, To: nr*8 + nc})
			}
		}
	}
	return out
}

// ckLegal mirrors the server's rules: a chain restricts play to one piece,
// captures are compulsory, and otherwise every quiet move is on.
func ckLegal(p ckPos, seat string) []ckMove {
	if p.chain >= 0 {
		return ckJumpsFrom(p.board, p.chain)
	}
	var jumps, steps []ckMove
	for i := 0; i < ckSize; i++ {
		if ckSeatOf(p.board[i]) != seat {
			continue
		}
		jumps = append(jumps, ckJumpsFrom(p.board, i)...)
		steps = append(steps, ckStepsFrom(p.board, i)...)
	}
	if len(jumps) > 0 {
		return jumps
	}
	return steps
}

// ckApply plays a move on a copy of the board, returning the new board and
// whether the same piece can jump again (promotion ends the turn).
func ckApply(b [ckSize]string, m ckMove, seat string) ([ckSize]string, bool) {
	nb := b
	piece := nb[m.From]
	nb[m.From] = ""
	nb[m.To] = piece
	jumped := -1
	if abs8(m.To/8-m.From/8) == 2 {
		jumped = (m.From/8+m.To/8)/2*8 + (m.From%8+m.To%8)/2
		nb[jumped] = ""
	}
	promoted := false
	if !ckIsKing(piece) {
		crown := 7
		if seat == "R" {
			crown = 0
		}
		if m.To/8 == crown {
			if seat == "R" {
				nb[m.To] = "R"
			} else {
				nb[m.To] = "B"
			}
			promoted = true
		}
	}
	return nb, jumped >= 0 && !promoted && len(ckJumpsFrom(nb, m.To)) > 0
}

func abs8(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// ckMaterial scores a position from seat's point of view: kings are worth
// roughly one and a half men, and men are worth more the closer they get to
// being crowned.
func ckMaterial(b [ckSize]string, seat string) int {
	score := 0
	for i, p := range b {
		if p == "" {
			continue
		}
		v := 10
		if ckIsKing(p) {
			v = 15
		} else if p == "r" {
			v += (7 - i/8) / 2 // red advances upward
		} else {
			v += (i / 8) / 2
		}
		if ckSeatOf(p) == seat {
			score += v
		} else {
			score -= v
		}
	}
	return score
}

// ckChoose picks a move by material after the opponent's best reply — enough to
// take free pieces, finish multi-jumps, and not walk into an obvious capture.
func ckChoose(p ckPos, seat string) (ckMove, bool) {
	moves := ckLegal(p, seat)
	if len(moves) == 0 {
		return ckMove{}, false
	}
	best, bestScore := moves[0], 0
	for i, m := range moves {
		nb, again := ckApply(p.board, m, seat)
		score := ckMaterial(nb, seat)
		if !again {
			// What does the opponent take in reply? Assume their best jump.
			reply := ckLegal(ckPos{board: nb, chain: -1}, ckOther(seat))
			worst := 0
			for j, rm := range reply {
				rb, _ := ckApply(nb, rm, ckOther(seat))
				s := ckMaterial(rb, seat)
				if j == 0 || s < worst {
					worst = s
				}
			}
			if len(reply) > 0 {
				score = worst
			}
		}
		if i == 0 || score > bestScore {
			best, bestScore = m, score
		}
	}
	return best, true
}

// --- hex state & heuristics ---------------------------------------------------

const (
	hxCols = 11
	hxRows = 11
	hxSize = hxCols * hxRows
)

type hxWire struct {
	Board [hxSize]*string `json:"board"`
	Next  string          `json:"next"`
	Last  *int            `json:"last"`
}

func hxBoard(snap protocol.Snapshot) ([hxSize]string, error) {
	var w hxWire
	if err := json.Unmarshal(snap.State, &w); err != nil {
		return [hxSize]string{}, err
	}
	var b [hxSize]string
	for i, c := range w.Board {
		if c != nil {
			b[i] = *c
		}
	}
	return b, nil
}

func hxOther(seat string) string {
	if seat == "R" {
		return "B"
	}
	return "R"
}

// hxNeighbours returns the up-to-six adjacent cells. On a row-major rhombus the
// diagonals that count are north-east and south-west.
func hxNeighbours(i int) []int {
	r, c := i/hxCols, i%hxCols
	deltas := [6][2]int{{0, -1}, {0, 1}, {-1, 0}, {1, 0}, {-1, 1}, {1, -1}}
	out := make([]int, 0, 6)
	for _, d := range deltas {
		nr, nc := r+d[0], c+d[1]
		if nr >= 0 && nr < hxRows && nc >= 0 && nc < hxCols {
			out = append(out, nr*hxCols+nc)
		}
	}
	return out
}

// hxDistance is the cheapest path connecting seat's two edges: own stones cost
// nothing to traverse, empty cells cost one, and the opponent's are impassable.
// Zero means the game is already won. Dial's algorithm over 0/1 weights.
func hxDistance(b [hxSize]string, seat string) int {
	const inf = 1 << 30
	dist := make([]int, hxSize)
	for i := range dist {
		dist[i] = inf
	}
	// A double-ended queue: 0-cost moves go to the front, 1-cost to the back.
	deque := make([]int, 0, hxSize*2)
	push := func(cell, d int, front bool) {
		if d >= dist[cell] {
			return
		}
		dist[cell] = d
		if front {
			deque = append([]int{cell}, deque...)
		} else {
			deque = append(deque, cell)
		}
	}
	for i := 0; i < hxCols; i++ {
		start := i // blue enters on row 0
		if seat == "R" {
			start = i * hxCols // red enters on column 0
		}
		switch b[start] {
		case seat:
			push(start, 0, true)
		case "":
			push(start, 1, false)
		}
	}
	best := inf
	for len(deque) > 0 {
		cur := deque[0]
		deque = deque[1:]
		d := dist[cur]
		if d >= best {
			continue
		}
		atGoal := cur%hxCols == hxCols-1
		if seat == "B" {
			atGoal = cur/hxCols == hxRows-1
		}
		if atGoal {
			if d < best {
				best = d
			}
			continue
		}
		for _, n := range hxNeighbours(cur) {
			switch b[n] {
			case seat:
				push(n, d, true)
			case "":
				push(n, d+1, false)
			}
		}
	}
	return best
}

// hxChoose plays the cell that most improves our connection relative to the
// opponent's: win now if a stone connects us, block if one connects them, else
// minimise our path length while lengthening theirs.
func hxChoose(b [hxSize]string, seat string) int {
	opp := hxOther(seat)
	var empties []int
	for i := 0; i < hxSize; i++ {
		if b[i] == "" {
			empties = append(empties, i)
		}
	}
	if len(empties) == 0 {
		return -1
	}
	for _, cell := range empties {
		nb := b
		nb[cell] = seat
		if hxDistance(nb, seat) == 0 {
			return cell
		}
	}
	for _, cell := range empties {
		nb := b
		nb[cell] = opp
		if hxDistance(nb, opp) == 0 {
			return cell
		}
	}
	best, bestScore := empties[0], 0
	for i, cell := range empties {
		nb := b
		nb[cell] = seat
		// Weigh cutting the opponent as heavily as building our own path: a
		// stone that only extends our chain while theirs shortens is a losing
		// trade. Ties go to the centre — without that tie-break the bot walks
		// along whichever edge happens to come first in index order, which is
		// how an early version managed to fill row 0 while losing.
		r, c := cell/hxCols, cell%hxCols
		centre := hxCols - (abs8(r-hxRows/2) + abs8(c-hxCols/2))
		score := 4*(hxDistance(nb, opp)-hxDistance(nb, seat)) + centre
		if i == 0 || score > bestScore {
			best, bestScore = cell, score
		}
	}
	return best
}

// --- chess / generic legal-move pick ------------------------------------------

type chessMove struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Promotion string `json:"promotion,omitempty"`
}

func isSpecialMove(m json.RawMessage) bool {
	var mp map[string]json.RawMessage
	if json.Unmarshal(m, &mp) != nil {
		return false
	}
	_, claim := mp["claim"]
	_, resign := mp["resign"]
	return claim || resign
}

func pickLegal(c *client.Client, room, gameID string) (json.RawMessage, string, error) {
	legals, err := c.Legal(room)
	if err != nil {
		return nil, "", err
	}
	if len(legals) == 0 {
		return nil, "", fmt.Errorf("no legal moves")
	}

	var nonSpecial, special []json.RawMessage
	for _, m := range legals {
		if isSpecialMove(m) {
			special = append(special, m)
		} else {
			nonSpecial = append(nonSpecial, m)
		}
	}
	sample := nonSpecial
	if len(sample) == 0 {
		for _, m := range special {
			var mp map[string]json.RawMessage
			json.Unmarshal(m, &mp)
			if _, ok := mp["claim"]; ok {
				return m, "random-legal", nil
			}
		}
		if len(special) > 0 {
			return special[0], "random-legal", nil
		}
		return nil, "", fmt.Errorf("no legal moves")
	}

	if gameID == "chess" {
		var promoQ []json.RawMessage
		for _, m := range sample {
			var cm chessMove
			if json.Unmarshal(m, &cm) == nil && cm.Promotion == "q" {
				promoQ = append(promoQ, m)
			}
		}
		if len(promoQ) > 0 {
			return promoQ[rand.Intn(len(promoQ))], "random-legal", nil
		}
	}
	return sample[rand.Intn(len(sample))], "random-legal", nil
}

// --- main play loop -----------------------------------------------------------

func playTTTTurn(c *client.Client, room, token, seat, model string, snap protocol.Snapshot, log func(string)) error {
	b, err := board(snap)
	if err != nil {
		return err
	}
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	cell := choose(b, seat)
	if cell < 0 {
		return fmt.Errorf("%s: no legal move", seat)
	}
	mv, _ := json.Marshal(map[string]int{"cell": cell})
	ack, err := c.Move(room, token, mv, &protocol.MoveMeta{
		Model:  model,
		Method: "engine",
		Note:   "minimax heuristic",
	})
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	if log != nil {
		log(fmt.Sprintf("%s (%s) → cell %d", seat, model, cell))
	}
	nb := b
	nb[cell] = seat
	switch {
	case winsWith(b, cell, seat):
		_ = c.Emote(room, token, protocol.EmotionCelebrating, "gg!")
	case threat(nb, seat):
		_ = c.Emote(room, token, protocol.EmotionSmug, "")
	case threat(nb, other(seat)):
		_ = c.Emote(room, token, protocol.EmotionNervous, "")
	default:
		_ = c.Emote(room, token, protocol.EmotionConfident, "")
	}
	return nil
}

func playC4Turn(c *client.Client, room, token, seat, model string, snap protocol.Snapshot, log func(string)) error {
	b, err := c4Board(snap)
	if err != nil {
		return err
	}
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	col := c4Choose(b, seat)
	if col < 0 {
		return fmt.Errorf("%s: no legal move", seat)
	}
	mv, _ := json.Marshal(map[string]int{"column": col})
	ack, err := c.Move(room, token, mv, &protocol.MoveMeta{
		Model:  model,
		Method: "engine",
		Note:   "win/block/center heuristic",
	})
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	if log != nil {
		log(fmt.Sprintf("%s (%s) → column %d", seat, model, col))
	}
	if c4Wins(c4Drop(b, col, seat), seat) {
		_ = c.Emote(room, token, protocol.EmotionCelebrating, "gg!")
	} else {
		_ = c.Emote(room, token, protocol.EmotionConfident, "")
	}
	return nil
}

func playReversiTurn(c *client.Client, room, token, seat, model string, snap protocol.Snapshot, log func(string)) error {
	b, err := rvBoard(snap)
	if err != nil {
		return err
	}
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	cell := rvChoose(b, seat)
	if cell < 0 {
		return fmt.Errorf("%s: no legal move", seat)
	}
	mv, _ := json.Marshal(map[string]int{"cell": cell})
	ack, err := c.Move(room, token, mv, &protocol.MoveMeta{
		Model:  model,
		Method: "engine",
		Note:   "corner/mobility heuristic",
	})
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	if log != nil {
		log(fmt.Sprintf("%s (%s) → cell %d (+%d flips)", seat, model, cell, len(rvFlips(b, cell, seat))))
	}
	after := rvPlay(b, cell, seat)
	switch {
	case cell == 0 || cell == 7 || cell == 56 || cell == 63:
		_ = c.Emote(room, token, protocol.EmotionSmug, "corner.")
	case len(rvLegal(after, rvOther(seat))) == 0:
		_ = c.Emote(room, token, protocol.EmotionMischievous, "your move… oh, wait")
	default:
		_ = c.Emote(room, token, protocol.EmotionConfident, "")
	}
	return nil
}

func playGomokuTurn(c *client.Client, room, token, seat, model string, snap protocol.Snapshot, log func(string)) error {
	b, err := gmBoard(snap)
	if err != nil {
		return err
	}
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	cell := gmChoose(b, seat)
	if cell < 0 {
		return fmt.Errorf("%s: no legal move", seat)
	}
	mv, _ := json.Marshal(map[string]int{"cell": cell})
	ack, err := c.Move(room, token, mv, &protocol.MoveMeta{
		Model:  model,
		Method: "engine",
		Note:   "threat-scoring heuristic",
	})
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	if log != nil {
		log(fmt.Sprintf("%s (%s) → point %d (row %d, col %d)", seat, model, cell, cell/gmCols+1, cell%gmCols+1))
	}
	switch {
	case gmWinsAt(b, cell, seat):
		_ = c.Emote(room, token, protocol.EmotionCelebrating, "gg!")
	case gmWinsAt(b, cell, gmOther(seat)):
		_ = c.Emote(room, token, protocol.EmotionNervous, "had to block that")
	default:
		_ = c.Emote(room, token, protocol.EmotionConfident, "")
	}
	return nil
}

func playDabTurn(c *client.Client, room, token, seat, model string, snap protocol.Snapshot, log func(string)) error {
	g, err := dbBoard(snap)
	if err != nil {
		return err
	}
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	edge := dbChoose(g, seat)
	if edge < 0 {
		return fmt.Errorf("%s: no legal move", seat)
	}
	claims := dbClaims(g, edge)
	mv, _ := json.Marshal(map[string]int{"edge": edge})
	ack, err := c.Move(room, token, mv, &protocol.MoveMeta{
		Model:  model,
		Method: "engine",
		Note:   "claim/safe-edge/short-sacrifice heuristic",
	})
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	if log != nil {
		log(fmt.Sprintf("%s (%s) → edge %d (+%d boxes)", seat, model, edge, claims))
	}
	switch {
	case claims > 0:
		_ = c.Emote(room, token, protocol.EmotionSmug, "")
	case dbOpens(g, edge) > 0:
		_ = c.Emote(room, token, protocol.EmotionNervous, "all my moves were bad")
	default:
		_ = c.Emote(room, token, protocol.EmotionConfident, "")
	}
	return nil
}

func playCheckersTurn(c *client.Client, room, token, seat, model string, snap protocol.Snapshot, log func(string)) error {
	p, err := ckBoard(snap)
	if err != nil {
		return err
	}
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	m, ok := ckChoose(p, seat)
	if !ok {
		return fmt.Errorf("%s: no legal move", seat)
	}
	capture := abs8(m.To/8-m.From/8) == 2
	mv, _ := json.Marshal(m)
	ack, err := c.Move(room, token, mv, &protocol.MoveMeta{
		Model:  model,
		Method: "engine",
		Note:   "material search, one reply deep",
	})
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	if log != nil {
		verb := "→"
		if capture {
			verb = "x"
		}
		log(fmt.Sprintf("%s (%s) %s %d %s %d", seat, model, verb, m.From, verb, m.To))
	}
	if capture {
		_ = c.Emote(room, token, protocol.EmotionSmug, "")
	} else {
		_ = c.Emote(room, token, protocol.EmotionConfident, "")
	}
	return nil
}

func playHexTurn(c *client.Client, room, token, seat, model string, snap protocol.Snapshot, log func(string)) error {
	b, err := hxBoard(snap)
	if err != nil {
		return err
	}
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	cell := hxChoose(b, seat)
	if cell < 0 {
		return fmt.Errorf("%s: no legal move", seat)
	}
	mv, _ := json.Marshal(map[string]int{"cell": cell})
	ack, err := c.Move(room, token, mv, &protocol.MoveMeta{
		Model:  model,
		Method: "engine",
		Note:   "shortest-connection heuristic",
	})
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	after := b
	after[cell] = seat
	left := hxDistance(after, seat)
	if log != nil {
		log(fmt.Sprintf("%s (%s) → cell %d (%d to connect)", seat, model, cell, left))
	}
	switch {
	case left == 0:
		_ = c.Emote(room, token, protocol.EmotionCelebrating, "connected!")
	case left <= 2:
		_ = c.Emote(room, token, protocol.EmotionSmug, "")
	default:
		_ = c.Emote(room, token, protocol.EmotionConfident, "")
	}
	return nil
}

func playLegalTurn(c *client.Client, room, token, seat, model, gameID string, log func(string)) error {
	_ = c.Emote(room, token, protocol.EmotionThinking, "")
	mv, note, err := pickLegal(c, room, gameID)
	if err != nil {
		return err
	}
	meta := &protocol.MoveMeta{Model: model, Method: "engine", Note: note}
	ack, err := c.Move(room, token, mv, meta)
	if err != nil {
		return err
	}
	if !ack.OK {
		time.Sleep(80 * time.Millisecond)
		return nil
	}
	if log != nil {
		log(fmt.Sprintf("%s (%s) → %s", seat, model, note))
	}
	_ = c.Emote(room, token, protocol.EmotionConfident, "")
	return nil
}

// --- hints --------------------------------------------------------

func hintsChanged(a, b []string) bool {
	if len(a) != len(b) {
		return true
	}
	for i := range a {
		if a[i] != b[i] {
			return true
		}
	}
	return false
}

// Play drives one seat to the end of the game via the server API.
func Play(ctx context.Context, c *client.Client, room, token, seat, model string, log func(string)) error {
	var lastHints []string
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		snap, err := c.State(room)
		if err != nil {
			return err
		}

		if hintsChanged(snap.Hints, lastHints) {
			for _, h := range snap.Hints {
				if log != nil {
					log(fmt.Sprintf("hint: %s", h))
				}
			}
			lastHints = make([]string, len(snap.Hints))
			copy(lastHints, snap.Hints)
		}

		if snap.Result != nil {
			if snap.Result.Kind == "win" && snap.Result.Winner != seat {
				_ = c.Emote(room, token, protocol.EmotionDefeated, "gg")
			}
			return nil
		}
		if snap.ToMove != seat {
			time.Sleep(120 * time.Millisecond)
			continue
		}

		var turnErr error
		switch snap.GameID {
		case "tic-tac-toe":
			turnErr = playTTTTurn(c, room, token, seat, model, snap, log)
		case "connect-four":
			turnErr = playC4Turn(c, room, token, seat, model, snap, log)
		case "reversi":
			turnErr = playReversiTurn(c, room, token, seat, model, snap, log)
		case "gomoku":
			turnErr = playGomokuTurn(c, room, token, seat, model, snap, log)
		case "dots-and-boxes":
			turnErr = playDabTurn(c, room, token, seat, model, snap, log)
		case "checkers":
			turnErr = playCheckersTurn(c, room, token, seat, model, snap, log)
		case "hex":
			turnErr = playHexTurn(c, room, token, seat, model, snap, log)
		default:
			turnErr = playLegalTurn(c, room, token, seat, model, snap.GameID, log)
		}
		if turnErr != nil {
			return turnErr
		}
	}
}

// --- render -------------------------------------------------------------------

func renderTTT(snap protocol.Snapshot) string {
	b, _ := board(snap)
	cell := func(i int) string {
		if b[i] == "" {
			return "·"
		}
		return b[i]
	}
	var sb strings.Builder
	for r := 0; r < 3; r++ {
		fmt.Fprintf(&sb, " %s | %s | %s\n", cell(r*3), cell(r*3+1), cell(r*3+2))
		if r < 2 {
			sb.WriteString("---+---+---\n")
		}
	}
	return sb.String()
}

func renderC4(snap protocol.Snapshot) string {
	b, _ := c4Board(snap)
	cell := func(i int) string {
		if b[i] == "" {
			return "·"
		}
		return b[i]
	}
	var sb strings.Builder
	for r := 0; r < c4Rows; r++ {
		sb.WriteByte('|')
		for c := 0; c < c4Cols; c++ {
			fmt.Fprintf(&sb, " %s", cell(r*c4Cols+c))
		}
		sb.WriteString(" |\n")
	}
	sb.WriteString("  0 1 2 3 4 5 6\n")
	return sb.String()
}

func renderReversi(snap protocol.Snapshot) string {
	b, _ := rvBoard(snap)
	glyph := func(i int) string {
		switch b[i] {
		case "B":
			return "●"
		case "W":
			return "○"
		default:
			return "·"
		}
	}
	var sb strings.Builder
	sb.WriteString("  a b c d e f g h\n")
	for r := 0; r < rvRows; r++ {
		fmt.Fprintf(&sb, "%d", rvRows-r)
		for c := 0; c < rvCols; c++ {
			fmt.Fprintf(&sb, " %s", glyph(r*rvCols+c))
		}
		fmt.Fprintf(&sb, " %d\n", rvRows-r)
	}
	sb.WriteString("  a b c d e f g h\n")
	fmt.Fprintf(&sb, "● %d  ○ %d\n", rvCount(b, "B"), rvCount(b, "W"))
	return sb.String()
}

func renderGomoku(snap protocol.Snapshot) string {
	b, _ := gmBoard(snap)
	var sb strings.Builder
	for r := 0; r < gmRows; r++ {
		fmt.Fprintf(&sb, "%2d", gmRows-r)
		for c := 0; c < gmCols; c++ {
			switch b[r*gmCols+c] {
			case "B":
				sb.WriteString(" ●")
			case "W":
				sb.WriteString(" ○")
			default:
				sb.WriteString(" ·")
			}
		}
		sb.WriteByte('\n')
	}
	return sb.String()
}

func renderDab(snap protocol.Snapshot) string {
	var w dbWire
	if json.Unmarshal(snap.State, &w) != nil {
		return fmt.Sprintf("game: dots-and-boxes\nstate: %s", string(snap.State))
	}
	owner := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	var sb strings.Builder
	for r := 0; r < dbDots; r++ {
		for c := 0; c < dbBoxCol; c++ {
			sb.WriteString("·")
			if owner(w.Edges[dbH(r, c)]) != "" {
				sb.WriteString("───")
			} else {
				sb.WriteString("   ")
			}
		}
		sb.WriteString("·\n")
		if r == dbBoxRow {
			break
		}
		for c := 0; c < dbDots; c++ {
			if owner(w.Edges[dbV(r, c)]) != "" {
				sb.WriteString("│")
			} else {
				sb.WriteString(" ")
			}
			if c < dbBoxCol {
				box := owner(w.Boxes[r*dbBoxCol+c])
				if box == "" {
					box = " "
				}
				fmt.Fprintf(&sb, " %s ", box)
			}
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

func renderCheckers(snap protocol.Snapshot) string {
	p, err := ckBoard(snap)
	if err != nil {
		return fmt.Sprintf("game: checkers\nstate: %s", string(snap.State))
	}
	var sb strings.Builder
	for r := 0; r < 8; r++ {
		fmt.Fprintf(&sb, "%d", 8-r)
		for c := 0; c < 8; c++ {
			piece := p.board[r*8+c]
			if piece == "" {
				if (r+c)%2 == 1 {
					sb.WriteString(" ·")
				} else {
					sb.WriteString("  ")
				}
				continue
			}
			fmt.Fprintf(&sb, " %s", piece)
		}
		sb.WriteByte('\n')
	}
	sb.WriteString("  a b c d e f g h\n")
	return sb.String()
}

func renderHex(snap protocol.Snapshot) string {
	b, err := hxBoard(snap)
	if err != nil {
		return fmt.Sprintf("game: hex\nstate: %s", string(snap.State))
	}
	var sb strings.Builder
	for r := 0; r < hxRows; r++ {
		sb.WriteString(strings.Repeat(" ", r))
		for c := 0; c < hxCols; c++ {
			switch b[r*hxCols+c] {
			case "R":
				sb.WriteString(" R")
			case "B":
				sb.WriteString(" B")
			default:
				sb.WriteString(" ·")
			}
		}
		sb.WriteByte('\n')
	}
	return sb.String()
}

// Render draws the board of a snapshot as ASCII (tic-tac-toe / Connect Four /
// Reversi / Gomoku / Dots and Boxes / Checkers / Hex) or a summary.
func Render(snap protocol.Snapshot) string {
	switch snap.GameID {
	case "tic-tac-toe":
		return renderTTT(snap)
	case "connect-four":
		return renderC4(snap)
	case "reversi":
		return renderReversi(snap)
	case "gomoku":
		return renderGomoku(snap)
	case "dots-and-boxes":
		return renderDab(snap)
	case "checkers":
		return renderCheckers(snap)
	case "hex":
		return renderHex(snap)
	case "chess":
		var cs struct {
			FEN     string   `json:"fen"`
			History []string `json:"history"`
		}
		if json.Unmarshal(snap.State, &cs) == nil && cs.FEN != "" {
			if n := len(cs.History); n > 0 {
				return fmt.Sprintf("FEN: %s\nlast: %s", cs.FEN, cs.History[n-1])
			}
			return fmt.Sprintf("FEN: %s", cs.FEN)
		}
		return fmt.Sprintf("game: chess\nstate: %s", string(snap.State))
	default:
		return fmt.Sprintf("game: %s\nstate: %s", snap.GameID, string(snap.State))
	}
}
