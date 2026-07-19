package room

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/rules/spec"
	"github.com/agents-arena/agents-arena/server/internal/hub"
	"github.com/agents-arena/agents-arena/server/internal/store"
)

const (
	maxNameLen       = 40
	maxCommentLen    = 280
	commentRateLimit = 4 * time.Second
	maxCommentBuf    = 100
	pendingExpiry    = 10 * time.Minute
	// bothLostAutoApprove is how long a seat must stay lost before a pending
	// join is auto-approved when BOTH players are lost (room must stay playable).
	bothLostAutoApprove = 120 * time.Second
)

// seatInfo holds per-seat authoritative player state.
type seatInfo struct {
	token     string
	name      string
	model     string
	connected bool
	// Live-presence tracking: subs is the number of open token'd event streams
	// for this seat (>0 = the agent is live); everLive records that it was live
	// at least once, so we can distinguish "connecting" from "lost".
	subs     int
	everLive bool
	// lostAt is set when the seat transitions to "lost" (subs hits 0 after
	// having been live). Zero when not lost. Used for the both-lost auto-approve.
	lostAt time.Time
}

// commenterInfo is a non-seated write identity that may only comment.
type commenterInfo struct {
	name  string
	model string
}

// pendingJoin is a request to take over a lost seat; needs approval (or auto).
type pendingJoin struct {
	requestID string
	name      string
	model     string
	seat      string
	// token is pre-minted for the joiner and handed out exactly once on the
	// first successful approved poll.
	token     string
	createdAt time.Time
	status    string // "pending" | "approved" | "denied"
	delivered bool   // token already returned via GET
}

// JoinResult is the outcome of Room.Join.
type JoinResult struct {
	Token     string
	Role      protocol.Role
	Seat      string
	Pending   bool
	RequestID string
}

// ApprovalView is returned by PollApproval / GET approvals.
type ApprovalView struct {
	Status string // "pending" | "approved" | "denied"
	Token  string // set only once, on first approved poll
	Seat   string
}

// Room is the authoritative container for one match.
// All fields are guarded by mu for mutation and snapshot reads that need consistency.
type Room struct {
	mu sync.Mutex

	id    string
	rules spec.Rules
	state any
	rev   int

	// seats in game-defined order (e.g. ["X","O"])
	seats []string

	// per-seat records (only occupied seats are present)
	players map[string]seatInfo // seat -> info

	// fast lookup token -> seat (only for players); lookups use constant-time compare
	tokenToSeat map[string]string

	// commenters: token -> info (role commenter, no seat)
	commenters map[string]commenterInfo

	// lastCommentAt rate-limits POST /comment (1 per commentRateLimit per token)
	lastCommentAt map[string]time.Time

	// ring buffer of recent comments (oldest first, max maxCommentBuf)
	comments []protocol.Comment

	// pending seat-takeover requests keyed by requestId
	pending map[string]*pendingJoin

	moveLog []protocol.MoveRecord

	// per-seat counters
	rejected map[string]int

	// latest emote per seat (emotes never affect game state/rev)
	emotes map[string]protocol.Emote

	startedAt     int64
	turnStartedAt int64
	endedAt       int64
	result        *protocol.GameResult

	reasoning protocol.ReasoningMode
	// onArchive is invoked once when the match becomes terminal (nil-safe).
	// Called in a goroutine with a copy of the archive data; must not hold r.mu.
	onArchive func(store.MatchArchive)

	hub *hub.Hub
}

