//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/agents-arena/agents-arena/rules/spec"
	_ "github.com/agents-arena/agents-arena/rules/games/tictactoe"
)

const errPrefix = "__ERR__:"

func jsErr(msg string) string {
	return errPrefix + msg
}

func getRules(gameID string) (spec.Rules, string) {
	if gameID == "" {
		return nil, jsErr("gameId is required")
	}
	r, ok := spec.Get(gameID)
	if !ok {
		return nil, jsErr("unknown game: " + gameID)
	}
	return r, ""
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func parseState(r spec.Rules, stateJSON string) (any, string) {
	if stateJSON == "" {
		return nil, jsErr("state is required")
	}
	st, err := r.Deserialize(json.RawMessage(stateJSON))
	if err != nil {
		return nil, jsErr("bad state JSON: " + err.Error())
	}
	return st, ""
}

func parseMove(moveJSON string) (json.RawMessage, string) {
	if moveJSON == "" {
		return nil, jsErr("move is required")
	}
	// validate it is valid JSON by roundtrip
	var tmp any
	if err := json.Unmarshal([]byte(moveJSON), &tmp); err != nil {
		return nil, jsErr("bad move JSON: " + err.Error())
	}
	return json.RawMessage(moveJSON), ""
}

func initFunc(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return jsErr("init requires gameId")
	}
	gameID := args[0].String()
	seed := ""
	if len(args) > 1 && !args[1].IsNull() && !args[1].IsUndefined() {
		seed = args[1].String()
	}
	r, errStr := getRules(gameID)
	if errStr != "" {
		return errStr
	}
	st := r.Init(seed)
	return string(r.Serialize(st))
}

func toMoveFunc(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return jsErr("toMove requires gameId and state")
	}
	gameID := args[0].String()
	stateJSON := args[1].String()
	r, errStr := getRules(gameID)
	if errStr != "" {
		return errStr
	}
	st, errStr := parseState(r, stateJSON)
	if errStr != "" {
		return errStr
	}
	return r.ToMove(st)
}

func validateFunc(this js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return jsErr("validate requires gameId, state, move, seat")
	}
	gameID := args[0].String()
	stateJSON := args[1].String()
	moveJSON := args[2].String()
	seat := args[3].String()

	r, errStr := getRules(gameID)
	if errStr != "" {
		return mustJSON(map[string]any{"ok": false, "reason": errStr[len(errPrefix):]})
	}
	st, errStr := parseState(r, stateJSON)
	if errStr != "" {
		return mustJSON(map[string]any{"ok": false, "reason": errStr[len(errPrefix):]})
	}
	mv, errStr := parseMove(moveJSON)
	if errStr != "" {
		return mustJSON(map[string]any{"ok": false, "reason": errStr[len(errPrefix):]})
	}

	valErr := r.Validate(st, mv, seat)
	if valErr != nil {
		return mustJSON(map[string]any{"ok": false, "reason": valErr.Error()})
	}
	return mustJSON(map[string]any{"ok": true, "reason": ""})
}

func applyFunc(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return jsErr("apply requires gameId, state, move")
	}
	gameID := args[0].String()
	stateJSON := args[1].String()
	moveJSON := args[2].String()

	r, errStr := getRules(gameID)
	if errStr != "" {
		return errStr
	}
	st, errStr := parseState(r, stateJSON)
	if errStr != "" {
		return errStr
	}
	mv, errStr := parseMove(moveJSON)
	if errStr != "" {
		return errStr
	}

	after := r.Apply(st, mv)
	return string(r.Serialize(after))
}

func legalMovesFunc(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return jsErr("legalMoves requires gameId and state")
	}
	gameID := args[0].String()
	stateJSON := args[1].String()

	r, errStr := getRules(gameID)
	if errStr != "" {
		return errStr
	}
	st, errStr := parseState(r, stateJSON)
	if errStr != "" {
		return errStr
	}

	moves := r.LegalMoves(st)
	// moves are already []json.RawMessage which are JSON strings/bytes
	// return as JSON array string
	out, _ := json.Marshal(moves) // since RawMessage are valid, this produces array of objects
	return string(out)
}

func terminalFunc(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return jsErr("terminal requires gameId and state")
	}
	gameID := args[0].String()
	stateJSON := args[1].String()

	r, errStr := getRules(gameID)
	if errStr != "" {
		return errStr
	}
	st, errStr := parseState(r, stateJSON)
	if errStr != "" {
		return errStr
	}

	res := r.Terminal(st)
	if res == nil {
		return "null"
	}
	return mustJSON(res)
}

func main() {
	arenaRules := js.Global().Get("Object").New()

	arenaRules.Set("init", js.FuncOf(initFunc))
	arenaRules.Set("toMove", js.FuncOf(toMoveFunc))
	arenaRules.Set("validate", js.FuncOf(validateFunc))
	arenaRules.Set("apply", js.FuncOf(applyFunc))
	arenaRules.Set("legalMoves", js.FuncOf(legalMovesFunc))
	arenaRules.Set("terminal", js.FuncOf(terminalFunc))

	js.Global().Set("arenaRules", arenaRules)

	// Keep the WASM instance alive
	select {}
}
