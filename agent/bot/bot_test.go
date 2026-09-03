package bot

import (
	"strings"
	"testing"
)

// c4TestBoard builds a Connect Four board from 6 rows of 7 runes, row 0 = top.
// '.' is an empty cell, 'R'/'Y' are discs.
func c4TestBoard(t *testing.T, rows ...string) [c4Size]string {
	t.Helper()
	if len(rows) != c4Rows {
		t.Fatalf("need %d rows, got %d", c4Rows, len(rows))
	}
	var b [c4Size]string
	for r, row := range rows {
		if len(row) != c4Cols {
			t.Fatalf("row %d: need %d cells, got %d", r, c4Cols, len(row))
		}
		for c, ch := range row {
			if ch != '.' {
				b[r*c4Cols+c] = string(ch)
			}
		}
	}
	return b
}

func TestC4ChooseTakesTheWin(t *testing.T) {
	// R has three on the bottom row; column 4 completes it. Y simultaneously has
	// three vertically in column 0, so a bot that blocks before it wins — or one
	// that just grabs the center — would answer 0 or 3 instead of 4.
	b := c4TestBoard(t,
		".......",
		".......",
		".......",
		"Y......",
		"Y......",
		"YRRR...",
	)
	if got := c4Choose(b, "R"); got != 4 {
		t.Errorf("c4Choose = %d, want 4 (win now)", got)
	}
}

func TestC4ChooseBlocksOpponentWin(t *testing.T) {
	// Y threatens four on the bottom row at column 4; R has nothing better.
	b := c4TestBoard(t,
		".......",
		".......",
		".......",
		".......",
		".......",
		"RYYY...",
	)
	if got := c4Choose(b, "R"); got != 4 {
		t.Errorf("c4Choose = %d, want 4 (block)", got)
	}
}

func TestC4ChooseOpensCenter(t *testing.T) {
	if got := c4Choose([c4Size]string{}, "R"); got != 3 {
		t.Errorf("c4Choose on empty board = %d, want 3 (center)", got)
	}
}

func TestC4ChooseAvoidsHandingOverAWin(t *testing.T) {
	// Neither side can win this ply, so the center preference would normally take
	// column 3 — but column 3 is empty, so R's disc lands on row 5 and uncovers
	// (4,3), which completes Y's row-4 three. The bot must step aside to 2.
	b := c4TestBoard(t,
		".......",
		".......",
		".......",
		"RR.....",
		"YYY....",
		"RRY....",
	)
	if c4Wins(c4Drop(b, 3, "R"), "R") {
		t.Fatal("fixture is wrong: column 3 wins outright for R")
	}
	poisoned := c4Drop(b, 3, "R")
	if !c4Wins(c4Drop(poisoned, 3, "Y"), "Y") {
		t.Fatal("fixture is wrong: column 3 is not actually poisoned")
	}

	got := c4Choose(b, "R")
	if got != 2 {
		t.Errorf("c4Choose = %d, want 2 (nearest safe column)", got)
	}
	after := c4Drop(b, got, "R")
	if c4DropRow(after, got) >= 0 && c4Wins(c4Drop(after, got, "Y"), "Y") {
		t.Errorf("c4Choose = %d, which lets Y win directly on top", got)
	}
}

func TestC4ChooseNoLegalMove(t *testing.T) {
	var b [c4Size]string
	for i := range b {
		b[i] = "R"
	}
	if got := c4Choose(b, "Y"); got != -1 {
		t.Errorf("c4Choose on a full board = %d, want -1", got)
	}
}

// rvTestBoard builds a Reversi board from 8 rows of 8 runes, row 0 = top.
// '.' is an empty square, 'B'/'W' are discs.
func rvTestBoard(t *testing.T, rows ...string) [rvSize]string {
	t.Helper()
	if len(rows) != rvRows {
		t.Fatalf("need %d rows, got %d", rvRows, len(rows))
	}
	var b [rvSize]string
	for r, row := range rows {
		if len(row) != rvCols {
			t.Fatalf("row %d: need %d cells, got %d", r, rvCols, len(row))
		}
		for c, ch := range row {
			if ch != '.' {
				b[r*rvCols+c] = string(ch)
			}
		}
	}
	return b
}