// NewRoom creates a new authoritative room for the given game.
// When reserveHost is true the creator takes the first seat (and gets the
// returned host token); when false the room is created seatless — a referee —
// so BOTH seats stay open for agents to join, and the returned token is empty.
// No events are published on creation.
func NewRoom(id, game, hostName, hostModel string, reserveHost bool, reasoning protocol.ReasoningMode) (*Room, string, error) {
	rg, ok := spec.Get(game)
	if !ok {
		return nil, "", fmt.Errorf("unknown game %q", game)
	}
	meta := rg.Meta()
	if len(meta.Seats) == 0 {
		return nil, "", errors.New("game declares no seats")
	}

	st := rg.Init("")

	now := time.Now().UnixMilli()

	players := make(map[string]seatInfo)
	tokenToSeat := make(map[string]string)
	hostToken := ""
	if reserveHost {
		hostSeat := meta.Seats[0]
		hostToken = generateToken()
		players[hostSeat] = seatInfo{
			token:     hostToken,
			name:      hostName,
			model:     hostModel,
			connected: true,
		}
		tokenToSeat[hostToken] = hostSeat
	}

	rm := &Room{
		id:            id,
		rules:         rg,
		state:         st,
		rev:           0,
		seats:         append([]string(nil), meta.Seats...),
		players:       players,
		tokenToSeat:   tokenToSeat,
		commenters:    make(map[string]commenterInfo),
		lastCommentAt: make(map[string]time.Time),
		comments:      nil,
		pending:       make(map[string]*pendingJoin),
		moveLog:       nil,
		rejected:      make(map[string]int),
		emotes:        make(map[string]protocol.Emote),
		startedAt:     now,
		turnStartedAt: now,
		reasoning:     protocol.NormalizeReasoning(reasoning),
		hub:           hub.New(16),
	}
	return rm, hostToken, nil
}

// generateToken returns a URL-safe random token from crypto/rand (no padding).
// 18 bytes → 24-char base64.RawURLEncoding string.
func generateToken() string {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		// extremely unlikely; fall back to time-based (still hard to guess)
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// NormalizeName trims, strips control characters, and validates length.
// Returns the cleaned name or an error ("name required" / "name too long").
func NormalizeName(name string) (string, error) {
	// strip control chars (including newlines/tabs) then trim space
	var b []byte
	for _, r := range name {
		if r == utf8.RuneError {
			continue
		}
		if unicode.IsControl(r) {
			continue
		}
		b = append(b, string(r)...)
	}
	cleaned := string(b)
	// trim unicode spaces
	cleaned = trimSpace(cleaned)
	if cleaned == "" {
		return "", errors.New("name required")
	}
	if utf8.RuneCountInString(cleaned) > maxNameLen {
		return "", errors.New("name too long")
	}
	return cleaned, nil
}

func trimSpace(s string) string {
	// strings.TrimSpace but keep package free of extra import noise for control strip
	start, end := 0, len(s)
	for start < end {
		r, size := utf8.DecodeRuneInString(s[start:])
		if !unicode.IsSpace(r) {
			break
		}
		start += size
	}
	for end > start {
		r, size := utf8.DecodeLastRuneInString(s[:end])
		if !unicode.IsSpace(r) {
			break
		}
		end -= size
	}
	return s[start:end]
}

// NormalizeCommentText trims, strips control chars, enforces 1..280 runes.
func NormalizeCommentText(text string) (string, error) {
	var b []byte
	for _, r := range text {
		if r == utf8.RuneError {
			continue
		}
		if unicode.IsControl(r) {
			continue
		}
		b = append(b, string(r)...)
	}
	cleaned := trimSpace(string(b))
	if cleaned == "" {
		return "", errors.New("text required")
	}
	if utf8.RuneCountInString(cleaned) > maxCommentLen {
		return "", errors.New("text too long")
	}
	return cleaned, nil
}

// Snapshot returns a point-in-time view. Safe to call without external lock.
func (r *Room) Snapshot() protocol.Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.expirePendingLocked(time.Now())
	r.maybeAutoApproveLocked(time.Now())
	return r.snapshotLocked()
}

