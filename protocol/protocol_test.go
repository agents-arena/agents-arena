package protocol

import (
	"encoding/json"
	"testing"
)

func TestEmotionValid(t *testing.T) {
	tests := []struct {
		emotion Emotion
		want   bool
	}{
		{EmotionNeutral, true},
		{EmotionThinking, true},
		{EmotionHappy, true},
		{EmotionConfident, true},
		{EmotionSmug, true},
		{EmotionNervous, true},
		{EmotionWorried, true},
		{EmotionSurprised, true},
		{EmotionShocked, true},
		{EmotionSad, true},
		{EmotionCrying, true},
		{EmotionAngry, true},
		{EmotionCelebrating, true},
		{EmotionDefeated, true},
		{EmotionMischievous, true},
		{EmotionSweating, true},
		{"bogus", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(string(tt.emotion), func(t *testing.T) {
			if got := tt.emotion.Valid(); got != tt.want {
				t.Errorf("Emotion(%q).Valid() = %v, want %v", tt.emotion, got, tt.want)
			}
		})
	}
}

func TestGameResultNilPointerMarshalsNull(t *testing.T) {
	var gr *GameResult = nil
	data, err := json.Marshal(gr)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "null" {
		t.Errorf("nil *GameResult marshaled to %s, want null", data)
	}
}

func TestGameResultPointerSetMarshalsObject(t *testing.T) {
	gr := &GameResult{Kind: ResultDraw}
	data, err := json.Marshal(gr)
	if err != nil {
		t.Fatal(err)
	}
	var got GameResult
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Kind != ResultDraw {
		t.Errorf("Kind = %q, want %q", got.Kind, ResultDraw)
	}
}

func TestMarshalCamelCase(t *testing.T) {
	tests := []struct {
		name string
		v    any
		want map[string]bool
	}{
		{
			name: "MoveMeta",
			v:    MoveMeta{Model: "gpt", TokensIn: 1},
			want: map[string]bool{"model": true, "tokensIn": true},
		},
		{
			name: "GameResult",
			v:    GameResult{Kind: "win", Winner: "white"},
			want: map[string]bool{"kind": true, "winner": true},
		},
		{
			name: "Player",
			v:    Player{Seat: "white", Connected: true},
			want: map[string]bool{"seat": true, "connected": true},
		},
		{
			name: "Snapshot",
			v: Snapshot{
				Rev:    1,
				GameID: "g1",
				State:  json.RawMessage(`{}`),
				Result: nil,
				Players: []Player{
					{Seat: "white", Connected: true},
				},
			},
			want: map[string]bool{"rev": true, "gameId": true, "state": true, "result": true, "players": true},
		},
		{
			name: "Emote",
			v:    Emote{Seat: "white", Emotion: EmotionHappy, Ts: 1000},
			want: map[string]bool{"seat": true, "emotion": true, "ts": true},
		},
		{
			name: "MoveRecord",
			v:    MoveRecord{Ply: 0, Seat: "white", Move: json.RawMessage(`"e4"`), Rev: 1, TurnStartedAt: 100, AppliedAt: 200, ThinkMs: 100},
			want: map[string]bool{"ply": true, "seat": true, "move": true, "rev": true, "turnStartedAt": true, "appliedAt": true, "thinkMs": true},
		},
		{
			name: "PlayerReport",
			v:    PlayerReport{Seat: "white", Moves: 10, TotalThinkMs: 5000, AvgThinkMs: 500, Rejected: 1},
			want: map[string]bool{"seat": true, "moves": true, "totalThinkMs": true, "avgThinkMs": true, "rejected": true},
		},
		{
			name: "MatchReport",
			v: MatchReport{
				ProtocolV:   3,
				GameID:      "g1",
				Room:        "r1",
				StartedAt:   100,
				Result:      nil,
				GeneratedAt: 200,
			},
			want: map[string]bool{"protocolV": true, "gameId": true, "room": true, "startedAt": true, "result": true, "generatedAt": true},
		},
		{
			name: "CreateRoomRequest",
			v:    CreateRoomRequest{Game: "chess", Name: "Test"},
			want: map[string]bool{"game": true, "name": true},
		},
		{
			name: "CreateRoomResponse",
			v:    CreateRoomResponse{RoomID: "r1", Token: "t1", Role: RoleHost, Snapshot: Snapshot{Rev: 0, GameID: "g1", State: json.RawMessage(`{}`), Result: nil}},
			want: map[string]bool{"roomId": true, "token": true, "role": true, "snapshot": true},
		},
		{
			name: "JoinRequest",
			v:    JoinRequest{DesiredRole: RoleGuest},
			want: map[string]bool{"desiredRole": true},
		},
		{
			name: "JoinResponse",
			v:    JoinResponse{Token: "t1", Role: RoleGuest, Snapshot: Snapshot{Rev: 0, GameID: "g1", State: json.RawMessage(`{}`), Result: nil}},
			want: map[string]bool{"token": true, "role": true, "snapshot": true},
		},
		{
			name: "MoveRequest",
			v:    MoveRequest{Move: json.RawMessage(`"e4"`)},
			want: map[string]bool{"move": true},
		},
		{
			name: "MoveAck",
			v:    MoveAck{OK: true, Rev: 1},
			want: map[string]bool{"ok": true, "rev": true},
		},
		{
			name: "EmoteRequest",
			v:    EmoteRequest{Emotion: EmotionHappy},
			want: map[string]bool{"emotion": true},
		},
		{
			name: "Event",
			v:    Event{Type: "snapshot"},
			want: map[string]bool{"type": true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.v)
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err := json.Unmarshal(data, &obj); err != nil {
				t.Fatal(err)
			}
			for key := range tt.want {
				if _, ok := obj[key]; !ok {
					t.Errorf("expected key %q not found in JSON: %s", key, data)
				}
			}
		})
	}
}

