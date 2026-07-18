package protocol

import "encoding/json"

const Version = 4

type Role string

const (
	RoleHost      Role = "host"
	RoleGuest     Role = "guest"
	RoleSpectator Role = "spectator"
	RoleCommenter Role = "commenter"
)

type Emotion string

const (
	EmotionNeutral      Emotion = "neutral"
	EmotionThinking     Emotion = "thinking"
	EmotionHappy        Emotion = "happy"
	EmotionConfident    Emotion = "confident"
	EmotionSmug         Emotion = "smug"
	EmotionNervous      Emotion = "nervous"
	EmotionWorried      Emotion = "worried"
	EmotionSurprised    Emotion = "surprised"
	EmotionShocked      Emotion = "shocked"
	EmotionSad          Emotion = "sad"
	EmotionCrying       Emotion = "crying"
	EmotionAngry        Emotion = "angry"
	EmotionCelebrating  Emotion = "celebrating"
	EmotionDefeated     Emotion = "defeated"
	EmotionMischievous  Emotion = "mischievous"
	EmotionSweating     Emotion = "sweating"
)

var validEmotions = map[Emotion]bool{
	EmotionNeutral:     true,
	EmotionThinking:    true,
	EmotionHappy:       true,
	EmotionConfident:   true,
	EmotionSmug:        true,
	EmotionNervous:     true,
	EmotionWorried:     true,
	EmotionSurprised:   true,
	EmotionShocked:     true,
	EmotionSad:         true,
	EmotionCrying:      true,
	EmotionAngry:       true,
	EmotionCelebrating: true,
	EmotionDefeated:    true,
	EmotionMischievous: true,
	EmotionSweating:    true,
}

func (e Emotion) Valid() bool {
	return validEmotions[e]
}

type MoveMeta struct {
	Model     string `json:"model,omitempty"`
	TokensIn  int    `json:"tokensIn,omitempty"`
	TokensOut int    `json:"tokensOut,omitempty"`
	LatencyMs int    `json:"latencyMs,omitempty"`
	Note      string `json:"note,omitempty"`
	// Method is the self-reported method of choosing this move:
	// "model", "engine", "human", "hybrid", or "" unreported.
	Method string `json:"method,omitempty"`
}

// ReasoningMode controls how move reasoning is exposed for a match.
type ReasoningMode string

const (
	ReasoningOpen ReasoningMode = "open"
	ReasoningSelf ReasoningMode = "self"
)

func (m ReasoningMode) Valid() bool {
	return m == ReasoningOpen || m == ReasoningSelf
}

// NormalizeReasoning returns ReasoningSelf when m is self; otherwise open
// (including empty/unspecified).
func NormalizeReasoning(m ReasoningMode) ReasoningMode {
	if m == ReasoningSelf {
		return ReasoningSelf
	}
	return ReasoningOpen
}

const (
	ResultWin  = "win"
	ResultDraw = "draw"
)

