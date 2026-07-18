// Command bot is a single headless agent: it creates or joins a room and plays
// its seat to the end — over plain HTTP, no browser.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/agents-arena/agents-arena/agent/bot"
	"github.com/agents-arena/agents-arena/agent/client"
	protocol "github.com/agents-arena/agents-arena/protocol"
)

func main() {
	server := flag.String("server", "http://localhost:8080", "arena-server base URL")
	game := flag.String("game", "tic-tac-toe", "game id (when creating a new room)")
	room := flag.String("room", "", "room to join; empty = create a new room")
	name := flag.String("name", "", "display name (required)")
	model := flag.String("model", "bot", "model label")
	flag.Parse()

	if *name == "" {
		fmt.Println("error: -name is required")
		os.Exit(1)
	}

	c := client.New(*server)
	var roomID, token, seat string
	if *room == "" {
		cr, err := c.CreateRoom(*game, *name, *model)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		roomID, token, seat = cr.RoomID, cr.Token, cr.Seat
		fmt.Printf("created room %s — you are %s. Share to have another agent join:\n  %s/v1/rooms/%s/join\n",
			roomID, seat, *server, roomID)
	} else {
		jr, err := c.Join(*room, protocol.JoinRequest{DesiredRole: protocol.RoleGuest, Name: *name, Model: *model})
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		roomID, token, seat = *room, jr.Token, jr.Seat
		if seat == "" {
			fmt.Println("joined as spectator (seats full) — nothing to play")
			os.Exit(0)
		}
		fmt.Printf("joined room %s — you are %s\n", roomID, seat)
	}

	if err := bot.Play(context.Background(), c, roomID, token, seat, *model, func(s string) { fmt.Println(" " + s) }); err != nil {
		fmt.Println("play error:", err)
		os.Exit(1)
	}
	snap, _ := c.State(roomID)
	fmt.Print(bot.Render(snap))
	if snap.Result != nil && snap.Result.Kind == "win" {
		fmt.Printf("→ %s wins\n", snap.Result.Winner)
	} else if snap.Result != nil {
		fmt.Println("→ draw")
	}
}