func rvOpening() [rvSize]string {
	var b [rvSize]string
	b[27], b[36] = "W", "W"
	b[28], b[35] = "B", "B"
	return b
}

func TestRvLegalMatchesTheOpening(t *testing.T) {
	got := rvLegal(rvOpening(), "B")
	want := []int{19, 26, 37, 44}
	if len(got) != len(want) {
		t.Fatalf("legal = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("legal = %v, want %v", got, want)
		}
	}
}

func TestRvPlayFlipsTheBracketedRun(t *testing.T) {
	after := rvPlay(rvOpening(), 19, "B")
	if after[19] != "B" || after[27] != "B" {
		t.Errorf("d3 should place on 19 and flip 27: [19]=%q [27]=%q", after[19], after[27])
	}
	if after[36] != "W" {
		t.Errorf("e5 should be untouched, got %q", after[36])
	}
	if rvCount(after, "B") != 4 || rvCount(after, "W") != 1 {
		t.Errorf("counts after d3 = B:%d W:%d, want B:4 W:1", rvCount(after, "B"), rvCount(after, "W"))
	}
}

func TestRvChooseTakesTheCorner(t *testing.T) {
	// Black can either take a8 (cell 0, permanent) or eat a fat row of discs in
	// the middle. A disc-greedy bot picks the middle; this one takes the corner.
	b := rvTestBoard(t,
		".WB.....",
		"........",
		"........",
		"...WB...",
		"..WWWB..",
		"........",
		"........",
		"........",
	)
	if got := rvChoose(b, "B"); got != 0 {
		t.Errorf("rvChoose = %d, want 0 (the corner)", got)
	}
}

func TestRvChooseAvoidsTheXSquareNextToAnEmptyCorner(t *testing.T) {
	// Both moves are legal: cell 9 is the X-square guarding the empty a8 corner,
	// cell 26 is a quiet centre move. The X-square must lose.
	b := rvTestBoard(t,
		"........",
		"........",
		"..W.....",
		"...B....",
		"........",
		"....WB..",
		"........",
		"........",
	)
	legal := rvLegal(b, "B")
	hasX := false
	for _, c := range legal {
		if c == 9 {
			hasX = true
		}
	}
	if !hasX {
		t.Fatalf("test position should offer the X-square; legal = %v", legal)
	}
	if got := rvChoose(b, "B"); got == 9 {
		t.Error("rvChoose took the X-square beside an empty corner")
	}
}

func TestRvChooseGrabsDiscsInTheEndgame(t *testing.T) {
	// Two equally-placed empty squares left, so the disc count is all that
	// matters: cell 43 flips three discs, cell 20 flips one.
	b := rvTestBoard(t,
		"BBBBBBBB",
		"BBBBBBBB",
		"BBBB.WBB",
		"BBBBBBBB",
		"BBBBBBBB",
		"BBB.WWWB",
		"BBBBBBBB",
		"BBBBBBBB",
	)
	if got := rvChoose(b, "B"); got != 43 {
		t.Errorf("rvChoose = %d, want 43 (the bigger endgame capture)", got)
	}
}

func TestRvChooseReturnsNoMoveWhenStuck(t *testing.T) {
	b := rvTestBoard(t,
		"BBBBBBBB",
		"BBBBBBBB",
		"BBBBBBBB",
		"BBBBBBBB",
		"BBBBBBBB",
		"BBBBBBBB",
		"BBBBBBBB",
		"BBBBBBB.",
	)
	if got := rvChoose(b, "W"); got != -1 {
		t.Errorf("rvChoose = %d, want -1", got)
	}
}

