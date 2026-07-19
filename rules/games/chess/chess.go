package chess

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
)

var squareRE = regexp.MustCompile(`^[a-h][1-8]$`)

type lastMove struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type state struct {
	FEN      string
	Moves    []string
	History  []string
	Keys     []string
	LastMove *lastMove
	// Claimed is "" | "threefold" | "fifty" after a successful draw claim.
	Claimed string
	// Resigned is "" | "white" | "black" after a resignation.
	Resigned string
}

// chessMoveWire is the wire form of a chess move.
// Board moves use from/to (+ optional promotion).
// Special moves (tail of LegalMoves): {"claim":"draw"} and {"resign":true}.
// Mixing special fields with from/to is malformed.
type chessMoveWire struct {
	From      string  `json:"from"`
	To        string  `json:"to"`
	Promotion *string `json:"promotion"`
	Claim     string  `json:"claim"`
	Resign    *bool   `json:"resign"`
}

type chessRules struct{}

func New() spec.Rules {
	return chessRules{}
}

func (chessRules) Meta() spec.GameMeta {
	return spec.GameMeta{
		ID:         "chess",
		Name:       "Chess",
		MinPlayers: 2,
		MaxPlayers: 2,
		Seats:      []string{"white", "black"},
	}
}

func (chessRules) Init(seed string) any {
	pos, _ := parseFEN(startFEN)
	return state{
		FEN:      startFEN,
		Moves:    make([]string, 0),
		History:  make([]string, 0),
		Keys:     []string{positionKey(pos)},
		LastMove: nil,
		Claimed:  "",
		Resigned: "",
	}
}

func (c chessRules) ToMove(s any) string {
	st := s.(state)
	if c.Terminal(st) != nil {
		return ""
	}
	pos, _ := parseFEN(st.FEN)
	return turnOf(pos)
}

// keyCount returns how many times the current position key appears in Keys.
func keyCount(st state) int {
	if len(st.Keys) == 0 {
		return 0
	}
	lastKey := st.Keys[len(st.Keys)-1]
	count := 0
	for _, k := range st.Keys {
		if k == lastKey {
			count++
		}
	}
	return count
}

// claimable is true when threefold (key count >= 3) or fifty-move (halfmove >= 100).
func claimable(st state, pos position) bool {
	return keyCount(st) >= 3 || halfmoveClock(pos) >= 100
}

func isClaimMove(mv chessMoveWire) bool {
	return mv.Claim != ""
}

func isResignMove(mv chessMoveWire) bool {
	return mv.Resign != nil && *mv.Resign
}

func hasBoardFields(mv chessMoveWire) bool {
	return mv.From != "" || mv.To != "" || mv.Promotion != nil
}

func (c chessRules) Validate(s any, moveRaw json.RawMessage, seat string) error {
	st := s.(state)
	if c.Terminal(st) != nil {
		return errors.New("game over")
	}

	pos, err := parseFEN(st.FEN)
	if err != nil {
		return err
	}

	if seat != turnOf(pos) {
		return errors.New("not your turn")
	}

	var mv chessMoveWire
	if err := json.Unmarshal(moveRaw, &mv); err != nil {
		return errors.New("malformed move")
	}

	// Special moves: claim / resign (must not mix with board fields).
	if isClaimMove(mv) || isResignMove(mv) || mv.Resign != nil {
		if isClaimMove(mv) && isResignMove(mv) {
			return errors.New("malformed move")
		}
		if hasBoardFields(mv) {
			return errors.New("malformed move")
		}
		// resign:false alone, or claim with resign:false, etc.
		if mv.Resign != nil && !*mv.Resign {
			return errors.New("malformed move")
		}
		if isClaimMove(mv) {
			if mv.Claim != "draw" {
				return errors.New("malformed move")
			}
			if !claimable(st, pos) {
				return errors.New("no draw to claim")
			}
			return nil
		}
		// pure resign:true
		return nil
	}

	if !squareRE.MatchString(mv.From) || !squareRE.MatchString(mv.To) {
		return errors.New("malformed move")
	}

	hasPromo := mv.Promotion != nil
	promoStr := ""
	if hasPromo {
		promoStr = *mv.Promotion
		if promoStr != "q" && promoStr != "r" && promoStr != "b" && promoStr != "n" {
			return errors.New("malformed move")
		}
	}

	legals := legalMovesPos(pos)

	if !hasPromo {
		for _, m := range legals {
			if m.From == mv.From && m.To == mv.To && m.Promotion != "" {
				return errors.New("promotion required")
			}
		}
	}

	for _, m := range legals {
		if m.From == mv.From && m.To == mv.To && m.Promotion == promoStr {
			return nil
		}
	}

	return errors.New("illegal move")
}

