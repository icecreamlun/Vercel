package server

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"sync"
	"time"

	"promptship/internal/core"
	"promptship/internal/store"
)

type Server struct {
	sessionMu    sync.Mutex
	sessionTimes []time.Time
	Store        *store.Store
	Origin       string
	Secure       bool
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if e := s.Store.Pool.Ping(r.Context()); e != nil {
			http.Error(w, "database unavailable", 503)
			return
		}
		respond(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/demo/session", s.session)
	mux.HandleFunc("GET /api/project", s.project)
	mux.HandleFunc("POST /api/runs", s.createRun)
	mux.HandleFunc("GET /api/runs/{id}", s.job)
	mux.HandleFunc("POST /api/runs/{id}/promote", s.promote)
	mux.HandleFunc("POST /api/playground", s.playground)
	mux.HandleFunc("GET /api/playground/{id}", s.job)
	mux.HandleFunc("POST /api/reset", s.reset)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != "GET" {
			mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if r.Header.Get("Origin") != s.Origin || r.Header.Get("X-PromptShip-Request") != "1" || mediaType != "application/json" {
				respond(w, 403, map[string]string{"error": "This request must come from the PromptShip application."})
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		mux.ServeHTTP(w, r)
	})
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, e error) {
	status := 500
	message := "The request could not be completed. Please try again."
	switch {
	case errors.Is(e, store.ErrNotFound):
		status = 404
		message = "Not found."
	case errors.Is(e, store.ErrConflict), errors.Is(e, store.ErrNoChange), errors.Is(e, store.ErrBusy), errors.Is(e, store.ErrArtifact):
		status = 409
		message = e.Error()
	case errors.Is(e, store.ErrInput):
		status = 400
		message = e.Error()
	case errors.Is(e, store.ErrBudget), errors.Is(e, store.ErrQueue):
		status = 429
		message = e.Error()
	default:
		slog.Error("request failed", "error", e)
	}
	respond(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		respond(w, 400, map[string]string{"error": "Invalid JSON request."})
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		respond(w, 400, map[string]string{"error": "Expected one JSON object."})
		return false
	}
	return true
}
func (s *Server) auth(w http.ResponseWriter, r *http.Request) (core.Project, bool) {
	c, e := r.Cookie("promptship_session")
	if e != nil {
		respond(w, 401, map[string]string{"error": "Your session has expired. Reload to start a new workspace."})
		return core.Project{}, false
	}
	p, e := s.Store.Session(r.Context(), c.Value)
	if errors.Is(e, store.ErrNotFound) {
		respond(w, 401, map[string]string{"error": "Your session has expired. Reload to start a new workspace."})
		return p, false
	}
	if e != nil {
		fail(w, e)
		return p, false
	}
	return p, true
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	if !decode(w, r, &struct{}{}) {
		return
	}
	if c, e := r.Cookie("promptship_session"); e == nil {
		if p, e := s.Store.Session(r.Context(), c.Value); e == nil {
			respond(w, 200, p)
			return
		} else if !errors.Is(e, store.ErrNotFound) {
			fail(w, e)
			return
		}
	}
	s.sessionMu.Lock()
	now := time.Now()
	recent := s.sessionTimes[:0]
	for _, at := range s.sessionTimes {
		if now.Sub(at) < time.Minute {
			recent = append(recent, at)
		}
	}
	s.sessionTimes = recent
	if len(recent) >= 30 {
		s.sessionMu.Unlock()
		respond(w, 429, map[string]string{"error": "New workspace creation is temporarily limited. Please try again in a minute."})
		return
	}
	s.sessionTimes = append(s.sessionTimes, now)
	s.sessionMu.Unlock()
	token, p, e := s.Store.NewSession(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "promptship_session", Value: token, Path: "/", HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteStrictMode, MaxAge: int((7 * 24 * time.Hour).Seconds()), Expires: p.ExpiresAt})
	respond(w, 201, p)
}
func (s *Server) project(w http.ResponseWriter, r *http.Request) {
	p, ok := s.auth(w, r)
	if !ok {
		return
	}
	jobs, e := s.Store.Jobs(r.Context(), p.ID)
	if e != nil {
		fail(w, e)
		return
	}
	releases, e := s.Store.Releases(r.Context(), p.ID)
	if e != nil {
		fail(w, e)
		return
	}
	var used, cap int64
	e = s.Store.Pool.QueryRow(r.Context(), "SELECT used,cap FROM usage_counter WHERE id=1").Scan(&used, &cap)
	if e != nil {
		fail(w, e)
		return
	}
	respond(w, 200, map[string]any{"project": p, "versions": s.Store.Catalog.Versions, "jobs": jobs, "examples": s.Store.Examples, "releases": releases, "budget": map[string]int64{"used": used, "limit": cap}})
}
func (s *Server) createRun(w http.ResponseWriter, r *http.Request) {
	p, ok := s.auth(w, r)
	if !ok {
		return
	}
	var body struct {
		Version string `json:"version"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Version == "" {
		respond(w, 400, map[string]string{"error": "Choose a prompt revision."})
		return
	}
	id, e := s.Store.CreateJob(r.Context(), p.ID, "eval", body.Version, "", r.Header.Get("Idempotency-Key"))
	if e != nil {
		fail(w, e)
		return
	}
	respond(w, 202, map[string]string{"id": id})
}
func (s *Server) playground(w http.ResponseWriter, r *http.Request) {
	p, ok := s.auth(w, r)
	if !ok {
		return
	}
	var body struct {
		Input string `json:"input"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Input) < 1 || len(body.Input) > 2000 {
		respond(w, 400, map[string]string{"error": "Enter a message up to 2,000 bytes."})
		return
	}
	id, e := s.Store.CreateJob(r.Context(), p.ID, "playground", "", body.Input, r.Header.Get("Idempotency-Key"))
	if e != nil {
		fail(w, e)
		return
	}
	respond(w, 202, map[string]string{"id": id})
}
func (s *Server) ownedJob(w http.ResponseWriter, r *http.Request) (core.Job, bool) {
	p, ok := s.auth(w, r)
	if !ok {
		return core.Job{}, false
	}
	j, e := s.Store.Job(r.Context(), r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return j, false
	}
	if j.ProjectID != p.ID {
		fail(w, store.ErrNotFound)
		return j, false
	}
	return j, true
}
func (s *Server) job(w http.ResponseWriter, r *http.Request) {
	j, ok := s.ownedJob(w, r)
	if ok {
		respond(w, 200, j)
	}
}
func (s *Server) promote(w http.ResponseWriter, r *http.Request) {
	if !decode(w, r, &struct{}{}) {
		return
	}
	j, ok := s.ownedJob(w, r)
	if !ok {
		return
	}
	release, e := s.Store.Promote(r.Context(), j.ProjectID, j.ID)
	if e != nil {
		fail(w, e)
		return
	}
	respond(w, 200, release)
}
func (s *Server) reset(w http.ResponseWriter, r *http.Request) {
	if !decode(w, r, &struct{}{}) {
		return
	}
	p, ok := s.auth(w, r)
	if !ok {
		return
	}
	if e := s.Store.Reset(r.Context(), p.ID); e != nil {
		fail(w, e)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
