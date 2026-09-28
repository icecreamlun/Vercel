package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"promptship/internal/core"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is required for transaction tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	namespace := "test_" + core.ID()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+namespace); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = namespace
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close(); _, _ = admin.Exec(ctx, "DROP SCHEMA "+namespace+" CASCADE"); admin.Close() })
	baseline := core.Prompt{ID: "baseline", Text: "old", Hash: core.Hash([]byte("old"))}
	candidate := core.Prompt{ID: "candidate", Text: "new", Hash: core.Hash([]byte("new"))}
	dir := t.TempDir()
	bundle := []byte("platform runner")
	bundleHash := core.Hash(bundle)
	if err = os.WriteFile(filepath.Join(dir, bundleHash+".mjs"), bundle, 0600); err != nil {
		t.Fatal(err)
	}
	return &Store{Pool: pool, BundleDir: dir, Catalog: core.Catalog{Versions: []core.Prompt{baseline, candidate}, BundleHash: bundleHash, Model: "model", Image: "pinned"}, Suite: []core.Case{{ID: "policy", Critical: true, Expected: []string{"deny"}}}}
}
func makePassed(t *testing.T, s *Store, project string) string {
	t.Helper()
	ctx := context.Background()
	id, err := s.CreateJob(ctx, project, "eval", "candidate", "", core.ID())
	if err != nil {
		t.Fatal(err)
	}
	j, err := s.Job(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	for _, side := range []string{"baseline", "candidate"} {
		x, err := s.Claim(ctx, id, side)
		if err != nil {
			t.Fatal(err)
		}
		r := core.Grade(s.Suite[0], core.Result{SchemaVersion: 1, JobID: id, Side: side, CaseID: "policy", ContextHash: j.ContextHash, Attempt: 1, Output: &core.Output{Decision: "deny", Answer: "Outside policy."}, Trace: []core.Trace{}, Raw: []string{}})
		if err = s.SaveResult(ctx, x, r); err != nil {
			t.Fatal(err)
		}
	}
	j, err = s.Job(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	gate, report := core.Gate(j)
	if err = s.Finish(ctx, id, "completed", gate, "", &report); err != nil {
		t.Fatal(err)
	}
	return id
}
func TestConcurrentPromoteAndIdempotentRetry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	token, p, err := s.NewSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id := makePassed(t, s, p.ID)
	var wg sync.WaitGroup
	results := make(chan core.Release, 8)
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); r, e := s.Promote(ctx, p.ID, id); results <- r; errs <- e }()
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	first := ""
	for r := range results {
		if first == "" {
			first = r.ID
		}
		if r.ID != first {
			t.Fatal("duplicate releases")
		}
	}
	after, err := s.Session(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if after.Generation != 2 || after.Release.Prompt.Text != "new" {
		t.Fatal(after)
	}
	if err = s.Reset(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	r, err := s.Promote(ctx, p.ID, id)
	if err != nil || r.ID != first {
		t.Fatal("retry must return old release", err)
	}
	after, _ = s.Session(ctx, token)
	if after.Generation != 3 || after.Release.Prompt.Text != "old" {
		t.Fatal("retry reset production pointer")
	}
}
func TestResetInvalidatesUnpromotedRunAndKeepsBudget(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, p, err := s.NewSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id := makePassed(t, s, p.ID)
	var before, after int64
	_ = s.Pool.QueryRow(ctx, "SELECT used FROM usage_counter").Scan(&before)
	if err = s.Reset(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Promote(ctx, p.ID, id); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected stale conflict, got %v", err)
	}
	_ = s.Pool.QueryRow(ctx, "SELECT used FROM usage_counter").Scan(&after)
	if before != after || after == 0 {
		t.Fatal("reset changed budget")
	}
}
func TestIdempotencyBudgetAndIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, p, err := s.NewSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	key := core.ID()
	id, err := s.CreateJob(ctx, p.ID, "eval", "candidate", "", key)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.CreateJob(ctx, p.ID, "eval", "candidate", "", key)
	if err != nil || again != id {
		t.Fatal("non-idempotent create", err)
	}
	if _, err = s.CreateJob(ctx, p.ID, "playground", "", "hello", key); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	var used int64
	_ = s.Pool.QueryRow(ctx, "SELECT used FROM usage_counter").Scan(&used)
	if used != 16800 {
		t.Fatalf("charged %d", used)
	}
	_, other, err := s.NewSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Promote(ctx, other.ID, id); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross-project promotion allowed", err)
	}
	_, err = s.Pool.Exec(ctx, "UPDATE usage_counter SET cap=used")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateJob(ctx, other.ID, "eval", "candidate", "", core.ID()); !errors.Is(err, ErrBudget) {
		t.Fatal(err)
	}
	var count int
	_ = s.Pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE project_id=$1", other.ID).Scan(&count)
	if count != 0 {
		t.Fatal("budget rejection left a job")
	}
}
func TestLeaseRejectsLateArtifacts(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, p, _ := s.NewSession(ctx)
	id, err := s.CreateJob(ctx, p.ID, "eval", "candidate", "", core.ID())
	if err != nil {
		t.Fatal(err)
	}
	old, _ := s.Claim(ctx, id, "baseline")
	newLease, _ := s.Claim(ctx, id, "baseline")
	if newLease.Lease <= old.Lease {
		t.Fatal("lease did not increase")
	}
	if err = s.SaveResult(ctx, old, core.Result{CaseID: "policy"}); !errors.Is(err, ErrConflict) {
		t.Fatal("old lease wrote evidence", err)
	}
	old.State = "completed"
	if err = s.SaveExecution(ctx, old); !errors.Is(err, ErrConflict) {
		t.Fatal("old lease changed execution", err)
	}
}
func TestMalformedArtifactsCannotBePromoted(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, p, _ := s.NewSession(ctx)
	id := makePassed(t, s, p.ID)
	j, _ := s.Job(ctx, id)
	j.Candidate.Text = "changed"
	raw, _ := json.Marshal(j)
	_, err := s.Pool.Exec(ctx, "UPDATE jobs SET frozen=$2 WHERE id=$1", id, raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Promote(ctx, p.ID, id); !errors.Is(err, ErrConflict) {
		t.Fatal("changed prompt promoted", err)
	}
}

func TestMissingBundleCannotBePromoted(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, p, _ := s.NewSession(ctx)
	id := makePassed(t, s, p.ID)
	if err := os.Remove(filepath.Join(s.BundleDir, s.Catalog.BundleHash+".mjs")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Promote(ctx, p.ID, id); !errors.Is(err, ErrArtifact) {
		t.Fatal("missing bundle accepted", err)
	}
}
