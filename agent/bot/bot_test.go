package bot

import "testing"

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
