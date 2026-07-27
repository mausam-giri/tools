package shortener

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"time"

	_ "github.com/tursodatabase/libsql-client-go/libsql"
)

const (
	DefaultTTL     = 3 * 24 * time.Hour
	MinTTL         = time.Minute
	MaxTTL         = 30 * 24 * time.Hour
	MaxActiveLinks = 10
	codeLen        = 7
	alphabet       = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrExpired   = errors.New("expired")
	ErrBadURL    = errors.New("invalid url")
	ErrBadTTL    = errors.New("invalid ttl")
	ErrLimit     = errors.New("link limit reached")
	ErrForbidden = errors.New("forbidden")
	ErrBadAnon   = errors.New("invalid anonymous id")

	anonIDRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,64}$`)
)

// Link is a stored short URL.
type Link struct {
	Code      string    `json:"code"`
	URL       string    `json:"url"`
	OwnerID   string    `json:"-"`
	IP        string    `json:"-"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Store is a Turso (libSQL/SQLite) backed link store.
type Store struct {
	db *sql.DB
}

// Open connects to Turso using the database URL and auth token.
func Open(dbURL, token string) (*Store, error) {
	dbURL = strings.TrimSpace(dbURL)
	token = strings.TrimSpace(token)
	if dbURL == "" || token == "" {
		return nil, fmt.Errorf("TURSO_DB_URL and TURSO_TOKEN are required")
	}

	// Turso accepts libsql://… or https://… with authToken query param.
	u, err := url.Parse(dbURL)
	if err != nil {
		return nil, fmt.Errorf("invalid TURSO_DB_URL: %w", err)
	}
	q := u.Query()
	q.Set("authToken", token)
	u.RawQuery = q.Encode()

	db, err := sql.Open("libsql", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("turso ping: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) migrate() error {
	// Create shortener table (SQLite-compatible schema on Turso).
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
)`,
		`CREATE INDEX IF NOT EXISTS idx_links_expires ON links(expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_id, expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_links_ip ON links(ip, expires_at)`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

// Close closes the database.
func (s *Store) Close() error {
	return s.db.Close()
}

// ValidAnonID reports whether id is a usable anonymous device id.
func ValidAnonID(id string) bool {
	return anonIDRe.MatchString(id)
}

// CountActiveByOwner returns non-expired links for an owner.
func (s *Store) CountActiveByOwner(ownerID string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM links WHERE owner_id = ? AND expires_at > ?`,
		ownerID, time.Now().UTC().Unix(),
	).Scan(&n)
	return n, err
}

// CountActiveByIP returns non-expired links for an IP.
func (s *Store) CountActiveByIP(ip string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM links WHERE ip = ? AND expires_at > ?`,
		ip, time.Now().UTC().Unix(),
	).Scan(&n)
	return n, err
}

// Create inserts a new short link owned by anonID from ip.
func (s *Store) Create(rawURL string, ttl time.Duration, ownerID, ip string) (*Link, error) {
	if !ValidAnonID(ownerID) {
		return nil, ErrBadAnon
	}
	target, err := normalizeURL(rawURL)
	if err != nil {
		return nil, err
	}
	if ttl < MinTTL || ttl > MaxTTL {
		return nil, ErrBadTTL
	}

	ownerN, err := s.CountActiveByOwner(ownerID)
	if err != nil {
		return nil, err
	}
	if ownerN >= MaxActiveLinks {
		return nil, ErrLimit
	}
	ipN, err := s.CountActiveByIP(ip)
	if err != nil {
		return nil, err
	}
	if ipN >= MaxActiveLinks {
		return nil, ErrLimit
	}

	now := time.Now().UTC()
	exp := now.Add(ttl)

	var code string
	for i := 0; i < 8; i++ {
		code, err = randomCode(codeLen)
		if err != nil {
			return nil, err
		}
		_, err = s.db.Exec(
			`INSERT INTO links(code, url, created_at, expires_at, owner_id, ip) VALUES(?,?,?,?,?,?)`,
			code, target, now.Unix(), exp.Unix(), ownerID, ip,
		)
		if err == nil {
			return &Link{
				Code: code, URL: target, OwnerID: ownerID, IP: ip,
				CreatedAt: now, ExpiresAt: exp,
			}, nil
		}
		if !strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, err
		}
	}
	return nil, fmt.Errorf("could not allocate short code")
}

// ListByOwner returns active links for an anonymous owner (newest first).
func (s *Store) ListByOwner(ownerID string) ([]Link, error) {
	if !ValidAnonID(ownerID) {
		return nil, ErrBadAnon
	}
	now := time.Now().UTC().Unix()
	rows, err := s.db.Query(
		`SELECT code, url, created_at, expires_at FROM links
		 WHERE owner_id = ? AND expires_at > ?
		 ORDER BY created_at DESC`,
		ownerID, now,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Link, 0, MaxActiveLinks)
	for rows.Next() {
		var l Link
		var cAt, eAt int64
		if err := rows.Scan(&l.Code, &l.URL, &cAt, &eAt); err != nil {
			return nil, err
		}
		l.CreatedAt = time.Unix(cAt, 0).UTC()
		l.ExpiresAt = time.Unix(eAt, 0).UTC()
		out = append(out, l)
	}
	return out, rows.Err()
}

// DeleteOwned removes a link if it belongs to ownerID.
func (s *Store) DeleteOwned(code, ownerID string) error {
	if !ValidAnonID(ownerID) {
		return ErrBadAnon
	}
	res, err := s.db.Exec(
		`DELETE FROM links WHERE code = ? AND owner_id = ?`,
		code, ownerID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Resolve returns the destination URL for a live code.
func (s *Store) Resolve(code string) (string, error) {
	code = strings.TrimSpace(code)
	if code == "" || strings.ContainsAny(code, "/.?#") {
		return "", ErrNotFound
	}

	var dest string
	var exp int64
	err := s.db.QueryRow(
		`SELECT url, expires_at FROM links WHERE code = ?`, code,
	).Scan(&dest, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if time.Now().UTC().Unix() >= exp {
		_, _ = s.db.Exec(`DELETE FROM links WHERE code = ?`, code)
		return "", ErrExpired
	}
	return dest, nil
}

// PurgeExpired deletes expired rows. Returns rows affected.
func (s *Store) PurgeExpired() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM links WHERE expires_at <= ?`, time.Now().UTC().Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func normalizeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ErrBadURL
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.ParseRequestURI(raw)
	if err != nil {
		return "", ErrBadURL
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", ErrBadURL
	}
	if u.Host == "" {
		return "", ErrBadURL
	}
	return u.String(), nil
}

func randomCode(n int) (string, error) {
	b := make([]byte, n)
	max := big.NewInt(int64(len(alphabet)))
	for i := range b {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b[i] = alphabet[v.Int64()]
	}
	return string(b), nil
}

// ParseTTL builds a duration from preset or custom fields.
func ParseTTL(preset string, days, hours, mins int) (time.Duration, error) {
	switch strings.TrimSpace(preset) {
	case "", "3d":
		return DefaultTTL, nil
	case "15m":
		return 15 * time.Minute, nil
	case "30m":
		return 30 * time.Minute, nil
	case "1h":
		return time.Hour, nil
	case "3h":
		return 3 * time.Hour, nil
	case "12h":
		return 12 * time.Hour, nil
	case "1d":
		return 24 * time.Hour, nil
	case "custom":
		if days < 0 || hours < 0 || mins < 0 {
			return 0, ErrBadTTL
		}
		ttl := time.Duration(days)*24*time.Hour +
			time.Duration(hours)*time.Hour +
			time.Duration(mins)*time.Minute
		if ttl < MinTTL || ttl > MaxTTL {
			return 0, ErrBadTTL
		}
		return ttl, nil
	default:
		return 0, ErrBadTTL
	}
}
