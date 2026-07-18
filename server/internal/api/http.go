package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/server/internal/room"
	"github.com/agents-arena/agents-arena/server/internal/store"
)

const (
	maxBody      = 1 << 20 // 1 MiB (reads / large payloads)
	maxWriteBody = 4 << 10 // 4 KiB on write endpoints (move/comment/emote/approvals)
)

// Handler returns the root HTTP handler for the arena server API.
func Handler(mgr *room.Manager) http.Handler {
	mux := http.NewServeMux()

	// CORS for browser clients (permissive as specified)
	cors := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next(w, r)
		}
	}

	// POST /v1/rooms
	mux.HandleFunc("POST /v1/rooms", cors(createRoom(mgr)))

	// POST /v1/rooms/{id}/join
	mux.HandleFunc("POST /v1/rooms/{id}/join", cors(joinRoom(mgr)))

	// GET /v1/rooms/{id}/state
	mux.HandleFunc("GET /v1/rooms/{id}/state", cors(getState(mgr)))

	// GET /v1/rooms/{id}/legal
	mux.HandleFunc("GET /v1/rooms/{id}/legal", cors(getLegal(mgr)))

	// POST /v1/rooms/{id}/move
	mux.HandleFunc("POST /v1/rooms/{id}/move", cors(postMove(mgr)))

	// POST /v1/rooms/{id}/emote
	mux.HandleFunc("POST /v1/rooms/{id}/emote", cors(postEmote(mgr)))

	// POST /v1/rooms/{id}/comment
	mux.HandleFunc("POST /v1/rooms/{id}/comment", cors(postComment(mgr)))

	// POST /v1/rooms/{id}/approvals
	mux.HandleFunc("POST /v1/rooms/{id}/approvals", cors(postApproval(mgr)))

	// GET /v1/rooms/{id}/approvals/{requestId}
	mux.HandleFunc("GET /v1/rooms/{id}/approvals/{requestId}", cors(getApproval(mgr)))

	// GET /v1/rooms/{id}/report
	mux.HandleFunc("GET /v1/rooms/{id}/report", cors(getReport(mgr)))

	// GET /v1/rooms/{id}/events  (SSE)
	mux.HandleFunc("GET /v1/rooms/{id}/events", cors(eventsHandler(mgr)))

	// GET /v1/matches
	mux.HandleFunc("GET /v1/matches", cors(listMatches(mgr)))

	// GET /v1/matches/{room}
	mux.HandleFunc("GET /v1/matches/{room}", cors(getMatch(mgr)))

	// GET /v1/leaderboard
	mux.HandleFunc("GET /v1/leaderboard", cors(getLeaderboard(mgr)))

	// health
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	return mux
}

func decodeJSON[T any](r *http.Request, dst *T) error {
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, maxBody)
	dec := json.NewDecoder(limited)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// decodeWriteJSON decodes a write-endpoint body with a tight MaxBytesReader cap.
func decodeWriteJSON[T any](w http.ResponseWriter, r *http.Request, dst *T) error {
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, maxWriteBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func createRoom(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req protocol.CreateRoomRequest
		if err := decodeJSON(r, &req); err != nil || req.Game == "" {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		// Names required when the creator takes a seat (spectate=false).
		name := req.Name
		if !req.Spectate {
			n, err := room.NormalizeName(name)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			name = n
		} else if name != "" {
			// optional name for spectate creator — normalize if provided
			if n, err := room.NormalizeName(name); err == nil {
				name = n
			} else {
				name = ""
			}
		}
		reasoning := protocol.NormalizeReasoning(req.Reasoning)
		rm, hostToken, err := mgr.Create(req.Game, name, req.Model, req.Spectate, reasoning)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		snap := rm.Snapshot()
		// A spectator-created room is seatless: the creator holds no seat, so both
		// stay open for agents. Otherwise the creator holds the first seat.
		role := protocol.RoleHost
		seat := ""
		if req.Spectate {
			role = protocol.RoleSpectator
		} else if len(snap.Players) > 0 {
			seat = snap.Players[0].Seat
		}
		resp := protocol.CreateRoomResponse{
			RoomID:   rm.ID(),
			Token:    hostToken,
			Role:     role,
			Seat:     seat,
			Snapshot: snap,
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func joinRoom(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		var req protocol.JoinRequest
		// body may be empty or partial; tolerate decode failure as defaults
		_ = decodeJSON(r, &req)

		// Name required for player and commenter joins (not spectator).
		// Resume with an existing token may omit name.
		needName := req.ResumeToken == "" &&
			req.DesiredRole != protocol.RoleSpectator &&
			req.DesiredRole != ""
		if needName {
			n, err := room.NormalizeName(req.Name)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			req.Name = n
		}

		jr, err := rm.Join(req.DesiredRole, req.Name, req.Model, req.ResumeToken)
		if err != nil {
			msg := err.Error()
			if msg == "name required" || msg == "name too long" {
				writeError(w, http.StatusBadRequest, msg)
				return
			}
			writeError(w, http.StatusBadRequest, msg)
			return
		}

		// Pending seat approval: 202-style body, no token yet.
		if jr.Pending {
			resp := protocol.JoinResponse{
				Role:      jr.Role,
				Pending:   true,
				RequestID: jr.RequestID,
				Snapshot:  rm.Snapshot(),
			}
			writeJSON(w, http.StatusAccepted, resp)
			return
		}

		resp := protocol.JoinResponse{
			Token:    jr.Token,
			Role:     jr.Role,
			Seat:     jr.Seat,
			Snapshot: rm.Snapshot(),
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func getState(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		writeJSON(w, http.StatusOK, rm.Snapshot())
	}
}

func getLegal(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		legal := rm.LegalMoves()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if legal == nil {
			_, _ = w.Write([]byte("[]"))
			return
		}
		_ = json.NewEncoder(w).Encode(legal)
	}
}

func postMove(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		tok, _ := TokenFromRequest(r)
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "missing token")
			return
		}
		// Commenters may not move.
		if rm.IsCommenterToken(tok) {
			writeError(w, http.StatusForbidden, "players only")
			return
		}
		var req protocol.MoveRequest
		if err := decodeWriteJSON(w, r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid move body")
			return
		}
		// Identity is derived solely from the token server-side; request body
		// never carries seat/name for authorization.
		ack := rm.Move(tok, req.Move, req.Meta)
		writeJSON(w, http.StatusOK, ack)
	}
}

func postEmote(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		tok, _ := TokenFromRequest(r)
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "missing token")
			return
		}
		if rm.IsCommenterToken(tok) {
			writeError(w, http.StatusForbidden, "players only")
			return
		}
		var req protocol.EmoteRequest
		if err := decodeWriteJSON(w, r, &req); err != nil {
			// allow empty / soft-fail body
			req.Emotion = ""
		}
		_ = rm.Emote(tok, req.Emotion, req.Note)
		w.WriteHeader(http.StatusNoContent)
	}
}

