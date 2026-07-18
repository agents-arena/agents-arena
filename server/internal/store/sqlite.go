package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/agents-arena/agents-arena/protocol"
	_ "modernc.org/sqlite"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS matches (
  room        TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL,
  reasoning   TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  result_json TEXT,
  report_json TEXT NOT NULL,
  comments_json TEXT,
  move_count  INTEGER NOT NULL,
  comment_count INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_game  ON matches(game_id);

CREATE TABLE IF NOT EXISTS match_players (
  room    TEXT NOT NULL,
  seat    TEXT NOT NULL,
  name    TEXT,
  model   TEXT,
  method  TEXT,
  outcome TEXT,
  moves   INTEGER,
  total_think_ms INTEGER,
  PRIMARY KEY (room, seat)
);
CREATE INDEX IF NOT EXISTS idx_mp_name ON match_players(name);
`

type sqliteStore struct {
	db *sql.DB
}

// NewSQLite opens (or creates) a pure-Go SQLite store at path.
func NewSQLite(path string) (Store, error) {
	dsn := sqliteDSN(path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open sqlite: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: ping sqlite: %w", err)
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: create schema: %w", err)
	}
	return &sqliteStore{db: db}, nil
}

func sqliteDSN(path string) string {
	// Already a full DSN or special memory path.
	if path == ":memory:" {
		return "file:memdb?mode=memory&cache=shared&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	}
	if strings.HasPrefix(path, "file:") {
		if strings.Contains(path, "?") {
			return path
		}
		return path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	}
	return "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
}

func (s *sqliteStore) SaveMatch(ctx context.Context, m MatchArchive) error {
	reportJSON, err := json.Marshal(m.Report)
	if err != nil {
		return fmt.Errorf("store: marshal report: %w", err)
	}
	var commentsJSON []byte
	if m.Comments != nil {
		commentsJSON, err = json.Marshal(m.Comments)
		if err != nil {
			return fmt.Errorf("store: marshal comments: %w", err)
		}
	}
	var resultJSON []byte
	if m.Report.Result != nil {
		resultJSON, err = json.Marshal(m.Report.Result)
		if err != nil {
			return fmt.Errorf("store: marshal result: %w", err)
		}
	}
	duration := m.EndedAt - m.StartedAt
	updatedAt := time.Now().UnixMilli()
	moveCount := len(m.Report.Moves)
	commentCount := len(m.Comments)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.ExecContext(ctx, `
REPLACE INTO matches (
  room, game_id, reasoning, started_at, ended_at, duration_ms,
  result_json, report_json, comments_json, move_count, comment_count, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.Room, m.GameID, string(m.Reasoning), m.StartedAt, m.EndedAt, duration,
		nullableBytes(resultJSON), reportJSON, nullableBytes(commentsJSON),
		moveCount, commentCount, updatedAt,
	)
	if err != nil {
		return fmt.Errorf("store: replace match: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM match_players WHERE room = ?`, m.Room); err != nil {
		return fmt.Errorf("store: delete match_players: %w", err)
	}

	for _, p := range m.Report.Players {
		outcome := outcomeForSeat(m.Report.Result, p.Seat)
		_, err := tx.ExecContext(ctx, `
INSERT INTO match_players (room, seat, name, model, method, outcome, moves, total_think_ms)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			m.Room, p.Seat, p.Name, p.Model, p.Method, outcome, p.Moves, p.TotalThinkMs,
		)
		if err != nil {
			return fmt.Errorf("store: insert match_player: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit: %w", err)
	}
	return nil
}

func nullableBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

func (s *sqliteStore) ListMatches(ctx context.Context, o ListOptions) ([]protocol.MatchSummary, int, error) {
	limit := clampListLimit(o.Limit)
	offset := o.Offset
	if offset < 0 {
		offset = 0
	}

	var total int
	var countArgs []any
	countQ := `SELECT COUNT(*) FROM matches`
	if o.Game != "" {
		countQ += ` WHERE game_id = ?`
		countArgs = append(countArgs, o.Game)
	}
	if err := s.db.QueryRowContext(ctx, countQ, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("store: count matches: %w", err)
	}

	q := `SELECT room, game_id, reasoning, started_at, ended_at, duration_ms, result_json, report_json, comment_count, move_count
FROM matches`
	var args []any
	if o.Game != "" {
		q += ` WHERE game_id = ?`
		args = append(args, o.Game)
	}
	q += ` ORDER BY ended_at DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("store: list matches: %w", err)
	}
	defer rows.Close()

	out := make([]protocol.MatchSummary, 0)
	for rows.Next() {
		var (
			room, gameID, reasoning string
			startedAt, endedAt      int64
			durationMs              int64
			resultJSON, reportJSON  sql.NullString
			commentCount, moveCount int
		)
		if err := rows.Scan(
			&room, &gameID, &reasoning, &startedAt, &endedAt, &durationMs,
			&resultJSON, &reportJSON, &commentCount, &moveCount,
		); err != nil {
			return nil, 0, fmt.Errorf("store: scan match: %w", err)
		}
		var rep protocol.MatchReport
		if reportJSON.Valid && reportJSON.String != "" {
			if err := json.Unmarshal([]byte(reportJSON.String), &rep); err != nil {
				return nil, 0, fmt.Errorf("store: unmarshal report: %w", err)
			}
		}
		sum := protocol.MatchSummary{
			Room:       room,
			GameID:     gameID,
			Reasoning:  protocol.ReasoningMode(reasoning),
			StartedAt:  startedAt,
			EndedAt:    endedAt,
			DurationMs: durationMs,
			Result:     rep.Result,
			Players:    rep.Players,
			MoveCount:  moveCount,
			Comments:   commentCount,
		}
		// Prefer result from report; fall back to result_json if needed.
		if sum.Result == nil && resultJSON.Valid && resultJSON.String != "" {
			var gr protocol.GameResult
			if err := json.Unmarshal([]byte(resultJSON.String), &gr); err == nil {
				sum.Result = &gr
			}
		}
		out = append(out, sum)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("store: list rows: %w", err)
	}
	return out, total, nil
}

func (s *sqliteStore) GetMatch(ctx context.Context, room string) (*protocol.ArchivedMatch, bool, error) {
	var reportJSON, commentsJSON sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT report_json, comments_json FROM matches WHERE room = ?`, room,
	).Scan(&reportJSON, &commentsJSON)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("store: get match: %w", err)
	}

	var rep protocol.MatchReport
	if reportJSON.Valid && reportJSON.String != "" {
		if err := json.Unmarshal([]byte(reportJSON.String), &rep); err != nil {
			return nil, false, fmt.Errorf("store: unmarshal report: %w", err)
		}
	}
	var comments []protocol.Comment
	if commentsJSON.Valid && commentsJSON.String != "" {
		if err := json.Unmarshal([]byte(commentsJSON.String), &comments); err != nil {
			return nil, false, fmt.Errorf("store: unmarshal comments: %w", err)
		}
	}
	if comments == nil {
		comments = []protocol.Comment{}
	}
	return &protocol.ArchivedMatch{
		Report:   rep,
		Comments: comments,
	}, true, nil
}

func (s *sqliteStore) Leaderboard(ctx context.Context) ([]protocol.LeaderRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT name, model, outcome, method, moves, total_think_ms FROM match_players`,
	)
	if err != nil {
		return nil, fmt.Errorf("store: leaderboard query: %w", err)
	}
	defer rows.Close()

	var lr []leaderRow
	for rows.Next() {
		var (
			name, model, outcome, method sql.NullString
			moves                        int
			totalThinkMs                 int64
		)
		if err := rows.Scan(&name, &model, &outcome, &method, &moves, &totalThinkMs); err != nil {
			return nil, fmt.Errorf("store: scan leaderboard: %w", err)
		}
		lr = append(lr, leaderRow{
			Name:         name.String,
			Model:        model.String,
			Outcome:      outcome.String,
			Method:       method.String,
			Moves:        moves,
			TotalThinkMs: totalThinkMs,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: leaderboard rows: %w", err)
	}
	return aggregateLeaderboard(lr), nil
}

func (s *sqliteStore) Close() error {
	if s.db == nil {
		return nil
	}
	if err := s.db.Close(); err != nil {
		return fmt.Errorf("store: close: %w", err)
	}
	return nil
}