func (c chessRules) Apply(s any, moveRaw json.RawMessage) any {
	st := s.(state)

	var mv chessMoveWire
	_ = json.Unmarshal(moveRaw, &mv)

	pos, _ := parseFEN(st.FEN)

	// Draw claim — position unchanged; append history markers.
	if isClaimMove(mv) {
		claimed := "fifty"
		if keyCount(st) >= 3 {
			claimed = "threefold"
		}
		newMoves := make([]string, len(st.Moves), len(st.Moves)+1)
		copy(newMoves, st.Moves)
		newMoves = append(newMoves, "claim")

		newHistory := make([]string, len(st.History), len(st.History)+1)
		copy(newHistory, st.History)
		newHistory = append(newHistory, "(=)")

		// Position unchanged; keep keys length invariant (len(keys)==len(moves)+1).
		newKeys := make([]string, len(st.Keys), len(st.Keys)+1)
		copy(newKeys, st.Keys)
		newKeys = append(newKeys, positionKey(pos))

		return state{
			FEN:      st.FEN,
			Moves:    newMoves,
			History:  newHistory,
			Keys:     newKeys,
			LastMove: st.LastMove, // keep previous lastMove
			Claimed:  claimed,
			Resigned: st.Resigned,
		}
	}

	// Resignation — position unchanged; win for opponent via Terminal.
	if isResignMove(mv) {
		resigner := turnOf(pos)
		newMoves := make([]string, len(st.Moves), len(st.Moves)+1)
		copy(newMoves, st.Moves)
		newMoves = append(newMoves, "resign")

		newHistory := make([]string, len(st.History), len(st.History)+1)
		copy(newHistory, st.History)
		newHistory = append(newHistory, "resigns")

		newKeys := make([]string, len(st.Keys), len(st.Keys)+1)
		copy(newKeys, st.Keys)
		newKeys = append(newKeys, positionKey(pos))

		return state{
			FEN:      st.FEN,
			Moves:    newMoves,
			History:  newHistory,
			Keys:     newKeys,
			LastMove: st.LastMove, // keep previous lastMove
			Claimed:  st.Claimed,
			Resigned: resigner,
		}
	}

	promo := ""
	if mv.Promotion != nil {
		promo = *mv.Promotion
	}

	em := engineMove{From: mv.From, To: mv.To, Promotion: promo}
	san := moveToSAN(pos, em)

	newPos, _ := makeMove(pos, em)
	newFEN := toFEN(newPos)
	uci := moveToUCI(em)

	newMoves := make([]string, len(st.Moves), len(st.Moves)+1)
	copy(newMoves, st.Moves)
	newMoves = append(newMoves, uci)

	newHistory := make([]string, len(st.History), len(st.History)+1)
	copy(newHistory, st.History)
	newHistory = append(newHistory, san)

	newKeys := make([]string, len(st.Keys), len(st.Keys)+1)
	copy(newKeys, st.Keys)
	newKeys = append(newKeys, positionKey(newPos))

	return state{
		FEN:      newFEN,
		Moves:    newMoves,
		History:  newHistory,
		Keys:     newKeys,
		LastMove: &lastMove{From: mv.From, To: mv.To},
		Claimed:  st.Claimed,
		Resigned: st.Resigned,
	}
}

func (c chessRules) LegalMoves(s any) []json.RawMessage {
	st := s.(state)
	if c.Terminal(st) != nil {
		return []json.RawMessage{}
	}

	pos, _ := parseFEN(st.FEN)
	legals := legalMovesPos(pos)

	// Board moves first; claim/resign are special tail entries so agents
	// that pick moves[0] or a random index are not biased into resigning.
	out := make([]json.RawMessage, 0, len(legals)+2)
	for _, m := range legals {
		wire := map[string]string{
			"from": m.From,
			"to":   m.To,
		}
		if m.Promotion != "" {
			wire["promotion"] = m.Promotion
		}
		b, _ := json.Marshal(wire)
		out = append(out, b)
	}

	if claimable(st, pos) {
		b, _ := json.Marshal(map[string]string{"claim": "draw"})
		out = append(out, b)
	}
	// Always append resign while non-terminal (at the tail).
	b, _ := json.Marshal(map[string]bool{"resign": true})
	out = append(out, b)

	return out
}

