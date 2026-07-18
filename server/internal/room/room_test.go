package room

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/server/internal/store"
	// tictactoe registers via init
	_ "github.com/agents-arena/agents-arena/rules/tictactoe"
)

func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func TestFullTicTacToeGame(t *testing.T) {
	// create with host X
	rm, hostTok, err := NewRoom("testroom", "tic-tac-toe", "HostBot", "gpt-x", true, protocol.ReasoningOpen)
	if err != nil {
		t.Fatalf("NewRoom: %v", err)
	}
	if hostTok == "" {
		t.Error("expected host token")
	}
	if rm.ID() != "testroom" {
		t.Errorf("id=%s", rm.ID())
	}

	snap := rm.Snapshot()
	if snap.GameID != "tic-tac-toe" {
		t.Errorf("gameId=%s", snap.GameID)
	}
	if snap.Rev != 0 {
		t.Errorf("rev=%d", snap.Rev)
	}
	if snap.ToMove != "X" {
		t.Errorf("toMove=%s", snap.ToMove)
	}
	if snap.Result != nil {
		t.Error("result should be nil at start")
	}
	if len(snap.Players) == 0 || snap.Players[0].Seat != "X" || !snap.Players[0].Connected {
		t.Errorf("players=%+v", snap.Players)
	}

	// join guest O
	jr, err := rm.Join(protocol.RoleGuest, "GuestBot", "gpt-o", "")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	if jr.Role != protocol.RoleGuest || jr.Seat != "O" || jr.Token == "" {
		t.Errorf("guest join: role=%s seat=%s tok=%s", jr.Role, jr.Seat, jr.Token)
	}
	guestTok := jr.Token

	snap = rm.Snapshot()
	foundO := false
	for _, p := range snap.Players {
		if p.Seat == "O" && p.Connected {
			foundO = true
		}
	}
	if !foundO {
		t.Error("O not in snapshot after join")
	}

	// now play a full game reaching X win on middle column (1-4-7)
	// X (host) move cell 4 (center)
	ack := rm.Move(hostTok, mustJSON(t, map[string]int{"cell": 4}), &protocol.MoveMeta{Model: "gpt-x"})
	if !ack.OK || ack.Rev != 1 {
		t.Errorf("move1 ack=%+v", ack)
	}

	// illegal: X tries again while it is O's turn -> not your turn, rejected count for X
	ackBad := rm.Move(hostTok, mustJSON(t, map[string]int{"cell": 8}), nil)
	if ackBad.OK || ackBad.Reason != "not your turn" {
		t.Errorf("wrong turn should reject: %+v", ackBad)
	}
	if rm.rejectedCount("X") != 1 {
		t.Errorf("rejected X = %d", rm.rejectedCount("X"))
	}

	// O corner 0 (legal)
	ack = rm.Move(guestTok, mustJSON(t, map[string]int{"cell": 0}), nil)
	if !ack.OK {
		t.Errorf("move2: %v", ack)
	}

	// X takes 1 (sets up column)
	ack = rm.Move(hostTok, mustJSON(t, map[string]int{"cell": 1}), nil)
	if !ack.OK {
		t.Errorf("move3: %v", ack)
	}

	// O takes 8
	ack = rm.Move(guestTok, mustJSON(t, map[string]int{"cell": 8}), nil)
	if !ack.OK {
		t.Errorf("move4: %v", ack)
	}

	// X takes 7 -> X wins (1,4,7)
	ack = rm.Move(hostTok, mustJSON(t, map[string]int{"cell": 7}), nil)
	if !ack.OK {
		t.Fatalf("move5 X7 failed: %+v", ack)
	}

	// now check snapshot has result
	snap = rm.Snapshot()
	if snap.Result == nil || snap.Result.Kind != protocol.ResultWin || snap.Result.Winner != "X" {
		t.Fatalf("expected X win, got %+v", snap.Result)
	}
	if snap.ToMove != "" {
		t.Error("toMove should be empty on terminal")
	}

	// illegal move after end
	ack = rm.Move(hostTok, mustJSON(t, map[string]int{"cell": 6}), nil)
	if ack.OK {
		t.Error("move after end should fail")
	}

	// check report
	rep := rm.Report()
	if rep.ProtocolV != protocol.Version {
		t.Error("protocolV")
	}
	if rep.GameID != "tic-tac-toe" || rep.Room != "testroom" {
		t.Errorf("report ids: %+v", rep)
	}
	if rep.Result == nil || rep.Result.Winner != "X" {
		t.Errorf("report result %+v", rep.Result)
	}
	if len(rep.Moves) != 5 {
		t.Errorf("moves len %d", len(rep.Moves))
	}
	// thinkMs are positive numbers or zero (fast)
	for i, m := range rep.Moves {
		if m.ThinkMs < 0 {
			t.Errorf("move %d thinkMs negative", i)
		}
	}
	// rejected: we had one on X (the wrong-turn attempt)
	if rep.Players == nil {
		t.Fatal("no players in report")
	}
	var xRep protocol.PlayerReport
	for _, p := range rep.Players {
		if p.Seat == "X" {
			xRep = p
		}
	}
	if xRep.Rejected < 1 {
		t.Errorf("X rejected=%d", xRep.Rejected)
	}
	// O made at least 2 moves
	var oRep protocol.PlayerReport
	for _, p := range rep.Players {
		if p.Seat == "O" {
			oRep = p
		}
	}
	if oRep.Moves < 2 {
		t.Errorf("O moves=%d", oRep.Moves)
	}
}

