package store

import (
	"sort"

	"github.com/agents-arena/agents-arena/protocol"
)

// leaderRow is one per-player contribution from a finished match, used to
// aggregate leaderboards for both the mem and sqlite stores.
type leaderRow struct {
	Name         string
	Model        string
	Outcome      string // "win" | "loss" | "draw" | ""
	Method       string
	Moves        int
	TotalThinkMs int64
}

// competitorKey groups leaderboard rows by name+model.
func competitorKey(name, model string) string {
	return name + "|" + model
}

// outcomeForSeat derives win/loss/draw (or "") for a seat from a match result.
func outcomeForSeat(result *protocol.GameResult, seat string) string {
	if result == nil {
		return ""
	}
	switch result.Kind {
	case protocol.ResultWin:
		if result.Winner == seat {
			return "win"
		}
		return "loss"
	case protocol.ResultDraw:
		return "draw"
	default:
		return ""
	}
}

// aggregateLeaderboard folds per-player rows into ranked LeaderRows.
// Sort: Wins desc, then Games desc, then Name asc.
func aggregateLeaderboard(rows []leaderRow) []protocol.LeaderRow {
	type agg struct {
		name, model      string
		games            int
		wins, losses     int
		draws            int
		totalThinkMs     int64
		totalMoves       int
		methodCounts     map[string]int
	}
	byKey := make(map[string]*agg)

	for _, r := range rows {
		// Only count matches with a concrete outcome (skip incomplete / unknown).
		if r.Outcome != "win" && r.Outcome != "loss" && r.Outcome != "draw" {
			continue
		}
		key := competitorKey(r.Name, r.Model)
		a, ok := byKey[key]
		if !ok {
			a = &agg{
				name:         r.Name,
				model:        r.Model,
				methodCounts: make(map[string]int),
			}
			byKey[key] = a
		}
		a.games++
		switch r.Outcome {
		case "win":
			a.wins++
		case "loss":
			a.losses++
		case "draw":
			a.draws++
		}
		a.totalThinkMs += r.TotalThinkMs
		a.totalMoves += r.Moves
		if r.Method != "" {
			a.methodCounts[r.Method]++
		}
	}

	out := make([]protocol.LeaderRow, 0, len(byKey))
	for _, a := range byKey {
		row := protocol.LeaderRow{
			Name:   a.name,
			Model:  a.model,
			Games:  a.games,
			Wins:   a.wins,
			Losses: a.losses,
			Draws:  a.draws,
		}
		if a.totalMoves > 0 {
			row.AvgThinkMs = a.totalThinkMs / int64(a.totalMoves)
		}
		row.TopMethod = topMethod(a.methodCounts)
		out = append(out, row)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Wins != out[j].Wins {
			return out[i].Wins > out[j].Wins
		}
		if out[i].Games != out[j].Games {
			return out[i].Games > out[j].Games
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// topMethod returns the most common method; ties broken by lexical order.
func topMethod(counts map[string]int) string {
	if len(counts) == 0 {
		return ""
	}
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

// clampListLimit applies default 50 / cap 200 for ListMatches.
func clampListLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 200 {
		return 200
	}
	return limit
}

// summaryFromArchive builds a MatchSummary from a stored archive.
func summaryFromArchive(m MatchArchive) protocol.MatchSummary {
	return protocol.MatchSummary{
		Room:       m.Room,
		GameID:     m.GameID,
		Reasoning:  m.Reasoning,
		StartedAt:  m.StartedAt,
		EndedAt:    m.EndedAt,
		DurationMs: m.EndedAt - m.StartedAt,
		Result:     m.Report.Result,
		Players:    m.Report.Players,
		MoveCount:  len(m.Report.Moves),
		Comments:   len(m.Comments),
	}
}

// leaderRowsFromReport extracts per-player aggregation rows from a match report.
func leaderRowsFromReport(rep protocol.MatchReport) []leaderRow {
	if rep.Result == nil {
		return nil
	}
	// Only count finished results with win/draw kinds.
	if rep.Result.Kind != protocol.ResultWin && rep.Result.Kind != protocol.ResultDraw {
		return nil
	}
	out := make([]leaderRow, 0, len(rep.Players))
	for _, p := range rep.Players {
		out = append(out, leaderRow{
			Name:         p.Name,
			Model:        p.Model,
			Outcome:      outcomeForSeat(rep.Result, p.Seat),
			Method:       p.Method,
			Moves:        p.Moves,
			TotalThinkMs: p.TotalThinkMs,
		})
	}
	return out
}
