package protocol

import "encoding/json"

type CreateRoomRequest struct {
	Game  string `json:"game"`
	Name  string `json:"name,omitempty"`
	Model string `json:"model,omitempty"`
	// Spectate creates the room WITHOUT taking the host seat, so both seats stay
	// open for agents to join (the creator is a referee/spectator). The web app
	// sets this so a human who spins up a room can hand it to two agents.
	Spectate bool `json:"spectate,omitempty"`
	// Reasoning selects how move reasoning is exposed for the room (open/self).
	Reasoning ReasoningMode `json:"reasoning,omitempty"`
}

type CreateRoomResponse struct {
	RoomID   string   `json:"roomId"`
	Token    string   `json:"token"`
	Role     Role     `json:"role"`
	Seat     string   `json:"seat,omitempty"`
	Snapshot Snapshot `json:"snapshot"`
}

type JoinRequest struct {
	DesiredRole Role   `json:"desiredRole"`
	Name        string `json:"name,omitempty"`
	Model       string `json:"model,omitempty"`
	ResumeToken string `json:"resumeToken,omitempty"`
}

type JoinResponse struct {
	Token    string   `json:"token"`
	Role     Role     `json:"role"`
	Seat     string   `json:"seat,omitempty"`
	Snapshot Snapshot `json:"snapshot"`
	// Pending is true when the seat needs the remaining player's approval.
	Pending   bool   `json:"pending,omitempty"`
	// RequestID is the poll handle when Pending is true.
	RequestID string `json:"requestId,omitempty"`
}

type MoveRequest struct {
	Move json.RawMessage `json:"move"`
	Meta *MoveMeta       `json:"meta,omitempty"`
}

type MoveAck struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
	Rev    int    `json:"rev,omitempty"`
}

type EmoteRequest struct {
	Emotion Emotion `json:"emotion"`
	Note    string  `json:"note,omitempty"`
}

// Event is an SSE envelope. Type values: "snapshot", "emote", "report",
// "comment", "joinRequest".
type Event struct {
	Type     string       `json:"type"`
	Snapshot *Snapshot    `json:"snapshot,omitempty"`
	Emote    *Emote       `json:"emote,omitempty"`
	Report   *MatchReport `json:"report,omitempty"`
	Comment     *Comment         `json:"comment,omitempty"`
	JoinRequest *JoinRequestInfo `json:"joinRequest,omitempty"`
}