func TestEmoteDoesNotAffectRev(t *testing.T) {
	rm, hostTok, _ := NewRoom("e1", "tic-tac-toe", "H", "", true, protocol.ReasoningOpen)
	rev0 := rm.Snapshot().Rev

	_ = rm.Emote(hostTok, protocol.EmotionHappy, "gg")
	_ = rm.Emote(hostTok, protocol.EmotionCelebrating, "")

	rev1 := rm.Snapshot().Rev
	if rev0 != rev1 {
		t.Errorf("emote changed rev %d -> %d", rev0, rev1)
	}

	e, ok := rm.emoteFor("X")
	if !ok || e.Emotion != protocol.EmotionCelebrating {
		t.Errorf("latest emote %+v", e)
	}
}

func TestResumeToken(t *testing.T) {
	rm, _, _ := NewRoom("r1", "tic-tac-toe", "H", "m1", true, protocol.ReasoningOpen)
	jr, _ := rm.Join(protocol.RoleGuest, "G", "m2", "")
	guestTok, seat := jr.Token, jr.Seat
	if seat != "O" {
		t.Fatal(seat)
	}

	snap := rm.Snapshot()
	for _, p := range snap.Players {
		if p.Seat == "O" && !p.Connected {
			t.Error("O should be connected")
		}
	}

	// "disconnect" conceptually by new join without resume would fail to take seat
	// but with resume reclaims
	jr2, err := rm.Join(protocol.RoleGuest, "G2", "", guestTok)
	if err != nil || jr2.Token != guestTok || jr2.Role != protocol.RoleGuest || jr2.Seat != "O" {
		t.Fatalf("resume failed: tok=%s role=%s seat=%s err=%v", jr2.Token, jr2.Role, jr2.Seat, err)
	}
}

func TestReportTimingsAndMeta(t *testing.T) {
	rm, hostTok, _ := NewRoom("time1", "tic-tac-toe", "H", "modelH", true, protocol.ReasoningOpen)
	jr, _ := rm.Join(protocol.RoleGuest, "G", "modelG", "")
	guestTok := jr.Token

	// make a couple moves with meta
	meta1 := &protocol.MoveMeta{TokensIn: 10, TokensOut: 5, Model: "modelH"}
	rm.Move(hostTok, mustJSON(t, map[string]int{"cell": 4}), meta1)
	time.Sleep(1 * time.Millisecond) // ensure some think time observable
	rm.Move(guestTok, mustJSON(t, map[string]int{"cell": 0}), &protocol.MoveMeta{TokensIn: 3})

	rep := rm.Report()
	var h, g protocol.PlayerReport
	for _, p := range rep.Players {
		if p.Seat == "X" {
			h = p
		} else if p.Seat == "O" {
			g = p
		}
	}
	if h.TokensIn != 10 || h.TokensOut != 5 {
		t.Errorf("host tokens %d/%d", h.TokensIn, h.TokensOut)
	}
	if g.Moves != 1 {
		t.Errorf("g moves %d", g.Moves)
	}
	if h.TotalThinkMs == 0 && g.TotalThinkMs == 0 {
		// possible if too fast, but at least fields present
	}
}