func (r *Room) snapshotLocked() protocol.Snapshot {
	snap := protocol.Snapshot{
		Rev:       r.rev,
		GameID:    r.rules.Meta().ID,
		State:     r.rules.Serialize(r.state),
		ToMove:    r.rules.ToMove(r.state),
		Result:    r.result,
		Players:   make([]protocol.Player, 0, len(r.players)),
		Reasoning: r.reasoning,
	}
	for _, seat := range r.seats {
		if p, ok := r.players[seat]; ok {
			snap.Players = append(snap.Players, protocol.Player{
				Seat:      seat,
				Name:      p.name,
				Model:     p.model,
				Connected: p.connected,
				Status:    seatStatus(p),
			})
		} else {
			// include unoccupied seats as disconnected entries (optional but consistent)
			snap.Players = append(snap.Players, protocol.Player{
				Seat:      seat,
				Connected: false,
				Status:    "open",
			})
		}
	}
	// Hints: advisory only; never affect legality. Tokens never appear here.
	if h, ok := r.rules.(spec.Hinter); ok {
		if hints := h.Hints(r.state); len(hints) > 0 {
			snap.Hints = hints
		}
	}
	return snap
}

// seatStatus maps an occupied seat's presence to a UI status.
func seatStatus(p seatInfo) string {
	switch {
	case p.subs > 0:
		return "connected"
	case p.everLive && !p.connected:
		return "lost"
	default:
		return "connecting"
	}
}

// tokenEqual is a constant-time string compare for auth tokens.
func tokenEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// resolveTokenLocked finds a token among players and commenters using
// constant-time comparison. Returns role, seat (empty for commenter), name, ok.
func (r *Room) resolveTokenLocked(token string) (role protocol.Role, seat, name string, ok bool) {
	if token == "" {
		return "", "", "", false
	}
	for t, s := range r.tokenToSeat {
		if tokenEqual(t, token) {
			info := r.players[s]
			return r.roleForSeat(s), s, info.name, true
		}
	}
	for t, c := range r.commenters {
		if tokenEqual(t, token) {
			return protocol.RoleCommenter, "", c.name, true
		}
	}
	return "", "", "", false
}

// ResolveToken looks up a bearer token → (role, seat, name, ok).
// Seat is empty for commenters. Uses constant-time token comparison.
func (r *Room) ResolveToken(token string) (role protocol.Role, seat, name string, ok bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.resolveTokenLocked(token)
}

// IsPlayerToken reports whether token belongs to a currently seated player.
func (r *Room) IsPlayerToken(token string) bool {
	role, _, _, ok := r.ResolveToken(token)
	return ok && role != protocol.RoleCommenter && role != protocol.RoleSpectator
}

// IsCommenterToken reports whether token belongs to a commenter.
func (r *Room) IsCommenterToken(token string) bool {
	role, _, _, ok := r.ResolveToken(token)
	return ok && role == protocol.RoleCommenter
}

// PresenceUp registers a live event stream for the seat holding token. Returns
// the seat (or "" if token isn't a player token). Publishes a snapshot when the
// seat first becomes live so watchers see the dot turn green.
// If the seat was "lost", pending join requests for that seat are auto-denied
// (the original player reconnected before approval).
func (r *Room) PresenceUp(token string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	seat, ok := r.findPlayerSeatLocked(token)
	if !ok {
		return ""
	}
	info := r.players[seat]
	wasLost := info.everLive && info.subs == 0
	info.subs++
	info.everLive = true
	info.lostAt = time.Time{}
	info.connected = true
	r.players[seat] = info
	if wasLost {
		// Lost player reconnected via events stream → deny pending takeovers.
		r.denyPendingForSeatLocked(seat)
	}
	if info.subs == 1 {
		snap := r.snapshotLocked()
		r.hub.Publish(protocol.Event{Type: "snapshot", Snapshot: &snap})
	}
	return seat
}

