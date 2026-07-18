package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/server/internal/room"
)

// eventsHandler implements GET /v1/rooms/{id}/events SSE.
// Immediately emits current snapshot as first event, then replays buffered
// comments (in order), then streams hub events.
// Heartbeat comments every ~20s. Ends on client disconnect.
//
// /events?token=… marks presence only for player tokens; a spectator stream
// without a token gets no write powers.
func eventsHandler(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}

		// SSE headers
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		// Allow CORS for EventSource too
		w.Header().Set("Access-Control-Allow-Origin", "*")

		flusher, canFlush := w.(http.Flusher)
		if !canFlush {
			writeError(w, http.StatusInternalServerError, "streaming unsupported")
			return
		}

		// If the stream carries a seat token, it counts as that agent's live
		// presence: the seat shows "connected" while this stream is open and
		// "lost" when it closes. Spectator streams (no token) don't affect it.
		// Commenter tokens resolve to no seat and do not affect presence.
		if tok, _ := TokenFromRequest(r); tok != "" {
			if seat := rm.PresenceUp(tok); seat != "" {
				defer rm.PresenceDown(seat)
			}
		}

		// 1) send initial snapshot immediately
		snap := rm.Snapshot()
		writeSSE(w, flusher, "snapshot", protocol.Event{Type: "snapshot", Snapshot: &snap})

		// 2) replay buffered comments AFTER the initial snapshot (contract)
		for _, c := range rm.Comments() {
			cc := c
			writeSSE(w, flusher, "comment", protocol.Event{Type: "comment", Comment: &cc})
		}

		// 3) subscribe to live events
		evCh, cancel := rm.Subscribe()
		defer cancel()

		// heartbeat ticker
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		ctx := r.Context()

		for {
			select {
			case <-ctx.Done():
				// client gone
				return
			case ev, ok := <-evCh:
				if !ok {
					return
				}
				// Always emit the full protocol.Event as the data payload so every
				// SSE message has the same shape: {type, snapshot|emote|report|comment|joinRequest}.
				writeSSE(w, flusher, ev.Type, ev)
			case <-ticker.C:
				// heartbeat comment (no data, keeps connection alive through proxies)
				fmt.Fprintf(w, ": heartbeat\n\n")
				flusher.Flush()
			}
		}
	}
}

// writeSSE writes a "event: <name>\ndata: <json>\n\n" or just data if name==""
func writeSSE(w http.ResponseWriter, flusher http.Flusher, eventName string, payload any) {
	if eventName != "" {
		fmt.Fprintf(w, "event: %s\n", eventName)
	}
	data, err := json.Marshal(payload)
	if err != nil {
		// best effort
		data = []byte("null")
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}