// gmTestBoard builds a Gomoku board from 15 rows of 15 runes, row 0 = top.
// '.' is an empty point, 'B'/'W' are stones.
func gmTestBoard(t *testing.T, rows ...string) [gmSize]string {
	t.Helper()
	if len(rows) != gmRows {
		t.Fatalf("need %d rows, got %d", gmRows, len(rows))
	}
	var b [gmSize]string
	for r, row := range rows {
		if len(row) != gmCols {
			t.Fatalf("row %d: need %d points, got %d", r, gmCols, len(row))
		}
		for c, ch := range row {
			if ch != '.' {
				b[r*gmCols+c] = string(ch)
			}
		}
	}
	return b
}

// gmRows15 returns an empty board as 15 blank rows, for tests to overwrite.
func gmRows15() []string {
	rows := make([]string, gmRows)
	for i := range rows {
		rows[i] = "..............."
	}
	return rows
}

// gmPut writes a run of stones into the row strings, left to right.
func gmPut(rows []string, r, c int, seat string, n int) {
	for i := 0; i < n; i++ {
		rows[r] = rows[r][:c+i] + seat + rows[r][c+i+1:]
	}
}

func TestGmChooseOpensInTheCentre(t *testing.T) {
	var empty [gmSize]string
	if got := gmChoose(empty, "B"); got != 7*gmCols+7 {
		t.Errorf("gmChoose on an empty board = %d, want the centre 112", got)
	}
}

func TestGmChooseTakesTheWinBeforeBlocking(t *testing.T) {
	// Both sides have four in a row: B on row 7, W on row 9. B must complete
	// its own five (either end of the run) rather than block W's.
	rows := gmRows15()
	gmPut(rows, 7, 4, "B", 4)
	gmPut(rows, 9, 4, "W", 4)
	b := gmTestBoard(t, rows...)
	got := gmChoose(b, "B")
	if got != 7*gmCols+3 && got != 7*gmCols+8 {
		t.Errorf("gmChoose = %d, want an end of B's own four (%d or %d)", got, 7*gmCols+3, 7*gmCols+8)
	}
	if !gmWinsAt(b, got, "B") {
		t.Errorf("gmChoose = %d, which does not win", got)
	}
}

func TestGmChooseBlocksAnOpponentFour(t *testing.T) {
	// W is one point from five and B has nothing going: B must block. Either
	// end of the run stops it.
	rows := gmRows15()
	gmPut(rows, 6, 5, "W", 4)
	gmPut(rows, 12, 1, "B", 1)
	b := gmTestBoard(t, rows...)
	got := gmChoose(b, "B")
	if got != 6*gmCols+4 && got != 6*gmCols+9 {
		t.Errorf("gmChoose = %d, want an end of W's four (%d or %d)", got, 6*gmCols+4, 6*gmCols+9)
	}
}

func TestGmChoosePlaysNearTheAction(t *testing.T) {
	rows := gmRows15()
	gmPut(rows, 7, 7, "B", 1)
	gmPut(rows, 8, 7, "W", 1)
	b := gmTestBoard(t, rows...)
	got := gmChoose(b, "B")
	r, c := got/gmCols, got%gmCols
	if r < 5 || r > 10 || c < 5 || c > 9 {
		t.Errorf("gmChoose = %d (row %d col %d), want a point near the two stones", got, r, c)
	}
	if b[got] != "" {
		t.Errorf("gmChoose picked an occupied point %d", got)
	}
}

func TestGmWinsAtCountsEveryDirection(t *testing.T) {
	cases := []struct {
		name   string
		dr, dc int
	}{{"horizontal", 0, 1}, {"vertical", 1, 0}, {"diagonal", 1, 1}, {"anti-diagonal", 1, -1}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var b [gmSize]string
			r, c := 7, 7
			// Four stones leading up to (7,7), which is left empty.
			for k := 1; k <= 4; k++ {
				b[(r-tc.dr*k)*gmCols+(c-tc.dc*k)] = "B"
			}
			if !gmWinsAt(b, r*gmCols+c, "B") {
				t.Error("completing the fifth stone was not seen as a win")
			}
			if gmWinsAt(b, r*gmCols+c, "W") {
				t.Error("the same point counted as a win for the other seat")
			}
		})
	}
}

