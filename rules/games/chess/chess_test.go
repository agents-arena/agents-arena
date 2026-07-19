package chess

import (
	"encoding/json"
	"testing"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

func newGame() spec.Rules {
	return New().(spec.Rules)
}

func TestInit(t *testing.T) {
	g := newGame()
	s := g.Init("").(state)

	if s.FEN != startFEN {
		t.Errorf("fen = %q, want startFEN", s.FEN)
	}
	if s.Moves == nil {
		t.Error("Moves is nil, want non-nil empty slice")
	}
	if len(s.Moves) != 0 {
		t.Errorf("len(Moves) = %d, want 0", len(s.Moves))
	}
	if s.History == nil {
		t.Error("History is nil, want non-nil empty slice")
	}
	if len(s.History) != 0 {
		t.Errorf("len(History) = %d, want 0", len(s.History))
	}
	if len(s.Keys) != 1 {
		t.Fatalf("len(Keys) = %d, want 1", len(s.Keys))
	}

	pos, _ := parseFEN(startFEN)
	wantKey := positionKey(pos)
	if s.Keys[0] != wantKey {
		t.Errorf("Keys[0] = %q, want %q", s.Keys[0], wantKey)
	}
	if s.LastMove != nil {
		t.Error("LastMove should be nil")
	}
	if s.Claimed != "" {
		t.Errorf("Claimed = %q, want empty", s.Claimed)
	}
	if s.Resigned != "" {
		t.Errorf("Resigned = %q, want empty", s.Resigned)
	}
}

func TestToMove(t *testing.T) {
	g := newGame()
	st := g.Init("").(state)

	if got := g.ToMove(st); got != "white" {
		t.Errorf("ToMove = %q, want white", got)
	}

	st = g.Apply(st, json.RawMessage(`{"from":"e2","to":"e4"}`)).(state)
	if got := g.ToMove(st); got != "black" {
		t.Errorf("ToMove after e2e4 = %q, want black", got)
	}

	foolsMate := g.Init("").(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"f2","to":"f3"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"e7","to":"e5"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"g2","to":"g4"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"d8","to":"h4"}`)).(state)
	if got := g.ToMove(foolsMate); got != "" {
		t.Errorf("ToMove at fool's mate = %q, want empty", got)
	}
}

func TestValidateErrorStrings(t *testing.T) {
	g := newGame()
	st := g.Init("").(state)

	err := g.Validate(st, json.RawMessage(`{"from":"e2","to":"e4"}`), "black")
	if err == nil || err.Error() != "not your turn" {
		t.Errorf("black at start: got %v, want 'not your turn'", err)
	}

	err = g.Validate(st, json.RawMessage(`{"from":"z9","to":"e4"}`), "white")
	if err == nil || err.Error() != "malformed move" {
		t.Errorf("bad square z9: got %v, want 'malformed move'", err)
	}

	err = g.Validate(st, json.RawMessage(`{"from":"e2","to":"e4","promotion":"x"}`), "white")
	if err == nil || err.Error() != "malformed move" {
		t.Errorf("bad promotion x: got %v, want 'malformed move'", err)
	}

	err = g.Validate(st, json.RawMessage(`{"from":"e2","to":"e5"}`), "white")
	if err == nil || err.Error() != "illegal move" {
		t.Errorf("illegal e2e5: got %v, want 'illegal move'", err)
	}

	// Claim when not available.
	err = g.Validate(st, json.RawMessage(`{"claim":"draw"}`), "white")
	if err == nil || err.Error() != "no draw to claim" {
		t.Errorf("claim at start: got %v, want 'no draw to claim'", err)
	}

	// Malformed: claim mixed with from/to.
	err = g.Validate(st, json.RawMessage(`{"claim":"draw","from":"e2","to":"e4"}`), "white")
	if err == nil || err.Error() != "malformed move" {
		t.Errorf("claim+from: got %v, want 'malformed move'", err)
	}

	// Malformed: resign mixed with from/to.
	err = g.Validate(st, json.RawMessage(`{"resign":true,"from":"e2","to":"e4"}`), "white")
	if err == nil || err.Error() != "malformed move" {
		t.Errorf("resign+from: got %v, want 'malformed move'", err)
	}

	// Resign always legal for side to move.
	err = g.Validate(st, json.RawMessage(`{"resign":true}`), "white")
	if err != nil {
		t.Errorf("resign at start: got %v, want nil", err)
	}

	promoState, perr := g.Deserialize(json.RawMessage(
		`{"fen":"8/P6k/8/8/8/8/8/4K3 w - - 0 1","moves":[],"history":[],"keys":["8/P6k/8/8/8/8/8/4K3 w - -"],"lastMove":null}`,
	))
	if perr != nil {
		t.Fatalf("deserialize promo position: %v", perr)
	}
	ps := promoState.(state)
	err = g.Validate(ps, json.RawMessage(`{"from":"a7","to":"a8"}`), "white")
	if err == nil || err.Error() != "promotion required" {
		t.Errorf("a7a8 without promotion: got %v, want 'promotion required'", err)
	}
	err = g.Validate(ps, json.RawMessage(`{"from":"a7","to":"a8","promotion":"q"}`), "white")
	if err != nil {
		t.Errorf("a7a8 with promotion q: got %v, want nil", err)
	}

	foolsMate := g.Init("").(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"f2","to":"f3"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"e7","to":"e5"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"g2","to":"g4"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"d8","to":"h4"}`)).(state)
	err = g.Validate(foolsMate, json.RawMessage(`{"from":"e2","to":"e4"}`), "white")
	if err == nil || err.Error() != "game over" {
		t.Errorf("move after fool's mate: got %v, want 'game over'", err)
	}
}

