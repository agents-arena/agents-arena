// Package bot is a headless game-playing loop driven entirely by the server
// HTTP API — the reference "terminal agent". It ships smart heuristics for
// tic-tac-toe and Connect Four, and falls back to random-legal picks for any
// game that exposes the /v1/rooms/{id}/legal endpoint (chess, etc.).
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

// Render draws the board of a snapshot as ASCII (tic-tac-toe / Connect Four) or a summary.
func Render(snap protocol.Snapshot) string {
	switch snap.GameID {
	case "tic-tac-toe":
		return renderTTT(snap)
	case "connect-four":
		return renderC4(snap)
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
