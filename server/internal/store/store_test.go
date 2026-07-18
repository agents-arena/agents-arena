package store

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/agents-arena/agents-arena/protocol"
)

func testMatch(room, game string, endedAt int64, result *protocol.GameResult, players []protocol.PlayerReport, comments []protocol.Comment) MatchArchive {
	return MatchArchive{
		Room:      room,
		GameID:    game,
		Reasoning: protocol.ReasoningOpen,
		StartedAt: endedAt - 1000,
		EndedAt:   endedAt,
		Report: protocol.MatchReport{
			ProtocolV: protocol.Version,
			GameID:    game,
			Room:      room,
			StartedAt: endedAt - 1000,
			EndedAt:   endedAt,
			Result:    result,
			Players:   players,
			Moves:     make([]protocol.MoveRecord, 3), // move count 3 for summary
			Reasoning: protocol.ReasoningOpen,
		},
		Comments: comments,
	}
}

func runStoreSuite(t *testing.T, st Store) {
	t.Helper()
	ctx := context.Background()

	aliceWin := testMatch("room-a", "tic-tac-toe", 2000,
		&protocol.GameResult{Kind: protocol.ResultWin, Winner: "X"},
		[]protocol.PlayerReport{
			{Seat: "X", Name: "Alice", Model: "m1", Moves: 3, TotalThinkMs: 300, Method: "model"},
			{Seat: "O", Name: "Bob", Model: "m2", Moves: 2, TotalThinkMs: 200, Method: "engine"},
		},
		[]protocol.Comment{{Name: "Alice", Role: "player", Text: "gg", TS: 1}},
	)
	aliceDraw := testMatch("room-b", "tic-tac-toe", 3000,
		&protocol.GameResult{Kind: protocol.ResultDraw},
		[]protocol.PlayerReport{
			{Seat: "X", Name: "Alice", Model: "m1", Moves: 5, TotalThinkMs: 500, Method: "model"},
			{Seat: "O", Name: "Carol", Model: "m3", Moves: 4, TotalThinkMs: 400, Method: "human"},
		},
		nil,
	)
	// Older match, different game, for list ordering/filter
	other := testMatch("room-c", "chess", 1000,
		&protocol.GameResult{Kind: protocol.ResultWin, Winner: "white"},
		[]protocol.PlayerReport{
			{Seat: "white", Name: "Dave", Model: "m4", Moves: 10, TotalThinkMs: 1000, Method: "engine"},
			{Seat: "black", Name: "Eve", Model: "m5", Moves: 9, TotalThinkMs: 900, Method: "engine"},
		},
		nil,
	)

	if err := st.SaveMatch(ctx, aliceWin); err != nil {
		t.Fatalf("SaveMatch room-a: %v", err)
	}
	if err := st.SaveMatch(ctx, aliceDraw); err != nil {
		t.Fatalf("SaveMatch room-b: %v", err)
	}
	if err := st.SaveMatch(ctx, other); err != nil {
		t.Fatalf("SaveMatch room-c: %v", err)
	}

	// ListMatches: newest-first, total count
	list, total, err := st.ListMatches(ctx, ListOptions{})
	if err != nil {
		t.Fatalf("ListMatches: %v", err)
	}
	if total != 3 {
		t.Fatalf("total=%d want 3", total)
	}
	if len(list) != 3 {
		t.Fatalf("len(list)=%d want 3", len(list))
	}
	if list[0].Room != "room-b" || list[1].Room != "room-a" || list[2].Room != "room-c" {
		t.Fatalf("order wrong: %s, %s, %s", list[0].Room, list[1].Room, list[2].Room)
	}
	if list[0].MoveCount != 3 || list[0].Comments != 0 {
		t.Fatalf("room-b summary: moveCount=%d comments=%d", list[0].MoveCount, list[0].Comments)
	}
	if list[1].Comments != 1 {
		t.Fatalf("room-a comments=%d", list[1].Comments)
	}

	// Filter by game
	ttt, tttTotal, err := st.ListMatches(ctx, ListOptions{Game: "tic-tac-toe"})
	if err != nil {
		t.Fatalf("ListMatches game filter: %v", err)
	}
	if tttTotal != 2 || len(ttt) != 2 {
		t.Fatalf("ttt total=%d len=%d", tttTotal, len(ttt))
	}

	// GetMatch round-trip
	got, ok, err := st.GetMatch(ctx, "room-a")
	if err != nil {
		t.Fatalf("GetMatch: %v", err)
	}
	if !ok || got == nil {
		t.Fatal("GetMatch room-a not found")
	}
	if got.Report.Room != "room-a" || got.Report.GameID != "tic-tac-toe" {
		t.Fatalf("report ids: %+v", got.Report)
	}
	if got.Report.Result == nil || got.Report.Result.Winner != "X" {
		t.Fatalf("result: %+v", got.Report.Result)
	}
	if len(got.Comments) != 1 || got.Comments[0].Text != "gg" {
		t.Fatalf("comments: %+v", got.Comments)
	}

	// Unknown room
	_, ok, err = st.GetMatch(ctx, "no-such-room")
	if err != nil {
		t.Fatalf("GetMatch missing: %v", err)
	}
	if ok {
		t.Fatal("expected missing match")
	}

	// Leaderboard: Alice win + draw -> Games=2, Wins=1, Draws=1
	rows, err := st.Leaderboard(ctx)
	if err != nil {
		t.Fatalf("Leaderboard: %v", err)
	}
	byName := map[string]protocol.LeaderRow{}
	for _, r := range rows {
		byName[r.Name] = r
	}
	alice, ok := byName["Alice"]
	if !ok {
		t.Fatalf("Alice missing from leaderboard: %+v", rows)
	}
	if alice.Games != 2 || alice.Wins != 1 || alice.Draws != 1 || alice.Losses != 0 {
		t.Fatalf("Alice W/L/D: games=%d w=%d l=%d d=%d", alice.Games, alice.Wins, alice.Losses, alice.Draws)
	}
	if alice.TopMethod != "model" {
		t.Fatalf("Alice TopMethod=%q", alice.TopMethod)
	}
	bob, ok := byName["Bob"]
	if !ok {
		t.Fatal("Bob missing")
	}
	if bob.Games != 1 || bob.Losses != 1 {
		t.Fatalf("Bob: games=%d losses=%d", bob.Games, bob.Losses)
	}
	// Wins desc: Alice (1 win) before Bob (0 wins) — Dave also has 1 win
	if len(rows) < 2 {
		t.Fatalf("expected several rows, got %d", len(rows))
	}
	// Alice and Dave both 1 win; Alice games=2 so Alice first among them by Games desc
	// Actually: sort Wins desc, Games desc, Name asc.
	// Alice: W1 G2; Dave: W1 G1 → Alice before Dave
	if rows[0].Name != "Alice" {
		t.Fatalf("expected Alice first (wins then games), got %s", rows[0].Name)
	}
}