// A seatless (spectator-created) room keeps BOTH seats open, so two agents can
// join and get X then O — the fix for web-created rooms where the creator used
// to silently hold seat X.
func TestSeatlessRoomOpensBothSeats(t *testing.T) {
	rm, hostTok, err := NewRoom("seatless", "tic-tac-toe", "", "", false, protocol.ReasoningOpen)
	if err != nil {
		t.Fatalf("NewRoom: %v", err)
	}
	if hostTok != "" {
		t.Fatalf("seatless room should return an empty host token, got %q", hostTok)
	}
	j1, _ := rm.Join(protocol.RoleGuest, "a", "", "")
	j2, _ := rm.Join(protocol.RoleGuest, "b", "", "")
	j3, _ := rm.Join(protocol.RoleGuest, "c", "", "")
	if j1.Seat != "X" || j2.Seat != "O" {
		t.Fatalf("first two joins should get X then O, got %q,%q", j1.Seat, j2.Seat)
	}
	// Third join when both seats are connecting (not lost): spectator, not pending.
	if j3.Seat != "" || j3.Role != protocol.RoleSpectator || j3.Pending {
		t.Fatalf("third join to a full busy room should be spectator, got role=%q seat=%q pending=%v", j3.Role, j3.Seat, j3.Pending)
	}
}

// Presence: a seat is "connecting" after join, "connected" while a token'd event
// stream is open, and "lost" once it closes.
func TestSeatPresenceStatus(t *testing.T) {
	rm, _, err := NewRoom("pres", "tic-tac-toe", "", "", false, protocol.ReasoningOpen)
	if err != nil {
		t.Fatalf("NewRoom: %v", err)
	}
	jr, _ := rm.Join(protocol.RoleGuest, "a", "", "")
	tok, seat := jr.Token, jr.Seat
	statusOf := func() string {
		for _, p := range rm.Snapshot().Players {
			if p.Seat == seat {
				return p.Status
			}
		}
		return ""
	}
	if got := statusOf(); got != "connecting" {
		t.Fatalf("after join, want connecting, got %q", got)
	}
	if s := rm.PresenceUp(tok); s != seat {
		t.Fatalf("PresenceUp returned %q, want %q", s, seat)
	}
	if got := statusOf(); got != "connected" {
		t.Fatalf("with a live stream, want connected, got %q", got)
	}
	rm.PresenceDown(seat)
	if got := statusOf(); got != "lost" {
		t.Fatalf("after the stream closes, want lost, got %q", got)
	}
	// an unknown token doesn't affect presence
	if s := rm.PresenceUp("nope"); s != "" {
		t.Fatalf("PresenceUp with a bad token should return empty, got %q", s)
	}
}

func TestNormalizeName(t *testing.T) {
	if _, err := NormalizeName(""); err == nil || err.Error() != "name required" {
		t.Fatalf("empty: %v", err)
	}
	if _, err := NormalizeName("   "); err == nil {
		t.Fatal("whitespace-only should fail")
	}
	if _, err := NormalizeName("\x00\x01"); err == nil {
		t.Fatal("control-only should fail")
	}
	long := ""
	for i := 0; i < 41; i++ {
		long += "a"
	}
	if _, err := NormalizeName(long); err == nil || err.Error() != "name too long" {
		t.Fatalf("too long: %v", err)
	}
	n, err := NormalizeName("  Khaled\x00  ")
	if err != nil || n != "Khaled" {
		t.Fatalf("got %q err=%v", n, err)
	}
}

