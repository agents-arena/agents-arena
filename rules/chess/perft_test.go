package chess

import "testing"

func TestPerft(t *testing.T) {
	cases := []struct {
		name   string
		fen    string
		depths []struct {
			depth int
			want  int64
		}
	}{
		{
			name: "startpos",
			fen:  startFEN,
			depths: []struct {
				depth int
				want  int64
			}{
				{1, 20},
				{2, 400},
				{3, 8902},
				{4, 197281},
			},
		},
		{
			name: "kiwipete",
			fen:  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
			depths: []struct {
				depth int
				want  int64
			}{
				{1, 48},
				{2, 2039},
				{3, 97862},
			},
		},
		{
			name: "position3",
			fen:  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
			depths: []struct {
				depth int
				want  int64
			}{
				{1, 14},
				{2, 191},
				{3, 2812},
				{4, 43238},
			},
		},
		{
			name: "position4",
			fen:  "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
			depths: []struct {
				depth int
				want  int64
			}{
				{1, 6},
				{2, 264},
				{3, 9467},
			},
		},
		{
			name: "position5",
			fen:  "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
			depths: []struct {
				depth int
				want  int64
			}{
				{1, 44},
				{2, 1486},
				{3, 62379},
			},
		},
		{
			name: "position6",
			fen:  "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
			depths: []struct {
				depth int
				want  int64
			}{
				{1, 46},
				{2, 2079},
				{3, 89890},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pos, err := parseFEN(tc.fen)
			if err != nil {
				t.Fatalf("parseFEN: %v", err)
			}
			for _, d := range tc.depths {
				got := perft(pos, d.depth)
				if got != d.want {
					t.Errorf("perft(d=%d) = %d, want %d", d.depth, got, d.want)
				}
			}
		})
	}
}

func TestFoolsMate(t *testing.T) {
	pos, err := parseFEN(startFEN)
	if err != nil {
		t.Fatalf("parseFEN: %v", err)
	}

	ucis := []string{"f2f3", "e7e5", "g2g4", "d8h4"}
	wantSANs := []string{"f3", "e5", "g4", "Qh4#"}
	var sans []string

	for i, u := range ucis {
		m, err := uciToMove(u)
		if err != nil {
			t.Fatalf("uciToMove(%q): %v", u, err)
		}
		san := moveToSAN(pos, m)
		sans = append(sans, san)
		if san != wantSANs[i] {
			t.Errorf("move %d SAN = %q, want %q", i, san, wantSANs[i])
		}
		pos, err = makeMove(pos, m)
		if err != nil {
			t.Fatalf("makeMove(%q): %v", u, err)
		}
	}

	const wantFEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"
	if got := toFEN(pos); got != wantFEN {
		t.Errorf("final FEN =\n  %q\nwant\n  %q", got, wantFEN)
	}
	if !isCheckmate(pos) {
		t.Error("expected checkmate")
	}
	if len(sans) != 4 {
		t.Fatalf("got %d SANs, want 4", len(sans))
	}
}

func TestStalemateAnchor(t *testing.T) {
	pos, err := parseFEN("7k/8/6QK/8/8/8/8/8 b - - 0 1")
	if err != nil {
		t.Fatalf("parseFEN: %v", err)
	}
	moves := legalMovesPos(pos)
	if len(moves) != 0 {
		t.Errorf("legal moves = %d, want 0", len(moves))
	}
	if !isStalemate(pos) {
		t.Error("expected stalemate")
	}
	if inCheck(pos) {
		t.Error("expected not in check")
	}
}
