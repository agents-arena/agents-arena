package chess

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

// engineMove: Promotion is "" or one of "q","r","b","n".
type engineMove struct{ From, To, Promotion string }

// piece is empty when Color == "".
type piece struct {
	Color string // "white" | "black"
	Type  string // "p","n","b","r","q","k"
}

type position struct {
	board    [64]piece // index 0=a1 … 63=h8; empty when Color == ""
	turn     string
	castling int // bitmask: 1=K, 2=Q, 4=k, 8=q
	ep       int // en-passant target square index, or -1
	halfmove int
	fullmove int
}

const (
	castleK = 1
	castleQ = 2
	castlek = 4
	castleq = 8
)

const files = "abcdefgh"
const ranks = "12345678"

var promoTypes = []string{"q", "r", "b", "n"}

var knightDeltas = [8][2]int{
	{1, 2}, {2, 1}, {2, -1}, {1, -2},
	{-1, -2}, {-2, -1}, {-2, 1}, {-1, 2},
}

var kingDeltas = [8][2]int{
	{1, 0}, {1, 1}, {0, 1}, {-1, 1},
	{-1, 0}, {-1, -1}, {0, -1}, {1, -1},
}

var bishopDirs = [4][2]int{
	{1, 1}, {1, -1}, {-1, 1}, {-1, -1},
}

var rookDirs = [4][2]int{
	{1, 0}, {-1, 0}, {0, 1}, {0, -1},
}

// internalMove is the engine-internal move with board indices.
// kind: 'n' normal, 'c' capture, 'e' en passant, 'k' castle kingside, 'q' castle queenside
type internalMove struct {
	from, to  int
	promotion string
	kind      byte
	captured  piece
}

type undo struct {
	from, to  int
	piece     piece
	captured  piece
	promotion string
	kind      byte
	castling  int
	ep        int
	halfmove  int
	auxFrom   int
	auxTo     int
	auxPiece  piece
}

func fileOf(sq int) int { return sq & 7 }
func rankOf(sq int) int { return sq >> 3 }

func makeSq(file, rank int) int { return rank*8 + file }

func isOnBoard(file, rank int) bool {
	return file >= 0 && file <= 7 && rank >= 0 && rank <= 7
}

func sqToAlgebraic(sq int) string {
	return string(files[fileOf(sq)]) + string(ranks[rankOf(sq)])
}

func algebraicToSq(s string) int {
	if len(s) != 2 {
		return -1
	}
	f := strings.IndexByte(files, s[0])
	r := strings.IndexByte(ranks, s[1])
	if f < 0 || r < 0 {
		return -1
	}
	return makeSq(f, r)
}

func opposite(c string) string {
	if c == "white" {
		return "black"
	}
	return "white"
}

func (p piece) empty() bool { return p.Color == "" }

func findKing(board [64]piece, color string) int {
	for i := 0; i < 64; i++ {
		if board[i].Type == "k" && board[i].Color == color {
			return i
		}
	}
	return -1
}

func isAttackedBy(board [64]piece, sq int, byColor string) bool {
	f := fileOf(sq)
	r := rankOf(sq)

	// Pawns
	pawnDir := 1
	if byColor == "black" {
		pawnDir = -1
	}
	for _, df := range []int{-1, 1} {
		nf := f + df
		nr := r - pawnDir // square the pawn would attack FROM
		if isOnBoard(nf, nr) {
			p := board[makeSq(nf, nr)]
			if !p.empty() && p.Color == byColor && p.Type == "p" {
				return true
			}
		}
	}

	// Knights
	for _, d := range knightDeltas {
		nf, nr := f+d[0], r+d[1]
		if isOnBoard(nf, nr) {
			p := board[makeSq(nf, nr)]
			if !p.empty() && p.Color == byColor && p.Type == "n" {
				return true
			}
		}
	}

	// King
	for _, d := range kingDeltas {
		nf, nr := f+d[0], r+d[1]
		if isOnBoard(nf, nr) {
			p := board[makeSq(nf, nr)]
			if !p.empty() && p.Color == byColor && p.Type == "k" {
				return true
			}
		}
	}

	// Bishops / Queens (diagonals)
	for _, d := range bishopDirs {
		nf, nr := f+d[0], r+d[1]
		for isOnBoard(nf, nr) {
			p := board[makeSq(nf, nr)]
			if !p.empty() {
				if p.Color == byColor && (p.Type == "b" || p.Type == "q") {
					return true
				}
				break
			}
			nf += d[0]
			nr += d[1]
		}
	}

	// Rooks / Queens (orthogonals)
	for _, d := range rookDirs {
		nf, nr := f+d[0], r+d[1]
		for isOnBoard(nf, nr) {
			p := board[makeSq(nf, nr)]
			if !p.empty() {
				if p.Color == byColor && (p.Type == "r" || p.Type == "q") {
					return true
				}
				break
			}
			nf += d[0]
			nr += d[1]
		}
	}

	return false
}