// PresenceDown drops a live event stream for seat. When the last one closes the
// seat goes "lost" and a snapshot is published so watchers see the dot turn red.
func (r *Room) PresenceDown(seat string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	info, ok := r.players[seat]
	if !ok {
		return
	}
	if info.subs > 0 {
		info.subs--
	}
	if info.subs == 0 && info.everLive {
		info.lostAt = time.Now()
		info.connected = false
	}
	r.players[seat] = info
	if info.subs == 0 {
		snap := r.snapshotLocked()
		r.hub.Publish(protocol.Event{Type: "snapshot", Snapshot: &snap})
	}
}

// findPlayerSeatLocked resolves a player token → seat with constant-time compare.
func (r *Room) findPlayerSeatLocked(token string) (string, bool) {
	if token == "" {
		return "", false
	}
	for t, s := range r.tokenToSeat {
		if tokenEqual(t, token) {
			return s, true
		}
	}
	return "", false
}

// Join assigns a seat, commenter role, or spectator.
// desiredRole "commenter" → commenter token (no seat).
// desiredRole "spectator"/"" → spectator (no token).
// Otherwise (player/host/guest/…): open seats are taken immediately; lost seats
// require approval (pending response); busy seats cannot be displaced.
func (r *Room) Join(desiredRole protocol.Role, name, model, resumeToken string) (JoinResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	r.expirePendingLocked(now)
	r.maybeAutoApproveLocked(now)

	// Try resume first if token provided (works for players and commenters)
	if resumeToken != "" {
		if seat, ok := r.findPlayerSeatLocked(resumeToken); ok {
			info := r.players[seat]
			wasLost := info.everLive && info.subs == 0
			info.connected = true
			if name != "" {
				if n, err := NormalizeName(name); err == nil {
					info.name = n
				}
			}
			if model != "" {
				info.model = model
			}
			// Reconnect of a lost seat auto-denies pending takeovers for it.
			if wasLost {
				info.lostAt = time.Time{}
				r.denyPendingForSeatLocked(seat)
			}
			r.players[seat] = info
			snap := r.snapshotLocked()
			r.hub.Publish(protocol.Event{Type: "snapshot", Snapshot: &snap})
			return JoinResult{Token: resumeToken, Role: r.roleForSeat(seat), Seat: seat}, nil
		}
		// commenter resume
		for t, c := range r.commenters {
			if tokenEqual(t, resumeToken) {
				if name != "" {
					if n, err := NormalizeName(name); err == nil {
						c.name = n
						r.commenters[t] = c
					}
				}
				return JoinResult{Token: resumeToken, Role: protocol.RoleCommenter}, nil
			}
		}
		// resumeToken didn't match: fall through to normal join
	}

	if desiredRole == protocol.RoleSpectator || desiredRole == "" {
		return JoinResult{Role: protocol.RoleSpectator}, nil
	}

	if desiredRole == protocol.RoleCommenter {
		n, err := NormalizeName(name)
		if err != nil {
			return JoinResult{}, err
		}
		tok := generateToken()
		r.commenters[tok] = commenterInfo{name: n, model: model}
		return JoinResult{Token: tok, Role: protocol.RoleCommenter}, nil
	}

	// Player seat request (host/guest/"player"/anything else non-spectator).
	n, err := NormalizeName(name)
	if err != nil {
		return JoinResult{}, err
	}

	// 1) Open seats (never taken): first come.
	for _, seat := range r.seats {
		if _, occupied := r.players[seat]; !occupied {
			tok := generateToken()
			r.players[seat] = seatInfo{
				token:     tok,
				name:      n,
				model:     model,
				connected: true,
			}
			r.tokenToSeat[tok] = seat
			snap := r.snapshotLocked()
			r.hub.Publish(protocol.Event{Type: "snapshot", Snapshot: &snap})
			return JoinResult{Token: tok, Role: r.roleForSeat(seat), Seat: seat}, nil
		}
	}

	// 2) Lost seats: store pending request; do not issue token yet.
	for _, seat := range r.seats {
		info, occupied := r.players[seat]
		if !occupied {
			continue
		}
		if seatStatus(info) != "lost" {
			// connecting/connected = BUSY; nobody can displace a live player.
			continue
		}
		// Create pending request for this lost seat.
		reqID := generateToken() // 24-char url-safe from crypto/rand
		pj := &pendingJoin{
			requestID: reqID,
			name:      n,
			model:     model,
			seat:      seat,
			token:     generateToken(), // pre-minted joiner token
			createdAt: now,
			status:    "pending",
		}
		r.pending[reqID] = pj
		infoEvt := protocol.JoinRequestInfo{
			RequestID: reqID,
			Name:      n,
			Seat:      seat,
			TS:        now.UnixMilli(),
		}
		r.hub.Publish(protocol.Event{Type: "joinRequest", JoinRequest: &infoEvt})
		// 202-style body: pending, no token, role spectator for now.
		return JoinResult{
			Role:      protocol.RoleSpectator,
			Pending:   true,
			RequestID: reqID,
		}, nil
	}

	// All seats busy (connecting/connected) or no lost seat available → spectator.
	return JoinResult{Role: protocol.RoleSpectator}, nil
}

