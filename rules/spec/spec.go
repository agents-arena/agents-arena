package spec

import (
	"encoding/json"
	"sync"

	"github.com/agents-arena/agents-arena/protocol"
)

// GameMeta describes a game for registration and UI.
type GameMeta struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	MinPlayers int      `json:"minPlayers"`
	MaxPlayers int      `json:"maxPlayers"`
	Seats      []string `json:"seats"`
}

// Rules is the game-agnostic contract for authoritative game logic.
// State is game-specific and passed as any. Implementations must not mutate
// inputs and must be pure.
type Rules interface {
	// Meta returns static game metadata.
	Meta() GameMeta

	// Init returns a fresh initial state. seed may be used for deterministic
	// setups in games that need it (ignored for tic-tac-toe).
	Init(seed string) any

	// ToMove returns the seat whose turn it is, or "" if the game is terminal.
	ToMove(state any) string

	// Validate checks whether move is legal for seat in state.
	// Returns nil if legal; otherwise an error whose message is the reason
	// (e.g. "not your turn", "cell occupied", "game over").
	Validate(state any, move json.RawMessage, seat string) error

	// Apply returns a *new* state after applying the (assumed valid) move.
	// The input state must not be mutated.
	Apply(state any, move json.RawMessage) any

	// LegalMoves returns the list of legal moves for the current side to move
	// as raw JSON move objects. Returns empty slice if terminal.
	LegalMoves(state any) []json.RawMessage

	// Terminal returns the result if the game has ended, or nil if still running.
	Terminal(state any) *protocol.GameResult

	// Serialize returns the wire representation of state (the value that goes
	// into Snapshot.State and is what clients deserialize).
	Serialize(state any) json.RawMessage

	// Deserialize reconstructs a state from its serialized wire form.
	Deserialize(data json.RawMessage) (any, error)
}

// Hinter is an optional interface that Rules may implement to provide
// advisory text for the side to move (e.g. draw-claim warnings). Hints never
// affect move legality; the server attaches them to snapshots when present.
type Hinter interface {
	Hints(state any) []string
}

var (
	mu   sync.RWMutex
	byID = make(map[string]Rules)
	list []Rules
)

// Register adds a Rules implementation to the global registry. Games call this
// from an init() function. Duplicate IDs are ignored (first registration wins).
func Register(r Rules) {
	if r == nil {
		return
	}
	id := r.Meta().ID
	if id == "" {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	if _, exists := byID[id]; exists {
		return
	}
	byID[id] = r
	list = append(list, r)
}

// Get returns the registered rules for id, if any.
func Get(id string) (Rules, bool) {
	mu.RLock()
	defer mu.RUnlock()
	r, ok := byID[id]
	return r, ok
}

// All returns a snapshot of all registered rules (in registration order).
func All() []Rules {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]Rules, len(list))
	copy(out, list)
	return out
}
