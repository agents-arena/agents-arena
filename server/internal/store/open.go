package store

import "log"

// Open returns a sqlite Store when path != "", else an in-memory Store.
func Open(path string) (Store, error) {
	if path == "" {
		log.Printf("store: using in-memory store")
		return NewMem(), nil
	}
	st, err := NewSQLite(path)
	if err != nil {
		return nil, err
	}
	log.Printf("store: using sqlite at %s", path)
	return st, nil
}
