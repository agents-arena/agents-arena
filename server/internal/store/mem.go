package store

import (
	"context"
	"sort"
	"sync"

	"github.com/agents-arena/agents-arena/protocol"
)

type memStore struct {
	mu      sync.Mutex
	matches map[string]MatchArchive // room -> archive
}

// NewMem returns a mutex-guarded in-memory Store.
func NewMem() Store {
	return &memStore{
		matches: make(map[string]MatchArchive),
	}
}

func (s *memStore) SaveMatch(_ context.Context, m MatchArchive) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Copy slices so later mutation of caller's data cannot affect storage.
	m.Comments = append([]protocol.Comment(nil), m.Comments...)
	if m.Report.Players != nil {
		m.Report.Players = append([]protocol.PlayerReport(nil), m.Report.Players...)
	}
	if m.Report.Moves != nil {
		m.Report.Moves = append([]protocol.MoveRecord(nil), m.Report.Moves...)
	}
	s.matches[m.Room] = m
	return nil
}

func (s *memStore) ListMatches(_ context.Context, o ListOptions) ([]protocol.MatchSummary, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	limit := clampListLimit(o.Limit)
	offset := o.Offset
	if offset < 0 {
		offset = 0
	}

	all := make([]MatchArchive, 0, len(s.matches))
	for _, m := range s.matches {
		if o.Game != "" && m.GameID != o.Game {
			continue
		}
		all = append(all, m)
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].EndedAt > all[j].EndedAt
	})
	total := len(all)
	if offset >= total {
		return []protocol.MatchSummary{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := all[offset:end]
	out := make([]protocol.MatchSummary, 0, len(page))
	for _, m := range page {
		out = append(out, summaryFromArchive(m))
	}
	return out, total, nil
}

func (s *memStore) GetMatch(_ context.Context, room string) (*protocol.ArchivedMatch, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.matches[room]
	if !ok {
		return nil, false, nil
	}
	// Non-nil slice so it marshals as [] not null (ArchivedMatch.Comments has no
	// omitempty and clients index it directly).
	comments := append([]protocol.Comment{}, m.Comments...)
	return &protocol.ArchivedMatch{
		Report:   m.Report,
		Comments: comments,
	}, true, nil
}

func (s *memStore) Leaderboard(_ context.Context) ([]protocol.LeaderRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var rows []leaderRow
	for _, m := range s.matches {
		rows = append(rows, leaderRowsFromReport(m.Report)...)
	}
	return aggregateLeaderboard(rows), nil
}

func (s *memStore) Close() error {
	return nil
}