func TestApply(t *testing.T) {
	g := newGame()
	st := g.Init("").(state)

	origFEN := st.FEN
	origMovesLen := len(st.Moves)
	origHistoryLen := len(st.History)
	origKeysLen := len(st.Keys)

	after := g.Apply(st, json.RawMessage(`{"from":"e2","to":"e4"}`)).(state)

	if st.FEN != origFEN {
		t.Error("input state FEN was mutated")
	}
	if len(st.Moves) != origMovesLen {
		t.Error("input state Moves was mutated")
	}
	if len(st.History) != origHistoryLen {
		t.Error("input state History was mutated")
	}
	if len(st.Keys) != origKeysLen {
		t.Error("input state Keys was mutated")
	}

	wantFEN := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	if after.FEN != wantFEN {
		t.Errorf("FEN = %q, want %q", after.FEN, wantFEN)
	}
	if len(after.Moves) != 1 || after.Moves[0] != "e2e4" {
		t.Errorf("Moves = %v, want [e2e4]", after.Moves)
	}
	if len(after.History) != 1 || after.History[0] != "e4" {
		t.Errorf("History = %v, want [e4]", after.History)
	}
	if len(after.Keys) != 2 {
		t.Errorf("len(Keys) = %d, want 2", len(after.Keys))
	}
	if after.LastMove == nil || after.LastMove.From != "e2" || after.LastMove.To != "e4" {
		t.Errorf("LastMove = %+v, want From:e2 To:e4", after.LastMove)
	}
}