func (r *Room) roleForSeat(seat string) protocol.Role {
	if len(r.seats) == 0 {
		return protocol.RoleGuest
	}
	if seat == r.seats[0] {
		return protocol.RoleHost
	}
	return protocol.RoleGuest
}

// Comment posts a chat message from a player or commenter token.
// Returns (comment, nil) on success; error messages are API-facing:
// "unauthorized", "slow down", or NormalizeCommentText errors.
func (r *Room) Comment(token, text string) (protocol.Comment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	role, seat, name, ok := r.resolveTokenLocked(token)
	if !ok {
		return protocol.Comment{}, errors.New("unauthorized")
	}
	// Players (have a seat) or commenters only — pure spectators have no token.
	if role != protocol.RoleCommenter && seat == "" {
		return protocol.Comment{}, errors.New("unauthorized")
	}

	cleaned, err := NormalizeCommentText(text)
	if err != nil {
		return protocol.Comment{}, err
	}

	now := time.Now()
	if last, ok := r.lastCommentAt[token]; ok && now.Sub(last) < commentRateLimit {
		return protocol.Comment{}, errors.New("slow down")
	}
	r.lastCommentAt[token] = now

	wireRole := "player"
	if role == protocol.RoleCommenter {
		wireRole = "commenter"
		seat = "" // commenters have no seat on the wire
	}

	c := protocol.Comment{
		Name: name,
		Seat: seat,
		Role: wireRole,
		Text: cleaned,
		TS:   now.UnixMilli(),
	}
	r.comments = append(r.comments, c)
	if len(r.comments) > maxCommentBuf {
		// drop oldest
		r.comments = append([]protocol.Comment(nil), r.comments[len(r.comments)-maxCommentBuf:]...)
	}
	// publish (copy to heap for event lifetime)
	cc := c
	r.hub.Publish(protocol.Event{Type: "comment", Comment: &cc})
	return c, nil
}

// Comments returns a copy of the comment ring buffer (oldest first).
func (r *Room) Comments() []protocol.Comment {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.comments) == 0 {
		return nil
	}
	out := make([]protocol.Comment, len(r.comments))
	copy(out, r.comments)
	return out
}

// Approve handles POST /approvals: a currently seated player accepts/denies a
// pending takeover of the *other* (lost) seat.
func (r *Room) Approve(approverToken, requestID string, accept bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	r.expirePendingLocked(now)
	r.maybeAutoApproveLocked(now)

	role, approverSeat, _, ok := r.resolveTokenLocked(approverToken)
	if !ok || role == protocol.RoleCommenter || approverSeat == "" {
		return errors.New("players only")
	}

	pj, ok := r.pending[requestID]
	if !ok {
		return errors.New("request not found")
	}
	if pj.status != "pending" {
		return errors.New("request not pending")
	}
	// Approver must be a seated player on a different seat than the request.
	if approverSeat == pj.seat {
		return errors.New("cannot approve own seat")
	}

	if !accept {
		pj.status = "denied"
		return nil
	}

	if err := r.applyApprovalLocked(pj, now); err != nil {
		return err
	}
	return nil
}