func isInCheck(board [64]piece, color string) bool {
	ksq := findKing(board, color)
	if ksq < 0 {
		return false
	}
	return isAttackedBy(board, ksq, opposite(color))
}

func pushPromoOrQuiet(moves *[]internalMove, from, to int, isPromo bool, kind byte, captured piece) {
	if isPromo {
		for _, promo := range promoTypes {
			*moves = append(*moves, internalMove{from: from, to: to, promotion: promo, kind: kind, captured: captured})
		}
	} else {
		*moves = append(*moves, internalMove{from: from, to: to, kind: kind, captured: captured})
	}
}

func genSlider(moves *[]internalMove, board [64]piece, from, f, r int, dirs [4][2]int, them string) {
	for _, d := range dirs {
		nf, nr := f+d[0], r+d[1]
		for isOnBoard(nf, nr) {
			to := makeSq(nf, nr)
			target := board[to]
			if target.empty() {
				*moves = append(*moves, internalMove{from: from, to: to, kind: 'n'})
			} else {
				if target.Color == them {
					*moves = append(*moves, internalMove{from: from, to: to, kind: 'c', captured: target})
				}
				break
			}
			nf += d[0]
			nr += d[1]
		}
	}
}

func generatePseudoLegal(pos position) []internalMove {
	moves := make([]internalMove, 0, 64)
	board := pos.board
	us := pos.turn
	them := opposite(us)
	pawnDir := 1
	if us == "black" {
		pawnDir = -1
	}
	startRank := 1
	promoRank := 7
	if us == "black" {
		startRank = 6
		promoRank = 0
	}
	ep := pos.ep

	for sq := 0; sq < 64; sq++ {
		p := board[sq]
		if p.empty() || p.Color != us {
			continue
		}
		f := fileOf(sq)
		r := rankOf(sq)

		switch p.Type {
		case "p":
			// Single push
			nr := r + pawnDir
			if isOnBoard(f, nr) {
				to := makeSq(f, nr)
				if board[to].empty() {
					isPromo := nr == promoRank
					pushPromoOrQuiet(&moves, sq, to, isPromo, 'n', piece{})
					// Double push
					if r == startRank {
						nr2 := r + 2*pawnDir
						to2 := makeSq(f, nr2)
						if board[to2].empty() {
							moves = append(moves, internalMove{from: sq, to: to2, kind: 'n'})
						}
					}
				}
			}
			// Captures
			for _, df := range []int{-1, 1} {
				nf := f + df
				nrc := r + pawnDir
				if !isOnBoard(nf, nrc) {
					continue
				}
				to := makeSq(nf, nrc)
				target := board[to]
				if !target.empty() && target.Color == them {
					pushPromoOrQuiet(&moves, sq, to, nrc == promoRank, 'c', target)
				} else if to == ep && ep >= 0 {
					moves = append(moves, internalMove{from: sq, to: to, kind: 'e'})
				}
			}

		case "n":
			for _, d := range knightDeltas {
				nf, nr2 := f+d[0], r+d[1]
				if !isOnBoard(nf, nr2) {
					continue
				}
				to := makeSq(nf, nr2)
				target := board[to]
				if target.empty() {
					moves = append(moves, internalMove{from: sq, to: to, kind: 'n'})
				} else if target.Color == them {
					moves = append(moves, internalMove{from: sq, to: to, kind: 'c', captured: target})
				}
			}

		case "b":
			genSlider(&moves, board, sq, f, r, bishopDirs, them)

		case "r":
			genSlider(&moves, board, sq, f, r, rookDirs, them)

		case "q":
			genSlider(&moves, board, sq, f, r, bishopDirs, them)
			genSlider(&moves, board, sq, f, r, rookDirs, them)

		case "k":
			for _, d := range kingDeltas {
				nf, nr2 := f+d[0], r+d[1]
				if !isOnBoard(nf, nr2) {
					continue
				}
				to := makeSq(nf, nr2)
				target := board[to]
				if target.empty() {
					moves = append(moves, internalMove{from: sq, to: to, kind: 'n'})
				} else if target.Color == them {
					moves = append(moves, internalMove{from: sq, to: to, kind: 'c', captured: target})
				}
			}
			// Castling
			if us == "white" {
				if pos.castling&castleK != 0 &&
					board[5].empty() && board[6].empty() &&
					board[7].Type == "r" && board[7].Color == "white" {
					moves = append(moves, internalMove{from: 4, to: 6, kind: 'k'})
				}
				if pos.castling&castleQ != 0 &&
					board[1].empty() && board[2].empty() && board[3].empty() &&
					board[0].Type == "r" && board[0].Color == "white" {
					moves = append(moves, internalMove{from: 4, to: 2, kind: 'q'})
				}
			} else {
				if pos.castling&castlek != 0 &&
					board[61].empty() && board[62].empty() &&
					board[63].Type == "r" && board[63].Color == "black" {
					moves = append(moves, internalMove{from: 60, to: 62, kind: 'k'})
				}
				if pos.castling&castleq != 0 &&
					board[57].empty() && board[58].empty() && board[59].empty() &&
					board[56].Type == "r" && board[56].Color == "black" {
					moves = append(moves, internalMove{from: 60, to: 58, kind: 'q'})
				}
			}
		}
	}
	return moves
}

