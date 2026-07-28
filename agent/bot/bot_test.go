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