// applyApprovalLocked installs the joiner into the lost seat, revoking the old token.
func (r *Room) applyApprovalLocked(pj *pendingJoin, now time.Time) error {
	info, ok := r.players[pj.seat]
	if !ok {
		pj.status = "denied"
		return errors.New("seat no longer occupied")
	}
	// Revoke old token
	oldTok := info.token
	delete(r.tokenToSeat, oldTok)

	// Install joiner with pre-minted token
	r.players[pj.seat] = seatInfo{
		token:     pj.token,
		name:      pj.name,
		model:     pj.model,
		connected: true,
		subs:      0,
		everLive:  false,
		lostAt:    time.Time{},
	}
	r.tokenToSeat[pj.token] = pj.seat
	pj.status = "approved"

	// Deny any other pending requests for the same seat
	for id, other := range r.pending {
		if id == pj.requestID {
			continue
		}
		if other.seat == pj.seat && other.status == "pending" {
			other.status = "denied"
		}
	}

	snap := r.snapshotLocked()
	r.hub.Publish(protocol.Event{Type: "snapshot", Snapshot: &snap})
	return nil
}

// PollApproval is GET /approvals/{requestId}. On first approved poll the joiner
// token is returned exactly once; the request is then marked delivered.
func (r *Room) PollApproval(requestID string) (ApprovalView, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	r.expirePendingLocked(now)
	r.maybeAutoApproveLocked(now)

	pj, ok := r.pending[requestID]
	if !ok {
		return ApprovalView{}, false
	}
	view := ApprovalView{Status: pj.status, Seat: pj.seat}
	if pj.status == "approved" && !pj.delivered {
		view.Token = pj.token
		view.Seat = pj.seat
		pj.delivered = true
	}
	return view, true
}

// denyPendingForSeatLocked marks all pending requests for seat as denied.
func (r *Room) denyPendingForSeatLocked(seat string) {
	for _, pj := range r.pending {
		if pj.seat == seat && pj.status == "pending" {
			pj.status = "denied"
		}
	}
}

// expirePendingLocked denies pending requests older than 10 minutes.
func (r *Room) expirePendingLocked(now time.Time) {
	for _, pj := range r.pending {
		if pj.status == "pending" && now.Sub(pj.createdAt) > pendingExpiry {
			pj.status = "denied"
		}
	}
}

// maybeAutoApproveLocked: when BOTH players are lost, the first pending request
// per seat is auto-approved after that seat has been lost for > 120s so the
// room remains playable. (Documented edge case from handshake contract.)
func (r *Room) maybeAutoApproveLocked(now time.Time) {
	if !r.bothPlayersLostLocked() {
		return
	}
	// Collect earliest pending per seat
	earliest := map[string]*pendingJoin{}
	for _, pj := range r.pending {
		if pj.status != "pending" {
			continue
		}
		cur, ok := earliest[pj.seat]
		if !ok || pj.createdAt.Before(cur.createdAt) {
			earliest[pj.seat] = pj
		}
	}
	for seat, pj := range earliest {
		info, ok := r.players[seat]
		if !ok {
			continue
		}
		if seatStatus(info) != "lost" {
			continue
		}
		if info.lostAt.IsZero() {
			continue
		}
		if now.Sub(info.lostAt) > bothLostAutoApprove {
			_ = r.applyApprovalLocked(pj, now)
		}
	}
}

func (r *Room) bothPlayersLostLocked() bool {
	occupied := 0
	for _, seat := range r.seats {
		info, ok := r.players[seat]
		if !ok {
			return false // a seat was never taken — not "both players"
		}
		occupied++
		if seatStatus(info) != "lost" {
			return false
		}
	}
	return occupied >= 2
}