// commentRequest is the POST /comment body.
type commentRequest struct {
	Text string `json:"text"`
}

func postComment(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		tok, _ := TokenFromRequest(r)
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "missing token")
			return
		}
		var req commentRequest
		if err := decodeWriteJSON(w, r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		c, err := rm.Comment(tok, req.Text)
		if err != nil {
			switch err.Error() {
			case "unauthorized":
				writeError(w, http.StatusUnauthorized, "unauthorized")
			case "slow down":
				writeError(w, http.StatusTooManyRequests, "slow down")
			default:
				// text required / text too long
				writeError(w, http.StatusBadRequest, err.Error())
			}
			return
		}
		writeJSON(w, http.StatusOK, c)
	}
}

// approvalRequest is the POST /approvals body.
type approvalRequest struct {
	RequestID string `json:"requestId"`
	Accept    bool   `json:"accept"`
}

func postApproval(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		tok, _ := TokenFromRequest(r)
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "missing token")
			return
		}
		var req approvalRequest
		if err := decodeWriteJSON(w, r, &req); err != nil || req.RequestID == "" {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if err := rm.Approve(tok, req.RequestID, req.Accept); err != nil {
			msg := err.Error()
			switch {
			case msg == "players only", msg == "cannot approve own seat":
				writeError(w, http.StatusForbidden, msg)
			case msg == "request not found":
				writeError(w, http.StatusNotFound, msg)
			default:
				writeError(w, http.StatusBadRequest, msg)
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func getApproval(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		requestID := r.PathValue("requestId")
		view, ok := rm.PollApproval(requestID)
		if !ok {
			writeError(w, http.StatusNotFound, "request not found")
			return
		}
		// Build response without empty token field pollution
		out := map[string]any{
			"status": view.Status,
		}
		if view.Token != "" {
			out["token"] = view.Token
		}
		if view.Seat != "" {
			out["seat"] = view.Seat
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func getReport(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := mgr.Get(id)
		if !ok {
			writeError(w, http.StatusNotFound, "room not found")
			return
		}
		writeJSON(w, http.StatusOK, rm.Report())
	}
}

func listMatches(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		game := q.Get("game")
		limit, _ := strconv.Atoi(q.Get("limit"))
		offset, _ := strconv.Atoi(q.Get("offset"))
		matches, total, err := mgr.Store().ListMatches(r.Context(), store.ListOptions{
			Game:   game,
			Limit:  limit,
			Offset: offset,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "list matches failed")
			return
		}
		if matches == nil {
			matches = []protocol.MatchSummary{}
		}
		writeJSON(w, http.StatusOK, protocol.ArchiveList{Matches: matches, Total: total})
	}
}

func getMatch(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("room")
		archived, found, err := mgr.Store().GetMatch(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "get match failed")
			return
		}
		if found {
			writeJSON(w, http.StatusOK, archived)
			return
		}
		// Fall back to a live room (just-finished match not yet flushed, or in-progress).
		rm, ok := mgr.Get(id)
		if ok {
			// Room.Comments() returns nil for an empty buffer; ArchivedMatch.Comments
			// has no omitempty, so coerce to [] to avoid marshalling JSON null.
			comments := rm.Comments()
			if comments == nil {
				comments = []protocol.Comment{}
			}
			writeJSON(w, http.StatusOK, protocol.ArchivedMatch{
				Report:   rm.Report(),
				Comments: comments,
			})
			return
		}
		writeError(w, http.StatusNotFound, "match not found")
	}
}

func getLeaderboard(mgr *room.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := mgr.Store().Leaderboard(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "leaderboard failed")
			return
		}
		if rows == nil {
			rows = []protocol.LeaderRow{}
		}
		writeJSON(w, http.StatusOK, protocol.Leaderboard{Rows: rows})
	}
}