// TestGomokuSelfPlayReachesAWin plays the heuristic against itself and asserts
// somebody wins well before the board fills.
func TestGomokuSelfPlayReachesAWin(t *testing.T) {
	var b [gmSize]string
	seat := "B"
	for ply := 0; ply < gmSize; ply++ {
		cell := gmChoose(b, seat)
		if cell < 0 {
			t.Fatalf("no move at ply %d", ply)
		}
		if b[cell] != "" {
			t.Fatalf("ply %d picked occupied point %d", ply, cell)
		}
		win := gmWinsAt(b, cell, seat)
		b[cell] = seat
		if win {
			t.Logf("%s wins at ply %d (point %d)", seat, ply+1, cell)
			if ply > 80 {
				t.Errorf("self-play took %d plies to produce a win", ply+1)
			}
			return
		}
		seat = gmOther(seat)
	}
	t.Fatal("self-play filled the board without a win")
}

// dbDraw marks edges as drawn, for building a Dots and Boxes position.
func dbDraw(edges ...int) dbGrid {
	var g dbGrid
	for _, e := range edges {
		g[e] = true
	}
	return g
}

func TestDbChooseClosesABox(t *testing.T) {
	// Box 0 is on three sides; the fourth edge is the only move worth making.
	g := dbDraw(dbH(0, 0), dbH(1, 0), dbV(0, 0))
	got := dbChoose(g, "A")
	if got != dbV(0, 1) {
		t.Errorf("dbChoose = %d, want %d (closes box 0)", got, dbV(0, 1))
	}
}

func TestDbChoosePrefersTheDoubleClose(t *testing.T) {
	// Boxes 0 and 1 are both on three sides, sharing their missing edge, and a
	// third box is one edge from closing on its own. Take the two.
	g := dbDraw(
		dbH(0, 0), dbH(1, 0), dbV(0, 0), // box 0 minus the shared edge
		dbH(0, 1), dbH(1, 1), dbV(0, 2), // box 1 minus the shared edge
		dbH(0, 3), dbH(1, 3), dbV(0, 3), // box 3 minus one edge
	)
	if got := dbChoose(g, "A"); got != dbV(0, 1) {
		t.Errorf("dbChoose = %d, want %d (closes two boxes at once)", got, dbV(0, 1))
	}
}

func TestDbChoosePlaysSafeRatherThanOpenABox(t *testing.T) {
	// Box 0 has two sides: drawing a third would hand it over. An untouched
	// edge elsewhere is safe, and that is what the bot must pick.
	g := dbDraw(dbH(0, 0), dbV(0, 0))
	got := dbChoose(g, "A")
	if dbOpens(g, got) != 0 {
		t.Errorf("dbChoose = %d, which opens %d box(es) while safe edges exist", got, dbOpens(g, got))
	}
	if dbClaims(g, got) != 0 {
		t.Errorf("dbChoose = %d claims a box that should not exist", got)
	}
}

func TestDbChooseGivesAwayTheShortestChain(t *testing.T) {
	// Every remaining edge is a sacrifice: the top box-row is a four-box chain
	// (all five verticals missing), and box 15 is a lone two-sided box. The bot
	// must feed the single box, not the chain.
	var g dbGrid
	for e := 0; e < dbEdges; e++ {
		g[e] = true
	}
	for c := 0; c < dbDots; c++ {
		g[dbV(0, c)] = false
	}
	g[dbH(4, 3)] = false
	g[dbV(3, 4)] = false

	got := dbChoose(g, "A")
	if got < 0 {
		t.Fatal("dbChoose found no move")
	}
	if dbClaims(g, got) != 0 {
		t.Fatalf("position should offer no free box, but edge %d claims one", got)
	}
	if size := dbChainSize(g, got); size > 1 {
		t.Errorf("dbChoose = %d gives away a chain of %d, want the single box", got, size)
	}
}

func TestDbChooseReturnsNoMoveOnAFullGrid(t *testing.T) {
	var g dbGrid
	for e := 0; e < dbEdges; e++ {
		g[e] = true
	}
	if got := dbChoose(g, "A"); got != -1 {
		t.Errorf("dbChoose on a full grid = %d, want -1", got)
	}
}