func TestOmitemptyDropsZeroValues(t *testing.T) {
	tests := []struct {
		name      string
		v         any
		absentKeys []string
	}{
		{
			name:      "MoveMeta empty",
			v:         MoveMeta{},
			absentKeys: []string{"model", "tokensIn", "tokensOut", "latencyMs", "note"},
		},
		{
			name:      "GameResult draw",
			v:         GameResult{Kind: "draw"},
			absentKeys: []string{"winner", "reason"},
		},
		{
			name:      "Player minimal",
			v:         Player{Seat: "white", Connected: false},
			absentKeys: []string{"name", "model"},
		},
		{
			name:      "Snapshot no toMove",
			v:         Snapshot{Rev: 1, GameID: "g1", State: json.RawMessage(`{}`), Result: nil},
			absentKeys: []string{"toMove"},
		},
		{
			name:      "Emote no note",
			v:         Emote{Seat: "white", Emotion: EmotionHappy, Ts: 100},
			absentKeys: []string{"note"},
		},
		{
			name:      "MoveRecord no meta",
			v:         MoveRecord{Ply: 0, Seat: "white", Move: json.RawMessage(`"e4"`), Rev: 1},
			absentKeys: []string{"meta"},
		},
		{
			name:      "PlayerReport no tokens",
			v:         PlayerReport{Seat: "white", Moves: 1, TotalThinkMs: 100, AvgThinkMs: 100, Rejected: 0},
			absentKeys: []string{"name", "model", "tokensIn", "tokensOut"},
		},
		{
			name:      "MatchReport no endedAt/durationMs",
			v:         MatchReport{ProtocolV: 3, GameID: "g1", Room: "r1", StartedAt: 100, Result: nil, GeneratedAt: 200},
			absentKeys: []string{"endedAt", "durationMs"},
		},
		{
			name:      "CreateRoomRequest no name/model",
			v:         CreateRoomRequest{Game: "chess"},
			absentKeys: []string{"name", "model"},
		},
		{
			name:      "CreateRoomResponse no seat",
			v:         CreateRoomResponse{RoomID: "r1", Token: "t1", Role: RoleHost, Snapshot: Snapshot{Rev: 0, GameID: "g1", State: json.RawMessage(`{}`), Result: nil}},
			absentKeys: []string{"seat"},
		},
		{
			name:      "JoinRequest minimal",
			v:         JoinRequest{DesiredRole: RoleGuest},
			absentKeys: []string{"name", "model", "resumeToken"},
		},
		{
			name:      "JoinResponse no seat",
			v:         JoinResponse{Token: "t1", Role: RoleGuest, Snapshot: Snapshot{Rev: 0, GameID: "g1", State: json.RawMessage(`{}`), Result: nil}},
			absentKeys: []string{"seat"},
		},
		{
			name:      "MoveRequest no meta",
			v:         MoveRequest{Move: json.RawMessage(`"e4"`)},
			absentKeys: []string{"meta"},
		},
		{
			name:      "MoveAck minimal ok",
			v:         MoveAck{OK: true},
			absentKeys: []string{"reason", "rev"},
		},
		{
			name:      "MoveAck not ok",
			v:         MoveAck{OK: false, Reason: "illegal"},
			absentKeys: []string{"rev"},
		},
		{
			name:      "EmoteRequest no note",
			v:         EmoteRequest{Emotion: EmotionHappy},
			absentKeys: []string{"note"},
		},
		{
			name:      "Event snapshot only",
			v:         Event{Type: "snapshot"},
			absentKeys: []string{"snapshot", "emote", "report"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.v)
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err := json.Unmarshal(data, &obj); err != nil {
				t.Fatal(err)
			}
			for _, key := range tt.absentKeys {
				if _, ok := obj[key]; ok {
					t.Errorf("unexpected key %q present in JSON (should be omitempty'd): %s", key, data)
				}
			}
		})
	}
}

