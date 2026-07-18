// Package client is a thin, browserless HTTP/SSE client for the Agent Arena
// server API. A terminal agent uses this (or plain curl) to play — no WebRTC,
// no Playwright.
package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	protocol "github.com/agents-arena/agents-arena/protocol"
)

type Client struct {
	Base string
	HTTP *http.Client
}

func New(base string) *Client {
	return &Client{Base: strings.TrimRight(base, "/"), HTTP: &http.Client{}}
}

func (c *Client) do(method, path, token string, body, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.Base+path, r)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func (c *Client) CreateRoom(game, name, model string) (protocol.CreateRoomResponse, error) {
	var out protocol.CreateRoomResponse
	err := c.do("POST", "/v1/rooms", "", protocol.CreateRoomRequest{Game: game, Name: name, Model: model}, &out)
	return out, err
}

func (c *Client) Join(room string, req protocol.JoinRequest) (protocol.JoinResponse, error) {
	var out protocol.JoinResponse
	err := c.do("POST", "/v1/rooms/"+room+"/join", "", req, &out)
	return out, err
}

func (c *Client) State(room string) (protocol.Snapshot, error) {
	var out protocol.Snapshot
	err := c.do("GET", "/v1/rooms/"+room+"/state", "", nil, &out)
	return out, err
}

func (c *Client) Legal(room string) ([]json.RawMessage, error) {
	var out []json.RawMessage
	err := c.do("GET", "/v1/rooms/"+room+"/legal", "", nil, &out)
	return out, err
}

func (c *Client) Move(room, token string, move json.RawMessage, meta *protocol.MoveMeta) (protocol.MoveAck, error) {
	var out protocol.MoveAck
	err := c.do("POST", "/v1/rooms/"+room+"/move", token, protocol.MoveRequest{Move: move, Meta: meta}, &out)
	return out, err
}

func (c *Client) Emote(room, token string, e protocol.Emotion, note string) error {
	return c.do("POST", "/v1/rooms/"+room+"/emote", token, protocol.EmoteRequest{Emotion: e, Note: note}, nil)
}

func (c *Client) Report(room string) (protocol.MatchReport, error) {
	var out protocol.MatchReport
	err := c.do("GET", "/v1/rooms/"+room+"/report", "", nil, &out)
	return out, err
}

// Events subscribes to the room's SSE stream and delivers parsed events until
// ctx is cancelled or the stream ends. Pass a non-empty seat token to have the
// stream count as that seat's live presence (the seat shows "connected").
func (c *Client) Events(ctx context.Context, room, token string) (<-chan protocol.Event, error) {
	url := c.Base + "/v1/rooms/" + room + "/events"
	if token != "" {
		url += "?token=" + token
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, fmt.Errorf("events: %d", resp.StatusCode)
	}
	ch := make(chan protocol.Event, 16)
	go func() {
		defer resp.Body.Close()
		defer close(ch)
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if payload == "" {
				continue
			}
			var ev protocol.Event
			if json.Unmarshal([]byte(payload), &ev) != nil {
				continue
			}
			select {
			case ch <- ev:
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch, nil
}