// ckTestPos builds a Checkers position from 8 rows of 8 runes: '.' empty,
// r/R red man/king, b/B black.
func ckTestPos(t *testing.T, rows ...string) ckPos {
	t.Helper()
	if len(rows) != 8 {
		t.Fatalf("need 8 rows, got %d", len(rows))
	}
	p := ckPos{chain: -1}
	for r, row := range rows {
		if len(row) != 8 {
			t.Fatalf("row %d: need 8 squares, got %d", r, len(row))
		}
		for c, ch := range row {
			if ch != '.' {
				p.board[r*8+c] = string(ch)
			}
		}
	}
	return p
}

func TestCkChooseTakesTheForcedJump(t *testing.T) {
	p := ckTestPos(t,
		"........",
		"........",
		"........",
		"........",
		"...b....",
		"....r...",
		"........",
		"......r.",
	)
	m, ok := ckChoose(p, "R")
	if !ok {
		t.Fatal("no move found")
	}
	if m.From != 5*8+4 || m.To != 3*8+2 {
		t.Errorf("ckChoose = %+v, want the jump 44 → 26", m)
	}
}

func TestCkChooseFollowsTheChain(t *testing.T) {
	// Mid-multi-jump: only the chained piece may move, and it must jump again.
	p := ckTestPos(t,
		"........",
		"........",
		"...b....",
		"..r.....",
		"........",
		"........",
		"........",
		"......r.",
	)
	p.chain = 3*8 + 2
	m, ok := ckChoose(p, "R")
	if !ok {
		t.Fatal("no move found")
	}
	if m.From != 3*8+2 || m.To != 1*8+4 {
		t.Errorf("ckChoose = %+v, want the chained jump 26 → 12", m)
	}
}

func TestCkChooseAvoidsHangingAPiece(t *testing.T) {
	// Two quiet moves: one steps beside a black man and is captured, the other
	// is safe. (Black cannot jump the safe square, so material decides.)
	p := ckTestPos(t,
		"........",
		"........",
		"........",
		"..b.....",
		"........",
		"r.....r.",
		"........",
		"........",
	)
	m, ok := ckChoose(p, "R")
	if !ok {
		t.Fatal("no move found")
	}
	after, _ := ckApply(p.board, m, "R")
	for _, reply := range ckLegal(ckPos{board: after, chain: -1}, "B") {
		if abs8(reply.To/8-reply.From/8) == 2 {
			t.Errorf("ckChoose = %+v, which lets black jump with %+v", m, reply)
		}
	}
}

func TestCkChooseReturnsNoMoveWhenStuck(t *testing.T) {
	p := ckTestPos(t,
		"........",
		"........",
		"........",
		"........",
		"........",
		"..b.....",
		".b......",
		"r.......",
	)
	if _, ok := ckChoose(p, "R"); ok {
		t.Error("ckChoose found a move for a boxed-in piece")
	}
}

func TestCkApplyCrownsAndStopsTheChain(t *testing.T) {
	// A red man jumps onto the crown row with another jump available: crowning
	// ends the turn, so ckApply must not report a continuation.
	p := ckTestPos(t,
		"........",
		"..b.b...",
		".....r..",
		"........",
		"........",
		"........",
		"........",
		"........",
	)
	after, again := ckApply(p.board, ckMove{From: 2*8 + 5, To: 0*8 + 3}, "R")
	if after[3] != "R" {
		t.Errorf("crown square holds %q, want a red king", after[3])
	}
	if again {
		t.Error("ckApply wants to keep jumping after a crowning")
	}
}

// hxTestBoard builds a Hex position from 11 rows of 11 runes: '.' empty, R/B.
func hxTestBoard(t *testing.T, rows ...string) [hxSize]string {
	t.Helper()
	if len(rows) != hxRows {
		t.Fatalf("need %d rows, got %d", hxRows, len(rows))
	}
	var b [hxSize]string
	for r, row := range rows {
		if len(row) != hxCols {
			t.Fatalf("row %d: need %d cells, got %d", r, hxCols, len(row))
		}
		for c, ch := range row {
			if ch != '.' {
				b[r*hxCols+c] = string(ch)
			}
		}
	}
	return b
}