func TestRoundTrip(t *testing.T) {
	snapshot := Snapshot{
		Rev:    3,
		GameID: "game-1",
		State:  json.RawMessage(`{"board":[[0,1],[1,0]]}`),
		ToMove: "white",
		Result: nil,
		Players: []Player{
			{Seat: "white", Name: "Alice", Model: "gpt-4", Connected: true},
			{Seat: "black", Name: "Bob", Connected: false},
		},
	}

	result := &GameResult{Kind: ResultWin, Winner: "white", Reason: "checkmate"}

	tests := []struct {
		name string
		v    any
	}{
		{"MoveMeta", MoveMeta{Model: "grok", TokensIn: 500, TokensOut: 200, LatencyMs: 1234, Note: "best line"}},
		{"GameResult", GameResult{Kind: ResultWin, Winner: "white", Reason: "checkmate"}},
		{"Player", Player{Seat: "white", Name: "Alice", Model: "gpt-4", Connected: true}},
		{"Snapshot", snapshot},
		{"Snapshot with result", Snapshot{Rev: 5, GameID: "g2", State: json.RawMessage(`{}`), ToMove: "", Result: result, Players: nil}},
		{"Emote", Emote{Seat: "white", Emotion: EmotionConfident, Note: "I'm winning", Ts: 1700000000000}},
		{"MoveRecord", MoveRecord{Ply: 3, Seat: "black", Move: json.RawMessage(`"e5"`), Rev: 4, TurnStartedAt: 1000, AppliedAt: 2500, ThinkMs: 1500, Meta: &MoveMeta{Model: "gpt-4"}}},
		{"PlayerReport", PlayerReport{Seat: "white", Name: "Alice", Model: "gpt-4", Moves: 20, TotalThinkMs: 30000, AvgThinkMs: 1500, Rejected: 2, TokensIn: 10000, TokensOut: 4000}},
		{"MatchReport", MatchReport{ProtocolV: 3, GameID: "g1", Room: "r1", StartedAt: 100, EndedAt: 500, DurationMs: 400, Result: result, Players: []PlayerReport{}, Moves: []MoveRecord{}, GeneratedAt: 600}},
		{"CreateRoomRequest", CreateRoomRequest{Game: "chess", Name: "Test Room", Model: "gpt-4"}},
		{"CreateRoomResponse", CreateRoomResponse{RoomID: "r1", Token: "tok", Role: RoleHost, Seat: "white", Snapshot: snapshot}},
		{"JoinRequest", JoinRequest{DesiredRole: RoleGuest, Name: "Bob", Model: "claude", ResumeToken: "resume-tok"}},
		{"JoinResponse", JoinResponse{Token: "tok2", Role: RoleGuest, Seat: "black", Snapshot: snapshot}},
		{"MoveRequest", MoveRequest{Move: json.RawMessage(`"Nf3"`), Meta: &MoveMeta{Model: "gpt-4"}}},
		{"MoveAck ok", MoveAck{OK: true, Rev: 5}},
		{"MoveAck not ok", MoveAck{OK: false, Reason: "illegal move"}},
		{"EmoteRequest", EmoteRequest{Emotion: EmotionThinking, Note: "hmm..."}},
		{"Event snapshot", Event{Type: "snapshot", Snapshot: &snapshot}},
		{"Event emote", Event{Type: "emote", Emote: &Emote{Seat: "white", Emotion: EmotionHappy, Ts: 100}}},
		{"Event report", Event{Type: "report", Report: &MatchReport{ProtocolV: 3, GameID: "g1", Room: "r1", StartedAt: 100, Result: result, GeneratedAt: 200}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data1, err := json.Marshal(tt.v)
			if err != nil {
				t.Fatalf("first marshal: %v", err)
			}
			var obj map[string]any
			if err := json.Unmarshal(data1, &obj); err != nil {
				t.Fatalf("unmarshal to map: %v", err)
			}
			data2, err := json.Marshal(obj)
			if err != nil {
				t.Fatalf("second marshal: %v", err)
			}
			var obj2 map[string]any
			if err := json.Unmarshal(data2, &obj2); err != nil {
				t.Fatalf("unmarshal second: %v", err)
			}
			data3, err := json.Marshal(obj2)
			if err != nil {
				t.Fatalf("third marshal: %v", err)
			}
			if string(data2) != string(data3) {
				t.Errorf("round-trip mismatch:\n  first:  %s\n  second: %s", data2, data3)
			}
		})
	}
}
