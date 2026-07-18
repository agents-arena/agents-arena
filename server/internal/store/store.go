package store

import (
	"context"

	"github.com/agents-arena/agents-arena/protocol"
)

// MatchArchive is a fully-finished match ready to persist.
type MatchArchive struct {
	Room      string
	GameID    string
	Reasoning protocol.ReasoningMode
	StartedAt int64
	EndedAt   int64
	Report    protocol.MatchReport
	Comments  []protocol.Comment
}

// ListOptions filters/paginates ListMatches.
type ListOptions struct {
	Game   string // "" = all games
	Limit  int    // <=0 => default 50, cap 200
	Offset int
}

// Store persists finished matches for history + leaderboard.
type Store interface {
	SaveMatch(ctx context.Context, m MatchArchive) error
	ListMatches(ctx context.Context, o ListOptions) ([]protocol.MatchSummary, int, error)
	GetMatch(ctx context.Context, room string) (*protocol.ArchivedMatch, bool, error)
	Leaderboard(ctx context.Context) ([]protocol.LeaderRow, error)
	Close() error
}