func doMove(pos *position, mv internalMove) undo {
	board := &pos.board
	p := board[mv.from]
	u := undo{
		from:      mv.from,
		to:        mv.to,
		piece:     p,
		captured:  piece{},
		promotion: mv.promotion,
		kind:      mv.kind,
		castling:  pos.castling,
		ep:        pos.ep,
		halfmove:  pos.halfmove,
		auxFrom:   -1,
		auxTo:     -1,
		auxPiece:  piece{},
	}

	// Clear EP by default; set later if double push
	pos.ep = -1

	// Halfmove clock
	if p.Type == "p" || mv.kind == 'c' || mv.kind == 'e' {
		pos.halfmove = 0
	} else {
		pos.halfmove++
	}

	if mv.kind == 'e' {
		// En passant: capture pawn behind target
		capSq := mv.to + 8
		if p.Color == "white" {
			capSq = mv.to - 8
		}
		u.captured = board[capSq]
		u.auxFrom = capSq
		board[capSq] = piece{}
		board[mv.to] = p
		board[mv.from] = piece{}
	} else if mv.kind == 'k' || mv.kind == 'q' {
		// Castling
		board[mv.from] = piece{}
		board[mv.to] = p
		isWhite := p.Color == "white"
		if mv.kind == 'k' {
			rookFrom, rookTo := 63, 61
			if isWhite {
				rookFrom, rookTo = 7, 5
			}
			rook := board[rookFrom]
			u.auxFrom = rookFrom
			u.auxTo = rookTo
			u.auxPiece = rook
			board[rookFrom] = piece{}
			board[rookTo] = rook
		} else {
			rookFrom, rookTo := 56, 59
			if isWhite {
				rookFrom, rookTo = 0, 3
			}
			rook := board[rookFrom]
			u.auxFrom = rookFrom
			u.auxTo = rookTo
			u.auxPiece = rook
			board[rookFrom] = piece{}
			board[rookTo] = rook
		}
	} else {
		// Normal / capture
		u.captured = board[mv.to]
		board[mv.from] = piece{}
		if mv.promotion != "" {
			board[mv.to] = piece{Color: p.Color, Type: mv.promotion}
		} else {
			board[mv.to] = p
		}
	}

	// Update castling rights
	cr := pos.castling
	if p.Type == "k" {
		if p.Color == "white" {
			cr &^= castleK | castleQ
		} else {
			cr &^= castlek | castleq
		}
	}
	if p.Type == "r" {
		if mv.from == 0 {
			cr &^= castleQ
		}
		if mv.from == 7 {
			cr &^= castleK
		}
		if mv.from == 56 {
			cr &^= castleq
		}
		if mv.from == 63 {
			cr &^= castlek
		}
	}
	capSqForRights := mv.to
	if mv.kind == 'e' {
		capSqForRights = u.auxFrom
	}
	if !u.captured.empty() && u.captured.Type == "r" {
		if capSqForRights == 0 {
			cr &^= castleQ
		}
		if capSqForRights == 7 {
			cr &^= castleK
		}
		if capSqForRights == 56 {
			cr &^= castleq
		}
		if capSqForRights == 63 {
			cr &^= castlek
		}
	}
	pos.castling = cr

	// Double pawn push → set EP
	if p.Type == "p" && mv.kind == 'n' && abs(rankOf(mv.to)-rankOf(mv.from)) == 2 {
		pos.ep = makeSq(fileOf(mv.from), (rankOf(mv.from)+rankOf(mv.to))/2)
	}

	// Fullmove
	if p.Color == "black" {
		pos.fullmove++
	}

	// Switch turn
	pos.turn = opposite(pos.turn)

	return u
}