// Move validates and applies a move for the token's seat.
// Unauthorized, wrong-turn, or invalid moves increment rejected[seat] and return ok=false.
// On success: apply, bump rev, log MoveRecord, advance turn timer, recompute result,
// publish snapshot (and report if terminal).
// Identity comes strictly from the token; the move body never carries seat.
func (r *Room) Move(token string, move json.RawMessage, meta *protocol.MoveMeta) protocol.MoveAck {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Commenters / unknown tokens: unauthorized (API maps commenters to 403).
	seat, ok := r.findPlayerSeatLocked(token)
	if !ok {
		return protocol.MoveAck{OK: false, Reason: "unauthorized"}
	}

	// must be this seat's turn
	if r.rules.ToMove(r.state) != seat {
		r.rejected[seat]++
		return protocol.MoveAck{OK: false, Reason: "not your turn"}
	}

	if err := r.rules.Validate(r.state, move, seat); err != nil {
		r.rejected[seat]++
		return protocol.MoveAck{OK: false, Reason: err.Error()}
	}

	// apply
	newState := r.rules.Apply(r.state, move)
	r.state = newState
	r.rev++

	now := time.Now().UnixMilli()
	think := now - r.turnStartedAt
	if think < 0 {
		think = 0
	}

	rec := protocol.MoveRecord{
		Ply:           len(r.moveLog) + 1,
		Seat:          seat,
		Move:          append(json.RawMessage(nil), move...), // copy
		Rev:           r.rev,
		TurnStartedAt: r.turnStartedAt,
		AppliedAt:     now,
		ThinkMs:       think,
		Meta:          meta,
	}
	r.moveLog = append(r.moveLog, rec)

	r.turnStartedAt = now
	r.result = r.rules.Terminal(r.state)

	snap := r.snapshotLocked()
	r.hub.Publish(protocol.Event{Type: "snapshot", Snapshot: &snap})

	if r.result != nil && r.endedAt == 0 {
		r.endedAt = now
		rep := r.reportLocked()
		r.hub.Publish(protocol.Event{Type: "report", Report: &rep})
		if r.onArchive != nil {
			// Copy under lock; invoke outside critical section so DB I/O
			// never holds r.mu or blocks the move path.
			archive := store.MatchArchive{
				Room:      r.id,
				GameID:    rep.GameID,
				Reasoning: r.reasoning,
				StartedAt: r.startedAt,
				EndedAt:   r.endedAt,
				Report:    rep,
				Comments:  append([]protocol.Comment(nil), r.comments...),
			}
			cb := r.onArchive
			go cb(archive)
		}
	}

	return protocol.MoveAck{OK: true, Rev: r.rev}
}

// Emote stores the latest emote for the seat (if token resolves to a seat) and
// publishes an emote event. Commenters must be rejected at the API layer (403).
// Unknown tokens are ignored here.
func (r *Room) Emote(token string, e protocol.Emotion, note string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	seat, ok := r.findPlayerSeatLocked(token)
	if !ok {
		// spectator / commenter / bad token: no-op at room layer
		return nil
	}
	if !e.Valid() {
		e = protocol.EmotionNeutral
	}
	em := protocol.Emote{
		Seat:    seat,
		Emotion: e,
		Note:    note,
		Ts:      time.Now().UnixMilli(),
	}
	r.emotes[seat] = em
	r.hub.Publish(protocol.Event{Type: "emote", Emote: &em})
	return nil
}

// Report returns the current MatchReport. Safe for concurrent use.
// Tokens never appear in reports.
func (r *Room) Report() protocol.MatchReport {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reportLocked()
}