func hxBlank() []string {
	rows := make([]string, hxRows)
	for i := range rows {
		rows[i] = strings.Repeat(".", hxCols)
	}
	return rows
}

func hxPut(rows []string, r, c int, seat string) {
	rows[r] = rows[r][:c] + seat + rows[r][c+1:]
}

func TestHxDistanceMeasuresTheConnection(t *testing.T) {
	// An empty board needs one stone per column.
	var empty [hxSize]string
	if got := hxDistance(empty, "R"); got != hxCols {
		t.Errorf("hxDistance on an empty board = %d, want %d", got, hxCols)
	}

	// A finished row costs nothing.
	rows := hxBlank()
	for c := 0; c < hxCols; c++ {
		hxPut(rows, 5, c, "R")
	}
	if got := hxDistance(hxTestBoard(t, rows...), "R"); got != 0 {
		t.Errorf("hxDistance across a finished row = %d, want 0", got)
	}

	// One gap costs exactly one stone.
	rows = hxBlank()
	for c := 0; c < hxCols; c++ {
		if c == 5 {
			continue
		}
		hxPut(rows, 5, c, "R")
	}
	if got := hxDistance(hxTestBoard(t, rows...), "R"); got != 1 {
		t.Errorf("hxDistance with one gap = %d, want 1", got)
	}
}

func TestHxChooseCompletesTheConnection(t *testing.T) {
	rows := hxBlank()
	for c := 0; c < hxCols; c++ {
		if c == 7 {
			continue
		}
		hxPut(rows, 4, c, "R")
	}
	b := hxTestBoard(t, rows...)
	if got := hxChoose(b, "R"); got != 4*hxCols+7 {
		t.Errorf("hxChoose = %d, want %d (completes the row)", got, 4*hxCols+7)
	}
}

func TestHxChooseBlocksTheOpponentsLastCell(t *testing.T) {
	// Blue is one cell from joining top to bottom; red has nothing going.
	rows := hxBlank()
	for r := 0; r < hxRows; r++ {
		if r == 6 {
			continue
		}
		hxPut(rows, r, 2, "B")
	}
	b := hxTestBoard(t, rows...)
	if got := hxChoose(b, "R"); got != 6*hxCols+2 {
		t.Errorf("hxChoose = %d, want %d (blocks blue)", got, 6*hxCols+2)
	}
}

func TestHxChooseShortensItsOwnPath(t *testing.T) {
	var b [hxSize]string
	before := hxDistance(b, "R")
	cell := hxChoose(b, "R")
	if cell < 0 {
		t.Fatal("no move found")
	}
	b[cell] = "R"
	if after := hxDistance(b, "R"); after >= before {
		t.Errorf("distance went from %d to %d — the move did not help", before, after)
	}
}

func TestHxChooseReturnsNoMoveOnAFullBoard(t *testing.T) {
	var b [hxSize]string
	for i := range b {
		b[i] = "R"
	}
	if got := hxChoose(b, "B"); got != -1 {
		t.Errorf("hxChoose on a full board = %d, want -1", got)
	}
}

// TestHexSelfPlayIsSane guards the tie-break: an earlier version scored only
// its own path and walked along row 0 by index order, losing every game.
func TestHexSelfPlayIsSane(t *testing.T) {
	var b [hxSize]string
	seat := "R"
	for ply := 0; ply < hxSize; ply++ {
		cell := hxChoose(b, seat)
		if cell < 0 || b[cell] != "" {
			t.Fatalf("ply %d: bad move %d", ply, cell)
		}
		b[cell] = seat
		if hxDistance(b, seat) == 0 {
			t.Logf("%s connects at ply %d", seat, ply+1)
			if ply+1 > 60 {
				t.Errorf("self-play took %d plies", ply+1)
			}
			return
		}
		seat = hxOther(seat)
	}
	t.Fatal("self-play filled the board without a connection")
}