func undoMove(pos *position, u undo) {
	board := &pos.board
	pos.turn = opposite(pos.turn)
	pos.castling = u.castling
	pos.ep = u.ep
	pos.halfmove = u.halfmove

	if u.piece.Color == "black" {
		pos.fullmove--
	}

	if u.kind == 'e' {
		board[u.from] = u.piece
		board[u.to] = piece{}
		board[u.auxFrom] = u.captured
	} else if u.kind == 'k' || u.kind == 'q' {
		board[u.to] = piece{}
		board[u.from] = u.piece
		board[u.auxTo] = piece{}
		board[u.auxFrom] = u.auxPiece
	} else {
		board[u.from] = u.piece
		board[u.to] = u.captured
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func isLegalMove(pos *position, mv internalMove) bool {
	// Castling: king not in check, not through check, not into check
	if mv.kind == 'k' || mv.kind == 'q' {
		them := opposite(pos.turn)
		kFrom := mv.from
		if isAttackedBy(pos.board, kFrom, them) {
			return false
		}
		if mv.kind == 'k' {
			through := kFrom + 1
			into := kFrom + 2
			if isAttackedBy(pos.board, through, them) {
				return false
			}
			if isAttackedBy(pos.board, into, them) {
				return false
			}
		} else {
			through := kFrom - 1
			into := kFrom - 2
			if isAttackedBy(pos.board, through, them) {
				return false
			}
			if isAttackedBy(pos.board, into, them) {
				return false
			}
		}
	}

	u := doMove(pos, mv)
	// After doMove, turn has flipped; check if OUR king (the side that moved) is safe
	mover := opposite(pos.turn)
	legal := !isInCheck(pos.board, mover)
	undoMove(pos, u)
	return legal
}

func generateLegal(pos *position) []internalMove {
	pseudo := generatePseudoLegal(*pos)
	legal := make([]internalMove, 0, len(pseudo))
	for _, mv := range pseudo {
		if isLegalMove(pos, mv) {
			legal = append(legal, mv)
		}
	}
	return legal
}

func fenCharToPiece(ch byte) (piece, bool) {
	switch ch {
	case 'P':
		return piece{Color: "white", Type: "p"}, true
	case 'N':
		return piece{Color: "white", Type: "n"}, true
	case 'B':
		return piece{Color: "white", Type: "b"}, true
	case 'R':
		return piece{Color: "white", Type: "r"}, true
	case 'Q':
		return piece{Color: "white", Type: "q"}, true
	case 'K':
		return piece{Color: "white", Type: "k"}, true
	case 'p':
		return piece{Color: "black", Type: "p"}, true
	case 'n':
		return piece{Color: "black", Type: "n"}, true
	case 'b':
		return piece{Color: "black", Type: "b"}, true
	case 'r':
		return piece{Color: "black", Type: "r"}, true
	case 'q':
		return piece{Color: "black", Type: "q"}, true
	case 'k':
		return piece{Color: "black", Type: "k"}, true
	default:
		return piece{}, false
	}
}

func pieceToFenChar(p piece) byte {
	ch := p.Type[0]
	if p.Color == "white" {
		return byte(unicode.ToUpper(rune(ch)))
	}
	return ch
}

func parseFEN(fen string) (position, error) {
	parts := strings.Fields(strings.TrimSpace(fen))
	if len(parts) < 4 || len(parts) > 6 {
		return position{}, fmt.Errorf("invalid fen: expected 4-6 fields, got %d", len(parts))
	}

	placement := parts[0]
	turnStr := parts[1]
	castlingStr := parts[2]
	epStr := parts[3]
	halfStr := "0"
	fullStr := "1"
	if len(parts) > 4 {
		halfStr = parts[4]
	}
	if len(parts) > 5 {
		fullStr = parts[5]
	}

	var pos position
	pos.ep = -1

	rankStrs := strings.Split(placement, "/")
	if len(rankStrs) != 8 {
		return position{}, errors.New("invalid fen: placement must have 8 ranks")
	}

	for rankIdx := 0; rankIdx < 8; rankIdx++ {
		rankStr := rankStrs[rankIdx]
		boardRank := 7 - rankIdx
		file := 0
		for i := 0; i < len(rankStr); i++ {
			ch := rankStr[i]
			if ch >= '1' && ch <= '8' {
				file += int(ch - '0')
			} else {
				p, ok := fenCharToPiece(ch)
				if !ok {
					return position{}, fmt.Errorf("invalid fen: unknown piece '%c'", ch)
				}
				if file > 7 {
					return position{}, errors.New("invalid fen: too many squares in rank")
				}
				pos.board[makeSq(file, boardRank)] = p
				file++
			}
		}
		if file != 8 {
			return position{}, errors.New("invalid fen: rank does not have 8 squares")
		}
	}

	if turnStr != "w" && turnStr != "b" {
		return position{}, fmt.Errorf("invalid fen: turn must be w or b, got '%s'", turnStr)
	}
	if turnStr == "w" {
		pos.turn = "white"
	} else {
		pos.turn = "black"
	}

	if castlingStr != "-" {
		for i := 0; i < len(castlingStr); i++ {
			switch castlingStr[i] {
			case 'K':
				pos.castling |= castleK
			case 'Q':
				pos.castling |= castleQ
			case 'k':
				pos.castling |= castlek
			case 'q':
				pos.castling |= castleq
			default:
				return position{}, fmt.Errorf("invalid fen: bad castling char '%c'", castlingStr[i])
			}
		}
	}

	if epStr != "-" {
		ep := algebraicToSq(epStr)
		if ep < 0 {
			return position{}, fmt.Errorf("invalid fen: bad en-passant square '%s'", epStr)
		}
		pos.ep = ep
	}

	halfmove, err := strconv.Atoi(halfStr)
	if err != nil || halfmove < 0 {
		return position{}, fmt.Errorf("invalid fen: bad halfmove '%s'", halfStr)
	}
	fullmove, err := strconv.Atoi(fullStr)
	if err != nil || fullmove < 1 {
		return position{}, fmt.Errorf("invalid fen: bad fullmove '%s'", fullStr)
	}
	pos.halfmove = halfmove
	pos.fullmove = fullmove

	return pos, nil
}

func toFEN(p position) string {
	var ranksOut []string
	for rankIdx := 0; rankIdx < 8; rankIdx++ {
		boardRank := 7 - rankIdx
		empty := 0
		var row strings.Builder
		for file := 0; file < 8; file++ {
			pc := p.board[makeSq(file, boardRank)]
			if pc.empty() {
				empty++
			} else {
				if empty > 0 {
					row.WriteByte(byte('0' + empty))
					empty = 0
				}
				row.WriteByte(pieceToFenChar(pc))
			}
		}
		if empty > 0 {
			row.WriteByte(byte('0' + empty))
		}
		ranksOut = append(ranksOut, row.String())
	}

	castling := ""
	if p.castling&castleK != 0 {
		castling += "K"
	}
	if p.castling&castleQ != 0 {
		castling += "Q"
	}
	if p.castling&castlek != 0 {
		castling += "k"
	}
	if p.castling&castleq != 0 {
		castling += "q"
	}
	if castling == "" {
		castling = "-"
	}

	ep := "-"
	if p.ep >= 0 {
		ep = sqToAlgebraic(p.ep)
	}
	turn := "w"
	if p.turn == "black" {
		turn = "b"
	}

	return fmt.Sprintf("%s %s %s %s %d %d",
		strings.Join(ranksOut, "/"), turn, castling, ep, p.halfmove, p.fullmove)
}

func positionKey(p position) string {
	fen := toFEN(p)
	parts := strings.Split(fen, " ")
	return parts[0] + " " + parts[1] + " " + parts[2] + " " + parts[3]
}

func turnOf(p position) string {
	return p.turn
}

func halfmoveClock(p position) int {
	return p.halfmove
}

func pieceAt(p position, sq string) (color, ptype string, ok bool) {
	i := algebraicToSq(sq)
	if i < 0 {
		return "", "", false
	}
	pc := p.board[i]
	if pc.empty() {
		return "", "", false
	}
	return pc.Color, pc.Type, true
}

func kingSquare(p position, color string) string {
	ksq := findKing(p.board, color)
	if ksq < 0 {
		panic("no " + color + " king on board")
	}
	return sqToAlgebraic(ksq)
}

func inCheck(p position) bool {
	return isInCheck(p.board, p.turn)
}

func internalToEngine(mv internalMove) engineMove {
	return engineMove{
		From:      sqToAlgebraic(mv.from),
		To:        sqToAlgebraic(mv.to),
		Promotion: mv.promotion,
	}
}

func engineToInternal(pos *position, mv engineMove) (internalMove, bool) {
	from := algebraicToSq(mv.From)
	to := algebraicToSq(mv.To)
	if from < 0 || to < 0 {
		return internalMove{}, false
	}
	legal := generateLegal(pos)
	for _, im := range legal {
		if im.from == from && im.to == to {
			if mv.Promotion != "" {
				if im.promotion == mv.Promotion {
					return im, true
				}
			} else if im.promotion == "" {
				return im, true
			}
		}
	}
	return internalMove{}, false
}

func legalMovesPos(p position) []engineMove {
	working := p
	legal := generateLegal(&working)
	out := make([]engineMove, len(legal))
	for i, mv := range legal {
		out[i] = internalToEngine(mv)
	}
	return out
}

func makeMove(p position, m engineMove) (position, error) {
	next := p
	im, ok := engineToInternal(&next, m)
	if !ok {
		return position{}, fmt.Errorf("illegal move: %s", moveToUCI(m))
	}
	doMove(&next, im)
	return next, nil
}

func isCheckmate(p position) bool {
	if !inCheck(p) {
		return false
	}
	working := p
	return len(generateLegal(&working)) == 0
}

func isStalemate(p position) bool {
	if inCheck(p) {
		return false
	}
	working := p
	return len(generateLegal(&working)) == 0
}

func insufficientMaterial(p position) bool {
	type nonKing struct {
		ptype string
		color string
		sq    int
	}
	var pieces []nonKing
	for i := 0; i < 64; i++ {
		pc := p.board[i]
		if !pc.empty() && pc.Type != "k" {
			pieces = append(pieces, nonKing{pc.Type, pc.Color, i})
		}
	}

	// K vs K
	if len(pieces) == 0 {
		return true
	}

	// K+B vs K or K+N vs K
	if len(pieces) == 1 {
		t := pieces[0].ptype
		return t == "b" || t == "n"
	}

	// K+B vs K+B, same square color
	if len(pieces) == 2 {
		a, b := pieces[0], pieces[1]
		if a.ptype == "b" && b.ptype == "b" && a.color != b.color {
			colorA := (fileOf(a.sq) + rankOf(a.sq)) % 2
			colorB := (fileOf(b.sq) + rankOf(b.sq)) % 2
			return colorA == colorB
		}
	}

	return false
}

func perft(p position, depth int) int64 {
	if depth == 0 {
		return 1
	}
	working := p
	return perftRec(&working, depth)
}

func perftRec(pos *position, depth int) int64 {
	moves := generateLegal(pos)
	if depth == 1 {
		return int64(len(moves))
	}
	var nodes int64
	for _, mv := range moves {
		u := doMove(pos, mv)
		nodes += perftRec(pos, depth-1)
		undoMove(pos, u)
	}
	return nodes
}

func moveToUCI(m engineMove) string {
	s := m.From + m.To
	if m.Promotion != "" {
		s += m.Promotion
	}
	return s
}

func uciToMove(uci string) (engineMove, error) {
	if len(uci) < 4 || len(uci) > 5 {
		return engineMove{}, fmt.Errorf("invalid uci: '%s'", uci)
	}
	from := uci[0:2]
	to := uci[2:4]
	if algebraicToSq(from) < 0 || algebraicToSq(to) < 0 {
		return engineMove{}, fmt.Errorf("invalid uci squares: '%s'", uci)
	}
	mv := engineMove{From: from, To: to}
	if len(uci) == 5 {
		p := string(uci[4])
		if p != "q" && p != "r" && p != "b" && p != "n" {
			return engineMove{}, fmt.Errorf("invalid uci promotion: '%s'", uci)
		}
		mv.Promotion = p
	}
	return mv, nil
}

var pieceLetter = map[string]string{
	"p": "",
	"n": "N",
	"b": "B",
	"r": "R",
	"q": "Q",
	"k": "K",
}

func moveToSAN(p position, m engineMove) string {
	working := p
	im, ok := engineToInternal(&working, m)
	if !ok {
		panic("illegal move for san: " + moveToUCI(m))
	}

	pc := p.board[im.from]
	var san string

	if im.kind == 'k' {
		san = "O-O"
	} else if im.kind == 'q' {
		san = "O-O-O"
	} else if pc.Type == "p" {
		isCapture := im.kind == 'c' || im.kind == 'e'
		if isCapture {
			san = string(files[fileOf(im.from)]) + "x" + sqToAlgebraic(im.to)
		} else {
			san = sqToAlgebraic(im.to)
		}
		if im.promotion != "" {
			san += "=" + strings.ToUpper(im.promotion)
		}
	} else {
		san = pieceLetter[pc.Type]
		// Disambiguation
		legal := generateLegal(&working)
		var others []internalMove
		for _, om := range legal {
			if om.to == im.to && om.from != im.from && om.promotion == im.promotion {
				op := p.board[om.from]
				if op.Type == pc.Type && op.Color == pc.Color {
					others = append(others, om)
				}
			}
		}
		if len(others) > 0 {
			sameFile := false
			sameRank := false
			for _, om := range others {
				if fileOf(om.from) == fileOf(im.from) {
					sameFile = true
				}
				if rankOf(om.from) == rankOf(im.from) {
					sameRank = true
				}
			}
			if !sameFile {
				san += string(files[fileOf(im.from)])
			} else if !sameRank {
				san += string(ranks[rankOf(im.from)])
			} else {
				san += sqToAlgebraic(im.from)
			}
		}
		isCapture := im.kind == 'c' || !p.board[im.to].empty()
		if isCapture {
			san += "x"
		}
		san += sqToAlgebraic(im.to)
	}

	// Apply move to check for check/mate
	next := p
	doMove(&next, im)
	if isInCheck(next.board, next.turn) {
		if len(generateLegal(&next)) == 0 {
			san += "#"
		} else {
			san += "+"
		}
	}

	return san
}