func TestLegalMoves(t *testing.T) {
	g := newGame()
	st := g.Init("").(state)

	moves := g.LegalMoves(st)
	// 20 board moves + resign at the tail (claim not available at start).
	if len(moves) != 21 {
		t.Errorf("initial legal moves = %d, want 21 (20 board + resign)", len(moves))
	}
	// Resign must be last.
	var last map[string]interface{}
	if err := json.Unmarshal(moves[len(moves)-1], &last); err != nil {
		t.Fatalf("unmarshal last legal move: %v", err)
	}
	if last["resign"] != true {
		t.Errorf("last legal move = %s, want resign:true", moves[len(moves)-1])
	}
	// No claim at start.
	for _, m := range moves {
		var wire map[string]interface{}
		json.Unmarshal(m, &wire)
		if wire["claim"] != nil {
			t.Errorf("unexpected claim in initial legal moves: %s", m)
		}
	}

	foolsMate := g.Init("").(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"f2","to":"f3"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"e7","to":"e5"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"g2","to":"g4"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"d8","to":"h4"}`)).(state)
	moves = g.LegalMoves(foolsMate)
	if moves == nil {
		t.Error("LegalMoves at terminal returned nil, want non-nil empty slice")
	} else if len(moves) != 0 {
		t.Errorf("LegalMoves at terminal = %d, want 0", len(moves))
	}

	promoState, err := g.Deserialize(json.RawMessage(
		`{"fen":"8/P6k/8/8/8/8/8/4K3 w - - 0 1","moves":[],"history":[],"keys":["8/P6k/8/8/8/8/8/4K3 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize promo position: %v", err)
	}
	moves = g.LegalMoves(promoState)
	a7a8Count := 0
	for _, m := range moves {
		var mv struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		json.Unmarshal(m, &mv)
		if mv.From == "a7" && mv.To == "a8" {
			a7a8Count++
		}
	}
	if a7a8Count != 4 {
		t.Errorf("a7a8 promotion moves = %d, want 4", a7a8Count)
	}
}

