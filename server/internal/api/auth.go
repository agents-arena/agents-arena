package api

import (
	"net/http"
	"strings"
)

// TokenFromRequest extracts a bearer token from either:
//
//	Authorization: Bearer <token>
//
// or query param ?token=<token>
//
// Returns the token (may be empty) and whether it was found via Authorization.
func TokenFromRequest(r *http.Request) (token string, fromHeader bool) {
	if ah := r.Header.Get("Authorization"); ah != "" {
		// case-insensitive "bearer "
		if strings.HasPrefix(strings.ToLower(ah), "bearer ") {
			tok := strings.TrimSpace(ah[len("Bearer "):])
			if tok != "" {
				return tok, true
			}
		}
	}
	if tok := r.URL.Query().Get("token"); tok != "" {
		return tok, false
	}
	return "", false
}
