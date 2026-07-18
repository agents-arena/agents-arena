// Command match runs a full agent-vs-agent game (both seats) against a running
// arena-server, entirely over HTTP — a browserless smoke/demo.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/agents-arena/agents-arena/agent/bot"
	"github.com/agents-arena/agents-arena/agent/client"
	protocol "github.com/agents-arena/agents-arena/protocol"
)

func main() {
	server := flag.String("server", "http://localhost:8080", "arena-server base URL")
	game := flag.String("game", "tic-tac-toe", "game id")
	xName := flag.String("x-name", "Bot A", "display name for the first seat")
	oName := flag.String("o-name", "Bot B", "display name for the second seat")
	xModel := flag.String("x-model", "bot-x", "model label for the first seat")
	oModel := flag.String("o-model", "bot-o", "model label for the second seat")
	games := flag.Int("games", 1, "number of games")
	flag.Parse()

	c := client.New(*server)
	for g := 1; g <= *games; g++ {
		if err := playGame(c, g, *game, *xName, *oName, *xModel, *oModel); err != nil {
			fmt.Println("game error:", err)
			os.Exit(1)
		}
	}
}

func playGame(c *client.Client, g int, game, aName, bName, aModel, bModel string) error {
	cr, err := c.CreateRoom(game, aName, aModel)
	if err != nil {
		return err
	}
	jr, err := c.Join(cr.RoomID, protocol.JoinRequest{DesiredRole: protocol.RoleGuest, Name: bName, Model: bModel})
	if err != nil {
		return err
	}
	seatA, seatB := cr.Seat, jr.Seat
	fmt.Printf("\n━━━ Game %d · room %s · %s=%s %s=%s ━━━\n", g, cr.RoomID, seatA, aModel, seatB, bModel)

	var mu sync.Mutex
	logf := func(s string) { mu.Lock(); fmt.Println("  " + s); mu.Unlock() }

	// Random-legal chess between two bots can run many hundreds of plies before
	// the auto-draw rules end it; give long games room while keeping tic-tac-toe
	// smokes snappy.
	budget := 30 * time.Second
	if game != "tic-tac-toe" {
		budget = 20 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()

	holdPresence := func(token string) {
		if ch, err := c.Events(ctx, cr.RoomID, token); err == nil {
			go func() {
				for range ch {
				}
			}()
		}
	}
	holdPresence(cr.Token)
	holdPresence(jr.Token)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _ = bot.Play(ctx, c, cr.RoomID, cr.Token, seatA, aModel, logf) }()
	go func() { defer wg.Done(); _ = bot.Play(ctx, c, cr.RoomID, jr.Token, seatB, bModel, logf) }()
	wg.Wait()

	snap, _ := c.State(cr.RoomID)
	fmt.Print("\n" + bot.Render(snap))
	if snap.Result == nil {
		return fmt.Errorf("game did not finish")
	}
	if snap.Result.Kind == "draw" {
		fmt.Println("  → draw")
	} else {
		fmt.Printf("  → %s wins\n", snap.Result.Winner)
	}

	rep, err := c.Report(cr.RoomID)
	if err == nil {
		fmt.Printf("  report: %d moves · %dms · both sides get this identical record\n", len(rep.Moves), rep.DurationMs)
		for _, p := range rep.Players {
			fmt.Printf("    %s %s: %d moves · avg think %dms · rejected %d\n", p.Seat, p.Model, p.Moves, p.AvgThinkMs, p.Rejected)
		}
	}
	return nil
}
