package shortener

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

const anonHeader = "X-Anon-Id"
const anonCookie = "mg_ls_anon"

// Handler serves shorten + redirect APIs.
type Handler struct {
	Store  *Store
	Public string // optional public base URL for short links; empty = derive from request
}

type createRequest struct {
	URL    string `json:"url"`
	Preset string `json:"preset"`
	Days   int    `json:"days"`
	Hours  int    `json:"hours"`
	Mins   int    `json:"mins"`
}

type createResponse struct {
	Code       string    `json:"code"`
	ShortURL   string    `json:"short_url"`
	URL        string    `json:"url"`
	CreatedAt  time.Time `json:"created_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	TTLSeconds int64     `json:"ttl_seconds"`
	Used       int       `json:"used"`
	Limit      int       `json:"limit"`
}

type linkDTO struct {
	Code      string    `json:"code"`
	ShortURL  string    `json:"short_url"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type mineResponse struct {
	Links []linkDTO `json:"links"`
	Used  int       `json:"used"`
	Limit int       `json:"limit"`
}

// Mount registers routes on mux.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/shorten", h.create)
	mux.HandleFunc("GET /api/shorten/mine", h.mine)
	mux.HandleFunc("DELETE /api/shorten/{code}", h.remove)
	mux.HandleFunc("GET /s/{code}", h.redirect)
	mux.HandleFunc("GET /api/shorten/{code}", h.lookup)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	anon, err := requireAnon(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing or invalid anonymous id")
		return
	}
	setAnonCookie(w, anon)

	var req createRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	ttl, err := ParseTTL(req.Preset, req.Days, req.Hours, req.Mins)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "ttl must be between 1 minute and 30 days")
		return
	}

	ip := clientIP(r)
	link, err := h.Store.Create(req.URL, ttl, anon, ip)
	if errors.Is(err, ErrBadURL) {
		writeErr(w, http.StatusBadRequest, "enter a valid http(s) url")
		return
	}
	if errors.Is(err, ErrBadTTL) {
		writeErr(w, http.StatusBadRequest, "ttl must be between 1 minute and 30 days")
		return
	}
	if errors.Is(err, ErrBadAnon) {
		writeErr(w, http.StatusBadRequest, "missing or invalid anonymous id")
		return
	}
	if errors.Is(err, ErrLimit) {
		writeErr(w, http.StatusTooManyRequests, "limit reached: max 10 active links per device/IP — delete one or wait for expiry")
		return
	}
	if err != nil {
		log.Printf("shorten create: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not create link")
		return
	}

	used, _ := h.Store.CountActiveByOwner(anon)
	writeJSON(w, http.StatusCreated, createResponse{
		Code:       link.Code,
		ShortURL:   h.shortURL(r, link.Code),
		URL:        link.URL,
		CreatedAt:  link.CreatedAt,
		ExpiresAt:  link.ExpiresAt,
		TTLSeconds: int64(ttl.Seconds()),
		Used:       used,
		Limit:      MaxActiveLinks,
	})
}

func (h *Handler) mine(w http.ResponseWriter, r *http.Request) {
	anon, err := requireAnon(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing or invalid anonymous id")
		return
	}
	setAnonCookie(w, anon)

	links, err := h.Store.ListByOwner(anon)
	if err != nil {
		log.Printf("shorten mine: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not load links")
		return
	}

	out := make([]linkDTO, 0, len(links))
	for _, l := range links {
		out = append(out, linkDTO{
			Code:      l.Code,
			ShortURL:  h.shortURL(r, l.Code),
			URL:       l.URL,
			CreatedAt: l.CreatedAt,
			ExpiresAt: l.ExpiresAt,
		})
	}
	writeJSON(w, http.StatusOK, mineResponse{
		Links: out,
		Used:  len(out),
		Limit: MaxActiveLinks,
	})
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	anon, err := requireAnon(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing or invalid anonymous id")
		return
	}
	code := r.PathValue("code")
	if err := h.Store.DeleteOwned(code, anon); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeErr(w, http.StatusNotFound, "link not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not delete link")
		return
	}
	used, _ := h.Store.CountActiveByOwner(anon)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"used":  used,
		"limit": MaxActiveLinks,
	})
}

func (h *Handler) redirect(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	dest, err := h.Store.Resolve(code)
	if errors.Is(err, ErrNotFound) {
		http.Error(w, "short link not found", http.StatusNotFound)
		return
	}
	if errors.Is(err, ErrExpired) {
		http.Error(w, "short link expired", http.StatusGone)
		return
	}
	if err != nil {
		log.Printf("shorten resolve: %v", err)
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, dest, http.StatusFound)
}

func (h *Handler) lookup(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	dest, err := h.Store.Resolve(code)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if errors.Is(err, ErrExpired) {
		writeErr(w, http.StatusGone, "expired")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"code": code,
		"url":  dest,
	})
}

func requireAnon(r *http.Request) (string, error) {
	id := strings.TrimSpace(r.Header.Get(anonHeader))
	if id == "" {
		if c, err := r.Cookie(anonCookie); err == nil {
			id = strings.TrimSpace(c.Value)
		}
	}
	if !ValidAnonID(id) {
		return "", ErrBadAnon
	}
	return id, nil
}

func setAnonCookie(w http.ResponseWriter, id string) {
	http.SetCookie(w, &http.Cookie{
		Name:     anonCookie,
		Value:    id,
		Path:     "/",
		MaxAge:   365 * 24 * 60 * 60,
		HttpOnly: false, // readable by JS so device id stays in sync
		SameSite: http.SameSiteLaxMode,
		Secure:   false,
	})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		ip := strings.TrimSpace(parts[0])
		if ip != "" {
			return ip
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		return xri
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (h *Handler) shortURL(r *http.Request, code string) string {
	base := strings.TrimRight(h.Public, "/")
	if base == "" {
		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		host := r.Header.Get("X-Forwarded-Host")
		if host == "" {
			host = r.Host
		}
		base = scheme + "://" + host
	}
	return base + "/s/" + code
}

// StartCleanup periodically deletes expired links.
func StartCleanup(store *Store, every time.Duration) {
	if every <= 0 {
		every = time.Minute
	}
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for range t.C {
			n, err := store.PurgeExpired()
			if err != nil {
				log.Printf("shorten purge: %v", err)
				continue
			}
			if n > 0 {
				log.Printf("shorten purged %d expired link(s)", n)
			}
		}
	}()
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