func (r *Room) reportLocked() protocol.MatchReport {
	meta := r.rules.Meta()
	now := time.Now().UnixMilli()

	rep := protocol.MatchReport{
		ProtocolV:   protocol.Version,
		GameID:      meta.ID,
		Room:        r.id,
		StartedAt:   r.startedAt,
		Result:      r.result,
		Moves:       append([]protocol.MoveRecord(nil), r.moveLog...),
		GeneratedAt: now,
		Reasoning:   r.reasoning,
	}

	if r.endedAt > 0 {
		rep.EndedAt = r.endedAt
		rep.DurationMs = r.endedAt - r.startedAt
	} else {
		rep.DurationMs = now - r.startedAt
	}

	// build per-seat player reports
	type agg struct {
		name       string
		model      string
		moves      int
		totalThink int64
		rejected   int
		tokensIn   int
		tokensOut  int
		methods    map[string]int
	}
	aggs := make(map[string]*agg)
	for seat := range r.players {
		info := r.players[seat]
		aggs[seat] = &agg{
			name:    info.name,
			model:   info.model,
			methods: make(map[string]int),
		}
	}
	for _, rec := range r.moveLog {
		if a, ok := aggs[rec.Seat]; ok {
			a.moves++
			a.totalThink += rec.ThinkMs
			if rec.Meta != nil {
				a.tokensIn += rec.Meta.TokensIn
				a.tokensOut += rec.Meta.TokensOut
				if rec.Meta.Method != "" {
					a.methods[rec.Meta.Method]++
				}
			}
		}
	}
	for seat, cnt := range r.rejected {
		if a, ok := aggs[seat]; ok {
			a.rejected = cnt
		}
	}

	players := make([]protocol.PlayerReport, 0, len(aggs))
	for _, seat := range r.seats {
		a, ok := aggs[seat]
		if !ok {
			continue
		}
		pr := protocol.PlayerReport{
			Seat:         seat,
			Name:         a.name,
			Model:        a.model,
			Moves:        a.moves,
			TotalThinkMs: a.totalThink,
			Rejected:     a.rejected,
			TokensIn:     a.tokensIn,
			TokensOut:    a.tokensOut,
		}
		if a.moves > 0 {
			pr.AvgThinkMs = a.totalThink / int64(a.moves)
		}
		if len(a.methods) > 0 {
			pr.Methods = a.methods
			pr.Method = dominantMethod(a.methods)
		}
		players = append(players, pr)
	}
	rep.Players = players

	return rep
}

// dominantMethod returns the method with the highest count; ties broken lexically.
func dominantMethod(counts map[string]int) string {
	best := ""
	bestN := -1
	for m, n := range counts {
		if n > bestN || (n == bestN && m < best) {
			best = m
			bestN = n
		}
	}
	return best
}

// internal helpers for manager/tests

func (r *Room) Hub() *hub.Hub {
	return r.hub
}

// For test introspection only (do not use in prod paths).
func (r *Room) rejectedCount(seat string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rejected[seat]
}

func (r *Room) emoteFor(seat string) (protocol.Emote, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.emotes[seat]
	return e, ok
}

// playerTokenForTest returns the raw token for a seat (tests only).
func (r *Room) playerTokenForTest(seat string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if info, ok := r.players[seat]; ok {
		return info.token
	}
	return ""
}

// forceLostForTest marks a seat lost without waiting for SSE (tests only).
func (r *Room) forceLostForTest(seat string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	info, ok := r.players[seat]
	if !ok {
		return
	}
	info.subs = 0
	info.everLive = true
	info.connected = false
	info.lostAt = time.Now()
	r.players[seat] = info
}

// forceLostAtForTest sets lostAt in the past (tests only).
func (r *Room) forceLostAtForTest(seat string, lostAt time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	info, ok := r.players[seat]
	if !ok {
		return
	}
	info.subs = 0
	info.everLive = true
	info.connected = false
	info.lostAt = lostAt
	r.players[seat] = info
}

// LegalMoves returns current legal moves (delegates to rules on live state).
func (r *Room) LegalMoves() []json.RawMessage {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rules.LegalMoves(r.state)
}

// ID returns the room identifier.
func (r *Room) ID() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.id
}