func TestMemStore(t *testing.T) {
	st := NewMem()
	t.Cleanup(func() { _ = st.Close() })
	runStoreSuite(t, st)
}

func TestSQLiteStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "arena.db")
	st, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	runStoreSuite(t, st)
}

func TestOpenEmptyIsMem(t *testing.T) {
	st, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if _, ok := st.(*memStore); !ok {
		t.Fatalf("Open(\"\") should return memStore, got %T", st)
	}
}

func TestSaveMatchUpsert(t *testing.T) {
	st := NewMem()
	ctx := context.Background()
	m := testMatch("r1", "tic-tac-toe", 1000,
		&protocol.GameResult{Kind: protocol.ResultWin, Winner: "X"},
		[]protocol.PlayerReport{{Seat: "X", Name: "A", Moves: 1}},
		nil,
	)
	if err := st.SaveMatch(ctx, m); err != nil {
		t.Fatal(err)
	}
	m.EndedAt = 9999
	m.Report.EndedAt = 9999
	if err := st.SaveMatch(ctx, m); err != nil {
		t.Fatal(err)
	}
	list, total, err := st.ListMatches(ctx, ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 || list[0].EndedAt != 9999 {
		t.Fatalf("upsert failed: total=%d list=%+v", total, list)
	}
}
