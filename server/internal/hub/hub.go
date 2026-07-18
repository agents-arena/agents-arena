package hub

import (
	"sync"

	"github.com/agents-arena/agents-arena/protocol"
)

// Hub provides a simple per-room pub/sub for broadcasting events to
// multiple subscribers (e.g. SSE spectators). Publish is non-blocking:
// slow consumers are dropped rather than blocking the publisher.
type Hub struct {
	mu          sync.RWMutex
	subscribers map[chan protocol.Event]struct{}
	bufSize     int
}

// New creates a Hub with the given buffer size for subscriber channels.
func New(bufSize int) *Hub {
	if bufSize <= 0 {
		bufSize = 8
	}
	return &Hub{
		subscribers: make(map[chan protocol.Event]struct{}),
		bufSize:     bufSize,
	}
}

// Subscribe returns a receive-only channel for events and a cancel func
// that removes the subscriber. The channel is buffered.
func (h *Hub) Subscribe() (<-chan protocol.Event, func()) {
	ch := make(chan protocol.Event, h.bufSize)
	h.mu.Lock()
	h.subscribers[ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		if _, ok := h.subscribers[ch]; !ok {
			h.mu.Unlock()
			return // already canceled
		}
		delete(h.subscribers, ch)
		h.mu.Unlock()
	}
	return ch, cancel
}

// Publish sends ev to all current subscribers. It never blocks the caller.
// If a subscriber's channel is full, the event is dropped for that subscriber.
func (h *Hub) Publish(ev protocol.Event) {
	h.mu.RLock()
	// copy under lock to avoid holding during sends
	subs := make([]chan protocol.Event, 0, len(h.subscribers))
	for ch := range h.subscribers {
		subs = append(subs, ch)
	}
	h.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- ev:
		default:
			// drop to slow consumer
		}
	}
}

// Len returns current subscriber count (for tests/observability).
func (h *Hub) Len() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subscribers)
}
