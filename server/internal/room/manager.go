package room

import (
	"context"
	"crypto/rand"
	"errors"
	"log"
	"sync"

	"github.com/agents-arena/agents-arena/protocol"
	"github.com/agents-arena/agents-arena/server/internal/store"
)

// alphabet for short readable slugs (matches TS utils in arena: no 0,1,l,o)
const slugAlphabet = "abcdefghijkmnpqrstuvwxyz23456789"

const (
	defaultSlugLen   = 6
	maxCreateRetries = 8
)

// Manager owns the set of active rooms.
type Manager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
	store store.Store
}

// NewManager creates an empty manager. If st is nil, an in-memory store is used.
func NewManager(st store.Store) *Manager {
	if st == nil {
		st = store.NewMem()
	}
	return &Manager{
		rooms: make(map[string]*Room),
		store: st,
	}
}

// Store returns the match archive store.
func (m *Manager) Store() store.Store {
	return m.store
}

// Create instantiates a new room for game. When spectate is false the creator
// takes the first seat and gets a host token; when true the room is seatless
// (a referee), leaving both seats open for agents. The room id is a short
// url-safe slug.
func (m *Manager) Create(game, hostName, hostModel string, spectate bool, reasoning protocol.ReasoningMode) (*Room, string, error) {
	for i := 0; i < maxCreateRetries; i++ {
		id := generateSlug(defaultSlugLen)
		m.mu.Lock()
		if _, exists := m.rooms[id]; exists {
			m.mu.Unlock()
			continue
		}
		rm, tok, err := NewRoom(id, game, hostName, hostModel, !spectate, reasoning)
		if err != nil {
			m.mu.Unlock()
			return nil, "", err
		}
		rm.onArchive = func(a store.MatchArchive) {
			if err := m.store.SaveMatch(context.Background(), a); err != nil {
				log.Printf("store: save match %s: %v", a.Room, err)
			}
		}
		m.rooms[id] = rm
		m.mu.Unlock()
		return rm, tok, nil
	}
	return nil, "", errors.New("failed to allocate unique room id")
}

// Get returns the room by id, or nil,false if not present.
func (m *Manager) Get(id string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.rooms[id]
	return r, ok
}

// Remove deletes a room (used by tests or future GC).
func (m *Manager) Remove(id string) {
	m.mu.Lock()
	delete(m.rooms, id)
	m.mu.Unlock()
}

// Len returns number of managed rooms.
func (m *Manager) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rooms)
}

// generateSlug produces a short url-safe id from the alphabet.
func generateSlug(n int) string {
	if n <= 0 {
		n = defaultSlugLen
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// fallback (still unlikely collision for test/dev)
		for i := range b {
			b[i] = byte(i % 26)
		}
	}
	for i := range b {
		b[i] = slugAlphabet[int(b[i])%len(slugAlphabet)]
	}
	return string(b)
}

// expose for testing slow consumers etc (not part of public API surface)
func (r *Room) subscribeForTest() (<-chan protocol.Event, func()) {
	return r.hub.Subscribe()
}

// Hub exposes the underlying hub (used by SSE handler).
func (r *Room) Subscribe() (<-chan protocol.Event, func()) {
	return r.hub.Subscribe()
}