type GameResult struct {
	Kind   string `json:"kind"`
	Winner string `json:"winner,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type Player struct {
	Seat      string `json:"seat"`
	Name      string `json:"name,omitempty"`
	Model     string `json:"model,omitempty"`
	Connected bool   `json:"connected"`
	// Status is the live presence of the seat's occupant, for the UI dot:
	// "open" (no agent) | "connecting" (joined, no live stream yet) |
	// "connected" (holding a live event stream) | "lost" (was live, dropped).
	Status string `json:"status,omitempty"`
}

type Snapshot struct {
	Rev    int             `json:"rev"`
	GameID string          `json:"gameId"`
	State  json.RawMessage `json:"state"`
	ToMove string          `json:"toMove,omitempty"`
	Result *GameResult     `json:"result"`
	Players []Player       `json:"players"`
	// Hints are advisory engine hints for the side to move (nil/omitted when none).
	Hints []string `json:"hints,omitempty"`
	// Reasoning is how move reasoning is exposed for this match.
	Reasoning ReasoningMode `json:"reasoning,omitempty"`
}

type Emote struct {
	Seat    string  `json:"seat"`
	Emotion Emotion `json:"emotion"`
	Note    string  `json:"note,omitempty"`
	Ts      int64   `json:"ts"`
}

type MoveRecord struct {
	Ply           int             `json:"ply"`
	Seat          string          `json:"seat"`
	Move          json.RawMessage `json:"move"`
	Rev           int             `json:"rev"`
	TurnStartedAt int64           `json:"turnStartedAt"`
	AppliedAt     int64           `json:"appliedAt"`
	ThinkMs       int64           `json:"thinkMs"`
	Meta          *MoveMeta       `json:"meta,omitempty"`
}

// Comment represents a chat message from a player or commenter.
type Comment struct {
	Name string `json:"name"`
	Seat string `json:"seat,omitempty"`
	Role string `json:"role"`
	Text string `json:"text"`
	TS   int64  `json:"ts"`
}

// JoinRequestInfo is the payload for a pending seat-join request that needs
// the remaining seated player's approval.
type JoinRequestInfo struct {
	RequestID string `json:"requestId"`
	Name      string `json:"name"`
	Seat      string `json:"seat"`
	TS        int64  `json:"ts"`
}

type PlayerReport struct {
	Seat         string         `json:"seat"`
	Name         string         `json:"name,omitempty"`
	Model        string         `json:"model,omitempty"`
	Moves        int            `json:"moves"`
	TotalThinkMs int64          `json:"totalThinkMs"`
	AvgThinkMs   int64          `json:"avgThinkMs"`
	Rejected     int            `json:"rejected"`
	TokensIn     int            `json:"tokensIn,omitempty"`
	TokensOut    int            `json:"tokensOut,omitempty"`
	// Methods counts self-reported move methods for this player (e.g. "model", "engine").
	Methods map[string]int `json:"methods,omitempty"`
	// Method is a single dominant/self-reported method for this player when not broken down.
	Method string `json:"method,omitempty"`
}

type MatchReport struct {
	ProtocolV   int            `json:"protocolV"`
	GameID      string         `json:"gameId"`
	Room        string         `json:"room"`
	StartedAt   int64          `json:"startedAt"`
	EndedAt     int64          `json:"endedAt,omitempty"`
	DurationMs  int64          `json:"durationMs,omitempty"`
	Result      *GameResult    `json:"result"`
	Players     []PlayerReport `json:"players"`
	Moves       []MoveRecord   `json:"moves"`
	GeneratedAt int64          `json:"generatedAt"`
	// Reasoning is how move reasoning was exposed for this match.
	Reasoning ReasoningMode `json:"reasoning,omitempty"`
}

// MatchSummary is a compact archive/list entry for a finished match.
type MatchSummary struct {
	Room       string         `json:"room"`
	GameID     string         `json:"gameId"`
	Reasoning  ReasoningMode  `json:"reasoning,omitempty"`
	StartedAt  int64          `json:"startedAt"`
	EndedAt    int64          `json:"endedAt,omitempty"`
	DurationMs int64          `json:"durationMs,omitempty"`
	Result     *GameResult    `json:"result"`
	Players    []PlayerReport `json:"players"`
	MoveCount  int            `json:"moveCount"`
	Comments   int            `json:"comments"`
}

// ArchiveList is a paginated or bulk list of match summaries.
type ArchiveList struct {
	Matches []MatchSummary `json:"matches"`
	Total   int            `json:"total"`
}

// ArchivedMatch is a full archived match: report plus comments.
type ArchivedMatch struct {
	Report   MatchReport `json:"report"`
	Comments []Comment   `json:"comments"`
}

// LeaderRow is one leaderboard entry for a name/model.
type LeaderRow struct {
	Name       string `json:"name"`
	Model      string `json:"model,omitempty"`
	Games      int    `json:"games"`
	Wins       int    `json:"wins"`
	Losses     int    `json:"losses"`
	Draws      int    `json:"draws"`
	AvgThinkMs int64  `json:"avgThinkMs"`
	TopMethod  string `json:"topMethod,omitempty"`
}

// Leaderboard is a ranked list of leader rows.
type Leaderboard struct {
	Rows []LeaderRow `json:"rows"`
}
