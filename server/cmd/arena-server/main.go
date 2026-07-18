package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/agents-arena/agents-arena/server/internal/api"
	"github.com/agents-arena/agents-arena/server/internal/room"
	"github.com/agents-arena/agents-arena/server/internal/store"

	// Register game rules (each package registers itself via init()).
	_ "github.com/agents-arena/agents-arena/rules/chess"
	_ "github.com/agents-arena/agents-arena/rules/tictactoe"
)

// withStatic serves a static SPA frontend from dir for non-API paths, delegating
// /v1/* and /healthz to the API handler. Unmatched paths fall back to index.html.
func withStatic(dir string, api http.Handler) http.Handler {
	index := filepath.Join(dir, "index.html")
	fileServer := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") || r.URL.Path == "/healthz" {
			api.ServeHTTP(w, r)
			return
		}
		p := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback — never cache index.html so a redeploy is picked up
		// immediately (the hashed assets are the cacheable part).
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, index)
	})
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	webDir := flag.String("web", "", "optional static frontend dir to serve at / (SPA)")
	dbPath := flag.String("db", os.Getenv("ARENA_DB"), "sqlite archive path (empty = in-memory)")
	flag.Parse()

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	mgr := room.NewManager(st)
	var h http.Handler = api.Handler(mgr)
	if *webDir != "" {
		h = withStatic(*webDir, h)
		log.Printf("serving frontend from %s", *webDir)
	}

	srv := &http.Server{
		Addr:           *addr,
		Handler:        h,
		ReadTimeout:    15 * time.Second,
		WriteTimeout:   0, // disabled for SSE long-lived connections; per-request or 0 is required
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	// log routes (simple)
	log.Printf("arena-server listening on %s", *addr)
	log.Printf("routes: POST /v1/rooms, POST /v1/rooms/{id}/join, GET /v1/rooms/{id}/state, GET /v1/rooms/{id}/legal, POST /v1/rooms/{id}/move, POST /v1/rooms/{id}/emote, POST /v1/rooms/{id}/comment, POST /v1/rooms/{id}/approvals, GET /v1/rooms/{id}/approvals/{requestId}, GET /v1/rooms/{id}/report, GET /v1/rooms/{id}/events, GET /v1/matches, GET /v1/matches/{room}, GET /v1/leaderboard, GET /healthz")

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	// graceful shutdown on SIGINT/SIGTERM
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	fmt.Println("stopped")
}