func TestTerminal(t *testing.T) {
	g := newGame()
	st := g.Init("").(state)

	if res := g.Terminal(st); res != nil {
		t.Errorf("Terminal at init = %+v, want nil", res)
	}

	foolsMate := g.Init("").(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"f2","to":"f3"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"e7","to":"e5"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"g2","to":"g4"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"d8","to":"h4"}`)).(state)
	res := g.Terminal(foolsMate)
	if res == nil {
		t.Fatal("Terminal at fool's mate = nil")
	}
	if res.Kind != protocol.ResultWin {
		t.Errorf("Kind = %q, want win", res.Kind)
	}
	if res.Winner != "black" {
		t.Errorf("Winner = %q, want black", res.Winner)
	}
	if res.Reason != "checkmate" {
		t.Errorf("Reason = %q, want checkmate", res.Reason)
	}

	staleState, err := g.Deserialize(json.RawMessage(
		`{"fen":"7k/8/6QK/8/8/8/8/8 b - - 0 1","moves":[],"history":[],"keys":["7k/8/6QK/8/8/8/8/8 b - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize stalemate: %v", err)
	}
	res = g.Terminal(staleState)
	if res == nil {
		t.Fatal("Terminal at stalemate = nil")
	}
	if res.Kind != protocol.ResultDraw || res.Reason != "stalemate" {
		t.Errorf("Terminal = %+v, want draw stalemate", res)
	}

	// Fifty-move is claimable at halfmove>=100, NOT automatic.
	fiftyState, err := g.Deserialize(json.RawMessage(
		`{"fen":"7k/8/8/8/8/8/R7/K7 w - - 99 80","moves":[],"history":[],"keys":["7k/8/8/8/8/8/R7/K7 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize fifty-move: %v", err)
	}
	fiftyState = g.Apply(fiftyState, json.RawMessage(`{"from":"a2","to":"b2"}`))
	res = g.Terminal(fiftyState)
	if res != nil {
		t.Errorf("Terminal at halfmove 100 = %+v, want nil (claimable only)", res)
	}

	// Threefold at 3 is claimable, NOT automatic.
	threefold := g.Init("").(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"g1","to":"f3"}`)).(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"g8","to":"f6"}`)).(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"f3","to":"g1"}`)).(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"f6","to":"g8"}`)).(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"g1","to":"f3"}`)).(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"g8","to":"f6"}`)).(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"f3","to":"g1"}`)).(state)
	threefold = g.Apply(threefold, json.RawMessage(`{"from":"f6","to":"g8"}`)).(state)
	res = g.Terminal(threefold)
	if res != nil {
		t.Errorf("Terminal at threefold = %+v, want nil (claimable only)", res)
	}
	if keyCount(threefold) != 3 {
		t.Errorf("keyCount at threefold = %d, want 3", keyCount(threefold))
	}

	insuffState, err := g.Deserialize(json.RawMessage(
		`{"fen":"k7/8/8/8/8/8/8/KB6 w - - 0 1","moves":[],"history":[],"keys":["k7/8/8/8/8/8/8/KB6 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize insufficient material: %v", err)
	}
	res = g.Terminal(insuffState)
	if res == nil {
		t.Fatal("Terminal at insufficient material = nil")
	}
	if res.Kind != protocol.ResultDraw || res.Reason != "insufficient material" {
		t.Errorf("Terminal = %+v, want draw 'insufficient material'", res)
	}
}

func TestClaimDrawThreefold(t *testing.T) {
	g := newGame()
	// Reach third occurrence of start key via knight shuffle.
	st := g.Init("").(state)
	shuffle := []string{
		`{"from":"g1","to":"f3"}`, `{"from":"g8","to":"f6"}`,
		`{"from":"f3","to":"g1"}`, `{"from":"f6","to":"g8"}`,
		`{"from":"g1","to":"f3"}`, `{"from":"g8","to":"f6"}`,
		`{"from":"f3","to":"g1"}`, `{"from":"f6","to":"g8"}`,
	}
	for _, m := range shuffle {
		st = g.Apply(st, json.RawMessage(m)).(state)
	}
	if keyCount(st) != 3 {
		t.Fatalf("keyCount = %d, want 3", keyCount(st))
	}

	// Claim is legal.
	err := g.Validate(st, json.RawMessage(`{"claim":"draw"}`), "white")
	if err != nil {
		t.Fatalf("claim at 3rd occurrence: got %v, want nil", err)
	}

	// Claim appears in LegalMoves (before resign at the tail).
	moves := g.LegalMoves(st)
	foundClaim := false
	for _, m := range moves {
		var wire map[string]interface{}
		json.Unmarshal(m, &wire)
		if wire["claim"] == "draw" {
			foundClaim = true
		}
	}
	if !foundClaim {
		t.Error("LegalMoves missing claim:draw at threefold")
	}
	var last map[string]interface{}
	json.Unmarshal(moves[len(moves)-1], &last)
	if last["resign"] != true {
		t.Error("resign must be last in LegalMoves")
	}

	prevLast := st.LastMove
	after := g.Apply(st, json.RawMessage(`{"claim":"draw"}`)).(state)
	if after.Claimed != "threefold" {
		t.Errorf("Claimed = %q, want threefold", after.Claimed)
	}
	if len(after.Moves) == 0 || after.Moves[len(after.Moves)-1] != "claim" {
		t.Errorf("Moves tail = %v, want claim", after.Moves)
	}
	if len(after.History) == 0 || after.History[len(after.History)-1] != "(=)" {
		t.Errorf("History tail = %v, want (=)", after.History)
	}
	// lastMove unchanged
	if (prevLast == nil) != (after.LastMove == nil) {
		t.Error("LastMove changed on claim")
	} else if prevLast != nil && (after.LastMove.From != prevLast.From || after.LastMove.To != prevLast.To) {
		t.Errorf("LastMove changed on claim: %+v → %+v", prevLast, after.LastMove)
	}

	res := g.Terminal(after)
	if res == nil {
		t.Fatal("Terminal after claim = nil")
	}
	if res.Kind != protocol.ResultDraw || res.Reason != "threefold repetition (claimed)" {
		t.Errorf("Terminal = %+v, want draw 'threefold repetition (claimed)'", res)
	}
}

func TestClaimDrawFifty(t *testing.T) {
	g := newGame()
	stAny, err := g.Deserialize(json.RawMessage(
		`{"fen":"7k/8/8/8/8/8/R7/K7 w - - 100 80","moves":[],"history":[],"keys":["7k/8/8/8/8/8/R7/K7 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	st := stAny.(state)

	err = g.Validate(st, json.RawMessage(`{"claim":"draw"}`), "white")
	if err != nil {
		t.Fatalf("claim at halfmove 100: got %v, want nil", err)
	}

	// Not claimable just under 100.
	underAny, err := g.Deserialize(json.RawMessage(
		`{"fen":"7k/8/8/8/8/8/R7/K7 w - - 99 80","moves":[],"history":[],"keys":["7k/8/8/8/8/8/R7/K7 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize under: %v", err)
	}
	err = g.Validate(underAny, json.RawMessage(`{"claim":"draw"}`), "white")
	if err == nil || err.Error() != "no draw to claim" {
		t.Errorf("claim at halfmove 99: got %v, want 'no draw to claim'", err)
	}

	after := g.Apply(st, json.RawMessage(`{"claim":"draw"}`)).(state)
	if after.Claimed != "fifty" {
		t.Errorf("Claimed = %q, want fifty", after.Claimed)
	}
	res := g.Terminal(after)
	if res == nil {
		t.Fatal("Terminal after fifty claim = nil")
	}
	if res.Kind != protocol.ResultDraw || res.Reason != "fifty-move rule (claimed)" {
		t.Errorf("Terminal = %+v, want draw 'fifty-move rule (claimed)'", res)
	}
}

func TestResign(t *testing.T) {
	g := newGame()

	// White resigns → black wins.
	st := g.Init("").(state)
	err := g.Validate(st, json.RawMessage(`{"resign":true}`), "white")
	if err != nil {
		t.Fatalf("white resign validate: %v", err)
	}
	after := g.Apply(st, json.RawMessage(`{"resign":true}`)).(state)
	if after.Resigned != "white" {
		t.Errorf("Resigned = %q, want white", after.Resigned)
	}
	if len(after.Moves) == 0 || after.Moves[len(after.Moves)-1] != "resign" {
		t.Errorf("Moves tail = %v, want resign", after.Moves)
	}
	if len(after.History) == 0 || after.History[len(after.History)-1] != "resigns" {
		t.Errorf("History tail = %v, want resigns", after.History)
	}
	res := g.Terminal(after)
	if res == nil {
		t.Fatal("Terminal after white resign = nil")
	}
	if res.Kind != protocol.ResultWin || res.Winner != "black" || res.Reason != "resignation" {
		t.Errorf("Terminal = %+v, want win black resignation", res)
	}
	if g.ToMove(after) != "" {
		t.Errorf("ToMove after resign = %q, want empty", g.ToMove(after))
	}

	// Black resigns → white wins.
	st = g.Init("").(state)
	st = g.Apply(st, json.RawMessage(`{"from":"e2","to":"e4"}`)).(state)
	err = g.Validate(st, json.RawMessage(`{"resign":true}`), "black")
	if err != nil {
		t.Fatalf("black resign validate: %v", err)
	}
	after = g.Apply(st, json.RawMessage(`{"resign":true}`)).(state)
	if after.Resigned != "black" {
		t.Errorf("Resigned = %q, want black", after.Resigned)
	}
	// lastMove kept from previous board move.
	if after.LastMove == nil || after.LastMove.From != "e2" || after.LastMove.To != "e4" {
		t.Errorf("LastMove after resign = %+v, want e2e4 kept", after.LastMove)
	}
	res = g.Terminal(after)
	if res == nil {
		t.Fatal("Terminal after black resign = nil")
	}
	if res.Kind != protocol.ResultWin || res.Winner != "white" || res.Reason != "resignation" {
		t.Errorf("Terminal = %+v, want win white resignation", res)
	}
}

func TestFivefoldAutoDraw(t *testing.T) {
	g := newGame()
	// 4 full knight-shuffle cycles → 5 occurrences of the start key.
	// Occurrence 1 = initial; each cycle of 4 moves adds one more.
	st := g.Init("").(state)
	cycle := []string{
		`{"from":"g1","to":"f3"}`, `{"from":"g8","to":"f6"}`,
		`{"from":"f3","to":"g1"}`, `{"from":"f6","to":"g8"}`,
	}
	for i := 0; i < 4; i++ {
		for _, m := range cycle {
			st = g.Apply(st, json.RawMessage(m)).(state)
		}
	}
	if keyCount(st) != 5 {
		t.Fatalf("keyCount = %d, want 5", keyCount(st))
	}
	res := g.Terminal(st)
	if res == nil {
		t.Fatal("Terminal at fivefold = nil")
	}
	if res.Kind != protocol.ResultDraw || res.Reason != "fivefold repetition" {
		t.Errorf("Terminal = %+v, want draw 'fivefold repetition'", res)
	}
}

func TestSeventyFiveMoveAutoDraw(t *testing.T) {
	g := newGame()
	// halfmove 149 → one quiet move → 150 → automatic seventy-five-move draw.
	stAny, err := g.Deserialize(json.RawMessage(
		`{"fen":"7k/8/8/8/8/8/R7/K7 w - - 149 100","moves":[],"history":[],"keys":["7k/8/8/8/8/8/R7/K7 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	if res := g.Terminal(stAny); res != nil {
		t.Errorf("Terminal at halfmove 149 = %+v, want nil", res)
	}
	after := g.Apply(stAny, json.RawMessage(`{"from":"a2","to":"b2"}`)).(state)
	pos, _ := parseFEN(after.FEN)
	if halfmoveClock(pos) != 150 {
		t.Errorf("halfmove = %d, want 150", halfmoveClock(pos))
	}
	res := g.Terminal(after)
	if res == nil {
		t.Fatal("Terminal at halfmove 150 = nil")
	}
	if res.Kind != protocol.ResultDraw || res.Reason != "seventy-five-move rule" {
		t.Errorf("Terminal = %+v, want draw 'seventy-five-move rule'", res)
	}
}

func TestHints(t *testing.T) {
	g := newGame()
	h := g.(spec.Hinter)

	// No hints at start.
	st := g.Init("").(state)
	if hints := h.Hints(st); hints != nil {
		t.Errorf("Hints at start = %v, want nil", hints)
	}

	// count == 2 after one full knight cycle back to start.
	st = g.Init("").(state)
	for _, m := range []string{
		`{"from":"g1","to":"f3"}`, `{"from":"g8","to":"f6"}`,
		`{"from":"f3","to":"g1"}`, `{"from":"f6","to":"g8"}`,
	} {
		st = g.Apply(st, json.RawMessage(m)).(state)
	}
	if keyCount(st) != 2 {
		t.Fatalf("keyCount = %d, want 2", keyCount(st))
	}
	hints := h.Hints(st)
	if len(hints) != 1 {
		t.Fatalf("Hints at count==2: got %v, want 1 hint", hints)
	}
	want2 := "this position has occurred twice — repeating it again allows a draw claim; vary your play if you want to win"
	if hints[0] != want2 {
		t.Errorf("Hints[0] = %q, want %q", hints[0], want2)
	}

	// count >= 3
	for _, m := range []string{
		`{"from":"g1","to":"f3"}`, `{"from":"g8","to":"f6"}`,
		`{"from":"f3","to":"g1"}`, `{"from":"f6","to":"g8"}`,
	} {
		st = g.Apply(st, json.RawMessage(m)).(state)
	}
	if keyCount(st) != 3 {
		t.Fatalf("keyCount = %d, want 3", keyCount(st))
	}
	hints = h.Hints(st)
	if len(hints) != 1 {
		t.Fatalf("Hints at count>=3: got %v, want 1 hint", hints)
	}
	want3 := `position repeated 3+ times — {"claim":"draw"} is now a legal move; at 5 repetitions the game auto-draws (FIDE)`
	if hints[0] != want3 {
		t.Errorf("Hints[0] = %q, want %q", hints[0], want3)
	}

	// halfmove >= 80 && < 100
	hm80Any, err := g.Deserialize(json.RawMessage(
		`{"fen":"7k/8/8/8/8/8/R7/K7 w - - 80 50","moves":[],"history":[],"keys":["7k/8/8/8/8/8/R7/K7 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize hm80: %v", err)
	}
	hints = h.Hints(hm80Any)
	if len(hints) != 1 {
		t.Fatalf("Hints at halfmove 80: got %v, want 1 hint", hints)
	}
	want80 := "40 of 50 moves without a pawn move or capture — make progress or the fifty-move claim becomes available"
	if hints[0] != want80 {
		t.Errorf("Hints[0] = %q, want %q", hints[0], want80)
	}

	// halfmove >= 100
	hm100Any, err := g.Deserialize(json.RawMessage(
		`{"fen":"7k/8/8/8/8/8/R7/K7 w - - 100 60","moves":[],"history":[],"keys":["7k/8/8/8/8/8/R7/K7 w - -"],"lastMove":null}`,
	))
	if err != nil {
		t.Fatalf("deserialize hm100: %v", err)
	}
	hints = h.Hints(hm100Any)
	if len(hints) != 1 {
		t.Fatalf("Hints at halfmove 100: got %v, want 1 hint", hints)
	}
	want100 := `fifty-move claim available ({"claim":"draw"}); at 75 moves without progress the game auto-draws (FIDE)`
	if hints[0] != want100 {
		t.Errorf("Hints[0] = %q, want %q", hints[0], want100)
	}
}

func TestSerializeDeserialize(t *testing.T) {
	g := newGame()

	initSt := g.Init("").(state)
	ser := g.Serialize(initSt)
	deser, err := g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize init: %v", err)
	}
	ser2 := g.Serialize(deser)
	if string(ser2) != string(ser) {
		t.Errorf("init round-trip mismatch:\n  ser1: %s\n  ser2: %s", ser, ser2)
	}
	var check struct {
		Moves    []interface{} `json:"moves"`
		History  []interface{} `json:"history"`
		Keys     []interface{} `json:"keys"`
		LastMove interface{}   `json:"lastMove"`
		Claimed  string        `json:"claimed"`
		Resigned string        `json:"resigned"`
	}
	json.Unmarshal(ser, &check)
	if check.Moves == nil {
		t.Error("init serialize: moves is null, want []")
	}
	if check.History == nil {
		t.Error("init serialize: history is null, want []")
	}
	if check.LastMove != nil {
		t.Error("init serialize: lastMove is not null")
	}
	if check.Claimed != "" {
		t.Errorf("init serialize: claimed = %q, want empty", check.Claimed)
	}
	if check.Resigned != "" {
		t.Errorf("init serialize: resigned = %q, want empty", check.Resigned)
	}

	midSt := g.Init("").(state)
	midSt = g.Apply(midSt, json.RawMessage(`{"from":"e2","to":"e4"}`)).(state)
	midSt = g.Apply(midSt, json.RawMessage(`{"from":"e7","to":"e5"}`)).(state)
	ser = g.Serialize(midSt)
	deser, err = g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize mid-game: %v", err)
	}
	ser2 = g.Serialize(deser)
	if string(ser2) != string(ser) {
		t.Errorf("mid-game round-trip mismatch:\n  ser1: %s\n  ser2: %s", ser, ser2)
	}

	// Claimed / resigned round-trip.
	claimed := g.Init("").(state)
	for _, m := range []string{
		`{"from":"g1","to":"f3"}`, `{"from":"g8","to":"f6"}`,
		`{"from":"f3","to":"g1"}`, `{"from":"f6","to":"g8"}`,
		`{"from":"g1","to":"f3"}`, `{"from":"g8","to":"f6"}`,
		`{"from":"f3","to":"g1"}`, `{"from":"f6","to":"g8"}`,
	} {
		claimed = g.Apply(claimed, json.RawMessage(m)).(state)
	}
	claimed = g.Apply(claimed, json.RawMessage(`{"claim":"draw"}`)).(state)
	ser = g.Serialize(claimed)
	deser, err = g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize claimed: %v", err)
	}
	if deser.(state).Claimed != "threefold" {
		t.Errorf("claimed round-trip = %q, want threefold", deser.(state).Claimed)
	}
	ser2 = g.Serialize(deser)
	if string(ser2) != string(ser) {
		t.Errorf("claimed round-trip mismatch:\n  ser1: %s\n  ser2: %s", ser, ser2)
	}

	resigned := g.Init("").(state)
	resigned = g.Apply(resigned, json.RawMessage(`{"resign":true}`)).(state)
	ser = g.Serialize(resigned)
	deser, err = g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize resigned: %v", err)
	}
	if deser.(state).Resigned != "white" {
		t.Errorf("resigned round-trip = %q, want white", deser.(state).Resigned)
	}

	foolsMate := g.Init("").(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"f2","to":"f3"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"e7","to":"e5"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"g2","to":"g4"}`)).(state)
	foolsMate = g.Apply(foolsMate, json.RawMessage(`{"from":"d8","to":"h4"}`)).(state)
	ser = g.Serialize(foolsMate)
	deser, err = g.Deserialize(ser)
	if err != nil {
		t.Fatalf("deserialize terminal: %v", err)
	}
	ser2 = g.Serialize(deser)
	if string(ser2) != string(ser) {
		t.Errorf("terminal round-trip mismatch:\n  ser1: %s\n  ser2: %s", ser, ser2)
	}
}

func TestDeserializeOldPayload(t *testing.T) {
	g := newGame()
	// Old payloads without claimed/resigned keys must default to "".
	old := json.RawMessage(
		`{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","moves":[],"history":[],"keys":["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"],"lastMove":null}`,
	)
	st, err := g.Deserialize(old)
	if err != nil {
		t.Fatalf("deserialize old payload: %v", err)
	}
	s := st.(state)
	if s.Claimed != "" {
		t.Errorf("Claimed = %q, want empty default", s.Claimed)
	}
	if s.Resigned != "" {
		t.Errorf("Resigned = %q, want empty default", s.Resigned)
	}
}

func TestDeserializeErrors(t *testing.T) {
	g := newGame()

	_, err := g.Deserialize(json.RawMessage(`[1,2,3]`))
	if err == nil {
		t.Error("deserialize array: expected error")
	}

	_, err = g.Deserialize(json.RawMessage(`{"moves":[],"history":[],"keys":["x"]}`))
	if err == nil {
		t.Error("deserialize missing fen: expected error")
	}

	_, err = g.Deserialize(json.RawMessage(
		`{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","moves":[],"history":[],"keys":["x","y"],"lastMove":null}`,
	))
	if err == nil || err.Error() != "keys length mismatch" {
		t.Errorf("keys mismatch: got %v, want 'keys length mismatch'", err)
	}

	_, err = g.Deserialize(json.RawMessage(
		`{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","moves":[],"history":[],"keys":["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"],"lastMove":{"from":123,"to":"e4"}}`,
	))
	if err == nil {
		t.Error("deserialize bad lastMove type: expected error")
	}

	_, err = g.Deserialize(json.RawMessage(
		`{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","moves":[],"history":[],"keys":["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"],"lastMove":{"from":"e2"}}`,
	))
	if err == nil {
		t.Error("deserialize lastMove missing 'to': expected error")
	}
}

func TestRegisterAndRegistry(t *testing.T) {
	r, ok := spec.Get("chess")
	if !ok {
		t.Fatal("chess not registered")
	}
	if r.Meta().ID != "chess" {
		t.Error("meta id mismatch")
	}
	// Chess implements Hinter.
	if _, ok := r.(spec.Hinter); !ok {
		t.Error("chess rules do not implement spec.Hinter")
	}
	all := spec.All()
	found := false
	for _, x := range all {
		if x.Meta().ID == "chess" {
			found = true
			break
		}
	}
	if !found {
		t.Error("All() did not include chess")
	}
}