func TestCommenterRole(t *testing.T) {
	rm, hostTok, _ := NewRoom("cmt", "tic-tac-toe", "Host", "", true, protocol.ReasoningOpen)
	jr, err := rm.Join(protocol.RoleCommenter, "Chatty", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if jr.Role != protocol.RoleCommenter || jr.Token == "" || jr.Seat != "" {
		t.Fatalf("commenter join: %+v", jr)
	}
	// commenter can comment
	c, err := rm.Comment(jr.Token, "nice fork")
	if err != nil {
		t.Fatal(err)
	}
	if c.Role != "commenter" || c.Name != "Chatty" || c.Text != "nice fork" || c.Seat != "" {
		t.Fatalf("comment: %+v", c)
	}
	// player can comment with seat
	c2, err := rm.Comment(hostTok, "hello")
	if err != nil {
		t.Fatal(err)
	}
	if c2.Role != "player" || c2.Seat != "X" {
		t.Fatalf("player comment: %+v", c2)
	}
	// rate limit
	if _, err := rm.Comment(jr.Token, "spam"); err == nil || err.Error() != "slow down" {
		t.Fatalf("rate limit: %v", err)
	}
	// commenter cannot move
	ack := rm.Move(jr.Token, mustJSON(t, map[string]int{"cell": 0}), nil)
	if ack.OK || ack.Reason != "unauthorized" {
		t.Fatalf("commenter move: %+v", ack)
	}
	if !rm.IsCommenterToken(jr.Token) {
		t.Error("IsCommenterToken")
	}
	if rm.IsPlayerToken(jr.Token) {
		t.Error("commenter should not be player")
	}
}

func TestCommentLengthAndReplayBuffer(t *testing.T) {
	rm, hostTok, _ := NewRoom("buf", "tic-tac-toe", "H", "", true, protocol.ReasoningOpen)
	if _, err := rm.Comment(hostTok, ""); err == nil {
		t.Fatal("empty text")
	}
	long := make([]byte, 300)
	for i := range long {
		long[i] = 'x'
	}
	if _, err := rm.Comment(hostTok, string(long)); err == nil {
		t.Fatal("too long")
	}
	// fill a few
	for i := 0; i < 3; i++ {
		// bypass rate limit by direct injection via sleeping... or just one then force
		rm.mu.Lock()
		delete(rm.lastCommentAt, hostTok)
		rm.mu.Unlock()
		if _, err := rm.Comment(hostTok, "msg"); err != nil {
			t.Fatal(err)
		}
	}
	buf := rm.Comments()
	if len(buf) != 3 {
		t.Fatalf("buf len %d", len(buf))
	}
}

func TestApprovalHappyPath(t *testing.T) {
	rm, hostTok, _ := NewRoom("appr", "tic-tac-toe", "Host", "", true, protocol.ReasoningOpen)
	jr, _ := rm.Join(protocol.RoleGuest, "Guest", "", "")
	guestTok := jr.Token
	oldGuestTok := guestTok

	// mark O lost
	rm.forceLostForTest("O")

	// new joiner requests the lost seat
	pending, err := rm.Join(protocol.RoleGuest, "Replacer", "m", "")
	if err != nil {
		t.Fatal(err)
	}
	if !pending.Pending || pending.RequestID == "" || pending.Token != "" {
		t.Fatalf("want pending: %+v", pending)
	}

	// host approves
	if err := rm.Approve(hostTok, pending.RequestID, true); err != nil {
		t.Fatal(err)
	}

	// poll: token once
	v1, ok := rm.PollApproval(pending.RequestID)
	if !ok || v1.Status != "approved" || v1.Token == "" || v1.Seat != "O" {
		t.Fatalf("poll1: %+v ok=%v", v1, ok)
	}
	newTok := v1.Token
	// second poll: no token handoff
	v2, _ := rm.PollApproval(pending.RequestID)
	if v2.Token != "" {
		t.Fatalf("token should be single-use, got %q", v2.Token)
	}

	// new token works for moves; old is dead
	// Host moves first
	ack := rm.Move(hostTok, mustJSON(t, map[string]int{"cell": 4}), nil)
	if !ack.OK {
		t.Fatalf("host move: %+v", ack)
	}
	ack = rm.Move(newTok, mustJSON(t, map[string]int{"cell": 0}), nil)
	if !ack.OK {
		t.Fatalf("new token move: %+v", ack)
	}
	ack = rm.Move(oldGuestTok, mustJSON(t, map[string]int{"cell": 1}), nil)
	if ack.OK {
		t.Fatal("old token should be dead")
	}
}

func TestApprovalDeny(t *testing.T) {
	rm, hostTok, _ := NewRoom("deny", "tic-tac-toe", "Host", "", true, protocol.ReasoningOpen)
	_, _ = rm.Join(protocol.RoleGuest, "Guest", "", "")
	rm.forceLostForTest("O")

	pending, _ := rm.Join(protocol.RoleGuest, "Nope", "", "")
	if err := rm.Approve(hostTok, pending.RequestID, false); err != nil {
		t.Fatal(err)
	}
	v, ok := rm.PollApproval(pending.RequestID)
	if !ok || v.Status != "denied" || v.Token != "" {
		t.Fatalf("deny poll: %+v", v)
	}
}

func TestReconnectAutoDeny(t *testing.T) {
	rm, _, _ := NewRoom("recon", "tic-tac-toe", "Host", "", true, protocol.ReasoningOpen)
	jr, _ := rm.Join(protocol.RoleGuest, "Guest", "", "")
	guestTok := jr.Token

	// guest goes live then drops
	rm.PresenceUp(guestTok)
	rm.PresenceDown("O")

	pending, _ := rm.Join(protocol.RoleGuest, "Hijacker", "", "")
	if !pending.Pending {
		t.Fatal("expected pending")
	}

	// original guest reconnects via events stream
	rm.PresenceUp(guestTok)

	v, ok := rm.PollApproval(pending.RequestID)
	if !ok || v.Status != "denied" {
		t.Fatalf("want auto-denied, got %+v ok=%v", v, ok)
	}
}

func TestHintsInSnapshotViaStubHinter(t *testing.T) {
	// Register a stub game that implements Hinter, use it for a room.
	stub := &hintingRules{
		id:    "hint-stub",
		seats: []string{"A", "B"},
		hints: []string{"claim available", "vary your play"},
	}
	// Register may no-op if already registered from a prior test run in same process
	// so use a unique id.
	stub.id = "hint-stub-" + generateToken()[:8]
	// We need rules.Register — import rules package.
	registerStub(stub)

	rm, _, err := NewRoom("hints", stub.id, "P1", "", true, protocol.ReasoningOpen)
	if err != nil {
		t.Fatalf("NewRoom: %v", err)
	}
	snap := rm.Snapshot()
	if len(snap.Hints) != 2 || snap.Hints[0] != "claim available" {
		t.Fatalf("hints missing: %+v", snap.Hints)
	}
	// tokens must not appear in snapshot JSON
	b, _ := json.Marshal(snap)
	if containsTokenLeak(string(b), rm.playerTokenForTest("A")) {
		t.Fatal("token leaked into snapshot")
	}
}

func containsTokenLeak(s, tok string) bool {
	return tok != "" && len(tok) > 4 && (stringIndex(s, tok) >= 0)
}

func stringIndex(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestOnArchiveAndMethodAggregation(t *testing.T) {
	rm, hostTok, err := NewRoom("arch1", "tic-tac-toe", "HostBot", "gpt-x", true, protocol.ReasoningSelf)
	if err != nil {
		t.Fatalf("NewRoom: %v", err)
	}
	// Reasoning should be normalized and appear on snapshot/report.
	if snap := rm.Snapshot(); snap.Reasoning != protocol.ReasoningSelf {
		t.Fatalf("snapshot reasoning=%q", snap.Reasoning)
	}

	var captured *store.MatchArchive
	done := make(chan struct{}, 1)
	rm.onArchive = func(a store.MatchArchive) {
		cp := a
		captured = &cp
		done <- struct{}{}
	}

	jr, err := rm.Join(protocol.RoleGuest, "GuestBot", "gpt-o", "")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	guestTok := jr.Token

	// X4, O0, X1, O8, X7 -> X wins; include Method on metas.
	moves := []struct {
		tok    string
		cell   int
		method string
	}{
		{hostTok, 4, "model"},
		{guestTok, 0, "engine"},
		{hostTok, 1, "model"},
		{guestTok, 8, "engine"},
		{hostTok, 7, "hybrid"}, // dominant for X still "model" (2 vs 1)
	}
	for i, m := range moves {
		ack := rm.Move(m.tok, mustJSON(t, map[string]int{"cell": m.cell}), &protocol.MoveMeta{Method: m.method})
		if !ack.OK {
			t.Fatalf("move %d: %+v", i, ack)
		}
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("onArchive was not invoked")
	}
	if captured == nil {
		t.Fatal("no archive captured")
	}
	if captured.Reasoning != protocol.ReasoningSelf {
		t.Fatalf("archive reasoning=%q", captured.Reasoning)
	}
	if captured.Report.Reasoning != protocol.ReasoningSelf {
		t.Fatalf("report reasoning=%q", captured.Report.Reasoning)
	}
	if captured.Room != "arch1" || captured.GameID != "tic-tac-toe" {
		t.Fatalf("archive ids room=%s game=%s", captured.Room, captured.GameID)
	}
	if captured.Report.Result == nil || captured.Report.Result.Winner != "X" {
		t.Fatalf("archive result: %+v", captured.Report.Result)
	}

	var xRep, oRep protocol.PlayerReport
	for _, p := range captured.Report.Players {
		if p.Seat == "X" {
			xRep = p
		}
		if p.Seat == "O" {
			oRep = p
		}
	}
	if xRep.Method != "model" {
		t.Fatalf("X Method=%q methods=%v", xRep.Method, xRep.Methods)
	}
	if xRep.Methods["model"] != 2 || xRep.Methods["hybrid"] != 1 {
		t.Fatalf("X Methods=%v", xRep.Methods)
	}
	if oRep.Method != "engine" {
		t.Fatalf("O Method=%q methods=%v", oRep.Method, oRep.Methods)
	}
}