func (c chessRules) Terminal(s any) *protocol.GameResult {
	st := s.(state)

	// Claimed / Resigned markers checked first (claim/resign Apply sets them).
	if st.Claimed == "threefold" {
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "threefold repetition (claimed)",
		}
	}
	if st.Claimed == "fifty" {
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "fifty-move rule (claimed)",
		}
	}
	if st.Resigned == "white" {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: "black",
			Reason: "resignation",
		}
	}
	if st.Resigned == "black" {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: "white",
			Reason: "resignation",
		}
	}

	pos, err := parseFEN(st.FEN)
	if err != nil {
		return nil
	}

	currentTurn := turnOf(pos)
	winner := "black"
	if currentTurn == "black" {
		winner = "white"
	}

	// Precedence: checkmate, stalemate, insufficient material, seventy-five-move, fivefold.
	if isCheckmate(pos) {
		return &protocol.GameResult{
			Kind:   protocol.ResultWin,
			Winner: winner,
			Reason: "checkmate",
		}
	}
	if isStalemate(pos) {
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "stalemate",
		}
	}
	if insufficientMaterial(pos) {
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "insufficient material",
		}
	}
	// FIDE 9.6: automatic draws only at 75 moves / fivefold.
	if halfmoveClock(pos) >= 150 {
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "seventy-five-move rule",
		}
	}
	if keyCount(st) >= 5 {
		return &protocol.GameResult{
			Kind:   protocol.ResultDraw,
			Reason: "fivefold repetition",
		}
	}

	return nil
}

// Hints implements spec.Hinter. Advisory text for the side to move only.
func (c chessRules) Hints(s any) []string {
	st := s.(state)
	if c.Terminal(st) != nil {
		return nil
	}
	pos, err := parseFEN(st.FEN)
	if err != nil {
		return nil
	}

	var hints []string
	count := keyCount(st)
	if count == 2 {
		hints = append(hints, "this position has occurred twice — repeating it again allows a draw claim; vary your play if you want to win")
	}
	if count >= 3 {
		hints = append(hints, `position repeated 3+ times — {"claim":"draw"} is now a legal move; at 5 repetitions the game auto-draws (FIDE)`)
	}
	hm := halfmoveClock(pos)
	if hm >= 80 && hm < 100 {
		n := hm / 2 // half-moves → full moves without progress
		hints = append(hints, fmt.Sprintf("%d of 50 moves without a pawn move or capture — make progress or the fifty-move claim becomes available", n))
	}
	if hm >= 100 {
		hints = append(hints, `fifty-move claim available ({"claim":"draw"}); at 75 moves without progress the game auto-draws (FIDE)`)
	}
	if len(hints) == 0 {
		return nil
	}
	return hints
}

func (chessRules) Serialize(s any) json.RawMessage {
	st := s.(state)

	moves := st.Moves
	if moves == nil {
		moves = make([]string, 0)
	}
	history := st.History
	if history == nil {
		history = make([]string, 0)
	}
	keys := st.Keys
	if keys == nil {
		keys = make([]string, 0)
	}

	var lm interface{}
	if st.LastMove != nil {
		lm = map[string]string{
			"from": st.LastMove.From,
			"to":   st.LastMove.To,
		}
	}

	data, _ := json.Marshal(struct {
		FEN      string      `json:"fen"`
		Moves    []string    `json:"moves"`
		History  []string    `json:"history"`
		Keys     []string    `json:"keys"`
		LastMove interface{} `json:"lastMove"`
		Claimed  string      `json:"claimed"`
		Resigned string      `json:"resigned"`
	}{
		FEN:      st.FEN,
		Moves:    moves,
		History:  history,
		Keys:     keys,
		LastMove: lm,
		Claimed:  st.Claimed,
		Resigned: st.Resigned,
	})
	return data
}

func (chessRules) Deserialize(data json.RawMessage) (any, error) {
	if len(data) == 0 {
		return nil, errors.New("empty state data")
	}

	// claimed/resigned optional for backward compatibility with older payloads.
	var raw struct {
		FEN      string          `json:"fen"`
		Moves    []string        `json:"moves"`
		History  []string        `json:"history"`
		Keys     []string        `json:"keys"`
		LastMove json.RawMessage `json:"lastMove"`
		Claimed  string          `json:"claimed"`
		Resigned string          `json:"resigned"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	if raw.FEN == "" {
		return nil, errors.New("missing fen")
	}

	if _, err := parseFEN(raw.FEN); err != nil {
		return nil, err
	}

	if len(raw.Keys) != len(raw.Moves)+1 {
		return nil, errors.New("keys length mismatch")
	}

	var lm *lastMove
	if len(raw.LastMove) > 0 && string(raw.LastMove) != "null" {
		var lmParsed struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		if err := json.Unmarshal(raw.LastMove, &lmParsed); err != nil {
			return nil, errors.New("invalid lastMove")
		}
		if lmParsed.From == "" || lmParsed.To == "" {
			return nil, errors.New("invalid lastMove")
		}
		lm = &lastMove{From: lmParsed.From, To: lmParsed.To}
	}

	return state{
		FEN:      raw.FEN,
		Moves:    append([]string{}, raw.Moves...),
		History:  append([]string{}, raw.History...),
		Keys:     append([]string{}, raw.Keys...),
		LastMove: lm,
		Claimed:  raw.Claimed,  // default "" when key absent
		Resigned: raw.Resigned, // default "" when key absent
	}, nil
}

func init() {
	spec.Register(New())
}
