package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"promptship/internal/core"
)

//go:embed schema.sql
var schema string
var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("the request conflicts with current project state")
var ErrBudget = errors.New("the shared execution budget is exhausted; existing reports remain available")
var ErrNoChange = errors.New("the prompt is identical to production")
var ErrArtifact = errors.New("the evaluated runner bundle is unavailable; restore its artifact before promotion")
var ErrInput = errors.New("invalid request")
var ErrQueue = errors.New("the execution queue is full; try again after a run finishes")
var ErrBusy = errors.New("an execution is already in progress for this project")

type Store struct {
	Pool      *pgxpool.Pool
	Catalog   core.Catalog
	Suite     []core.Case
	Examples  []core.Job
	BundleDir string
}

func Open(ctx context.Context, url string, c core.Catalog, suite []core.Case) (*Store, error) {
	p, e := pgxpool.New(ctx, url)
	if e != nil {
		return nil, e
	}
	if _, e = p.Exec(ctx, schema); e != nil {
		p.Close()
		return nil, e
	}
	examples := []core.Job{}
	for _, name := range []string{"candidate-a", "candidate-b"} {
		raw, err := os.ReadFile("fixtures/reports/" + name + ".json")
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			p.Close()
			return nil, err
		}
		var job core.Job
		if err = json.Unmarshal(raw, &job); err != nil {
			p.Close()
			return nil, err
		}
		job.Example = true
		job.Promotion = "unavailable"
		examples = append(examples, job)
	}
	return &Store{Pool: p, Catalog: c, Suite: suite, Examples: examples, BundleDir: core.BundleDirectory()}, nil
}
func encode(v any) []byte {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return b
}
func (s *Store) NewSession(ctx context.Context) (string, core.Project, error) {
	token := core.ID() + core.ID()
	id := core.ID()
	r := core.Release{ID: core.ID(), Prompt: s.Catalog.Versions[0], Context: core.Context{BundleHash: s.Catalog.BundleHash, Model: s.Catalog.Model, Image: s.Catalog.Image, Suite: s.Suite, GateVersion: "policy-v1"}, CreatedAt: time.Now().UTC()}
	expires := time.Now().Add(7 * 24 * time.Hour)
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return "", core.Project{}, e
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, "INSERT INTO projects(id,release_id) VALUES($1,$2)", id, r.ID)
	if e == nil {
		_, e = tx.Exec(ctx, "INSERT INTO releases(id,project_id,artifact) VALUES($1,$2,$3)", r.ID, id, encode(r))
	}
	if e == nil {
		_, e = tx.Exec(ctx, "INSERT INTO sessions(token_hash,project_id,expires_at) VALUES($1,$2,$3)", core.Hash([]byte(token)), id, expires)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	return token, core.Project{ID: id, Generation: 1, Release: r, ExpiresAt: expires}, e
}
func (s *Store) Session(ctx context.Context, token string) (core.Project, error) {
	var p core.Project
	var b []byte
	e := s.Pool.QueryRow(ctx, `SELECT p.id,p.generation,r.artifact,s.expires_at FROM sessions s JOIN projects p ON p.id=s.project_id JOIN releases r ON r.id=p.release_id WHERE s.token_hash=$1 AND s.expires_at>now()`, core.Hash([]byte(token))).Scan(&p.ID, &p.Generation, &b, &p.ExpiresAt)
	if errors.Is(e, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	if e == nil {
		e = json.Unmarshal(b, &p.Release)
	}
	return p, e
}
func (s *Store) CreateJob(ctx context.Context, projectID, kind, version, input, key string) (string, error) {
	if len(key) < 8 || len(key) > 100 {
		return "", fmt.Errorf("%w: idempotency key must be 8–100 characters", ErrInput)
	}
	requestHash := core.Hash(encode([]string{kind, version, input}))
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	var generation int64
	var releaseID string
	e = tx.QueryRow(ctx, "SELECT generation,release_id FROM projects WHERE id=$1 FOR UPDATE", projectID).Scan(&generation, &releaseID)
	if e != nil {
		return "", e
	}
	var existing, digest string
	e = tx.QueryRow(ctx, "SELECT id,request_hash FROM jobs WHERE project_id=$1 AND idem_key=$2", projectID, key).Scan(&existing, &digest)
	if e == nil {
		if digest != requestHash {
			return "", ErrConflict
		}
		return existing, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return "", e
	}
	var active int
	e = tx.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE project_id=$1 AND status IN ('queued','running')", projectID).Scan(&active)
	if e != nil {
		return "", e
	}
	if active > 0 {
		return "", ErrBusy
	}
	var raw []byte
	var r core.Release
	e = tx.QueryRow(ctx, "SELECT artifact FROM releases WHERE id=$1", releaseID).Scan(&raw)
	if e != nil {
		return "", e
	}
	if e = json.Unmarshal(raw, &r); e != nil {
		return "", e
	}
	j := core.Job{ID: core.ID(), ProjectID: projectID, Kind: kind, BaselineReleaseID: releaseID, Generation: generation, Baseline: r.Prompt, Candidate: r.Prompt, Context: r.Context, Status: "queued", Gate: "pending", CreatedAt: time.Now().UTC()}
	weight := int64(6 * 2 * 700)
	sides := []string{"production"}
	if kind == "eval" {
		found := false
		for _, p := range s.Catalog.Versions {
			if p.ID == version || p.SHA == version {
				j.Candidate = p
				found = true
				break
			}
		}
		if !found {
			return "", fmt.Errorf("%w: unknown prompt revision", ErrInput)
		}
		if j.Candidate.Hash == j.Baseline.Hash {
			return "", ErrNoChange
		}
		weight *= int64(len(j.Context.Suite) * 2)
		sides = []string{"baseline", "candidate"}
	} else {
		if len(input) < 1 || len(input) > 2000 {
			return "", fmt.Errorf("%w: message must contain 1–2000 bytes", ErrInput)
		}
		j.Context.Suite = []core.Case{{ID: "playground", Name: "Production request", Input: input, Orders: []core.Order{{ID: "ORD-1042", AgeDays: 12, Status: "paid", Amount: 79}, {ID: "ORD-2048", AgeDays: 45, Status: "paid", Amount: 129}, {ID: "ORD-3051", AgeDays: 8, Status: "refunded", Amount: 49}}}}
	}
	j.Weight = weight
	j.ContextHash = core.ContextHash(j.Context)
	// Lock the shared admission row before counting jobs so concurrent projects
	// cannot all observe the same last free queue slot.
	var ignored int
	if e = tx.QueryRow(ctx, "SELECT id FROM usage_counter WHERE id=1 FOR UPDATE").Scan(&ignored); e != nil {
		return "", e
	}
	var queued int
	if e = tx.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE status IN ('queued','running')").Scan(&queued); e != nil {
		return "", e
	}
	if queued >= 8 {
		return "", ErrQueue
	}
	tag, e := tx.Exec(ctx, "UPDATE usage_counter SET used=used+$1 WHERE id=1 AND used+$1<=cap", weight)
	if e != nil {
		return "", e
	}
	if tag.RowsAffected() != 1 {
		return "", ErrBudget
	}
	_, e = tx.Exec(ctx, "INSERT INTO jobs(id,project_id,kind,idem_key,request_hash,frozen,weight) VALUES($1,$2,$3,$4,$5,$6,$7)", j.ID, projectID, kind, key, requestHash, encode(j), weight)
	if e != nil {
		return "", e
	}
	for _, side := range sides {
		_, e = tx.Exec(ctx, "INSERT INTO executions(job_id,side,name) VALUES($1,$2,$3)", j.ID, side, "ps-"+j.ID+"-"+side+"-a1")
		if e != nil {
			return "", e
		}
	}
	return j.ID, tx.Commit(ctx)
}

type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Store) Job(ctx context.Context, id string) (core.Job, error) {
	return s.loadJob(ctx, id, s.Pool)
}

func (s *Store) loadJob(ctx context.Context, id string, q querier) (core.Job, error) {
	var j core.Job
	var raw, report []byte
	var status, gate, msg string
	e := q.QueryRow(ctx, "SELECT frozen,status,gate,error,report FROM jobs WHERE id=$1", id).Scan(&raw, &status, &gate, &msg, &report)
	if errors.Is(e, pgx.ErrNoRows) {
		return j, ErrNotFound
	}
	if e != nil {
		return j, e
	}
	if e = json.Unmarshal(raw, &j); e != nil {
		return j, e
	}
	j.Status = status
	j.Gate = gate
	j.Error = msg
	j.Results = []core.Result{}
	j.Executions = []core.Execution{}
	if len(report) > 0 {
		if e = json.Unmarshal(report, &j.Report); e != nil {
			return j, e
		}
	}
	rows, e := q.Query(ctx, "SELECT artifact FROM case_results WHERE job_id=$1 ORDER BY side,case_id", id)
	if e != nil {
		return j, e
	}
	for rows.Next() {
		var b []byte
		var r core.Result
		if e = rows.Scan(&b); e != nil {
			rows.Close()
			return j, e
		}
		if e = json.Unmarshal(b, &r); e != nil {
			rows.Close()
			return j, e
		}
		j.Results = append(j.Results, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return j, e
	}
	rows, e = q.Query(ctx, "SELECT job_id,side,name,attempt,lease,command_id,state,image,node,cleanup FROM executions WHERE job_id=$1 ORDER BY side", id)
	if e != nil {
		return j, e
	}
	defer rows.Close()
	for rows.Next() {
		var x core.Execution
		if e = rows.Scan(&x.JobID, &x.Side, &x.Name, &x.Attempt, &x.Lease, &x.CommandID, &x.State, &x.Image, &x.Node, &x.Cleanup); e != nil {
			return j, e
		}
		j.Executions = append(j.Executions, x)
	}
	if e = rows.Err(); e != nil {
		return j, e
	}
	j.Promotion = "unavailable"
	if j.Kind == "eval" && j.Gate == "passed" && j.Status == "completed" {
		var current string
		var gen int64
		var released bool
		e = q.QueryRow(ctx, "SELECT release_id,generation,EXISTS(SELECT 1 FROM releases WHERE run_id=$2) FROM projects WHERE id=$1", j.ProjectID, j.ID).Scan(&current, &gen, &released)
		if e != nil {
			return j, e
		}
		j.Promotion = "stale"
		if current == j.BaselineReleaseID && gen == j.Generation {
			j.Promotion = "eligible"
		}
		if released {
			j.Promotion = "promoted"
		}
	}
	return j, nil
}
func (s *Store) Jobs(ctx context.Context, project string) ([]core.Job, error) {
	rows, e := s.Pool.Query(ctx, "SELECT id FROM jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 40", project)
	if e != nil {
		return nil, e
	}
	var ids []string
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return nil, e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	out := []core.Job{}
	for _, id := range ids {
		j, e := s.Job(ctx, id)
		if e != nil {
			return nil, e
		}
		out = append(out, j)
	}
	return out, nil
}
func (s *Store) Releases(ctx context.Context, project string) ([]core.Release, error) {
	rows, e := s.Pool.Query(ctx, "SELECT artifact FROM releases WHERE project_id=$1 ORDER BY created_at DESC", project)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []core.Release{}
	for rows.Next() {
		var raw []byte
		var r core.Release
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(raw, &r); e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) Promote(ctx context.Context, project, id string) (core.Release, error) {
	var r core.Release
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return r, e
	}
	defer tx.Rollback(ctx)
	var current string
	var gen int64
	e = tx.QueryRow(ctx, "SELECT release_id,generation FROM projects WHERE id=$1 FOR UPDATE", project).Scan(&current, &gen)
	if e != nil {
		return r, e
	}
	var raw []byte
	e = tx.QueryRow(ctx, "SELECT artifact FROM releases WHERE run_id=$1 AND project_id=$2", id, project).Scan(&raw)
	if e == nil {
		e = json.Unmarshal(raw, &r)
		return r, e
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return r, e
	}
	j, e := s.loadJob(ctx, id, tx)
	if e != nil {
		return r, e
	}
	if j.ProjectID != project {
		return r, ErrNotFound
	}
	gate, _ := core.Gate(j)
	if j.Kind != "eval" || j.Status != "completed" || j.Gate != "passed" || gate != "passed" || current != j.BaselineReleaseID || gen != j.Generation || core.Hash([]byte(j.Candidate.Text)) != j.Candidate.Hash || j.ContextHash != core.ContextHash(j.Context) {
		return r, ErrConflict
	}
	if e = core.VerifyBundle(s.BundleDir, j.Context.BundleHash); e != nil {
		return r, ErrArtifact
	}
	var baseline core.Release
	e = tx.QueryRow(ctx, "SELECT artifact FROM releases WHERE id=$1", current).Scan(&raw)
	if e != nil {
		return r, e
	}
	if e = json.Unmarshal(raw, &baseline); e != nil {
		return r, e
	}
	if core.ContextHash(baseline.Context) != j.ContextHash {
		return r, ErrConflict
	}
	r = core.Release{ID: core.ID(), RunID: id, Prompt: j.Candidate, Context: j.Context, CreatedAt: time.Now().UTC()}
	_, e = tx.Exec(ctx, "INSERT INTO releases(id,project_id,run_id,artifact) VALUES($1,$2,$3,$4)", r.ID, project, id, encode(r))
	if e != nil {
		return r, e
	}
	tag, e := tx.Exec(ctx, "UPDATE projects SET release_id=$1,generation=generation+1 WHERE id=$2 AND release_id=$3 AND generation=$4", r.ID, project, current, gen)
	if e != nil {
		return r, e
	}
	if tag.RowsAffected() != 1 {
		return r, ErrConflict
	}
	return r, tx.Commit(ctx)
}
func (s *Store) Reset(ctx context.Context, project string) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var old string
	e = tx.QueryRow(ctx, "SELECT release_id FROM projects WHERE id=$1 FOR UPDATE", project).Scan(&old)
	if e != nil {
		return e
	}
	r := core.Release{ID: core.ID(), Prompt: s.Catalog.Versions[0], Context: core.Context{BundleHash: s.Catalog.BundleHash, Model: s.Catalog.Model, Image: s.Catalog.Image, Suite: s.Suite, GateVersion: "policy-v1"}, CreatedAt: time.Now().UTC()}
	_, e = tx.Exec(ctx, "INSERT INTO releases(id,project_id,artifact) VALUES($1,$2,$3)", r.ID, project, encode(r))
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "UPDATE projects SET release_id=$1,generation=generation+1 WHERE id=$2", r.ID, project)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) Claim(ctx context.Context, id, side string) (core.Execution, error) {
	var x core.Execution
	e := s.Pool.QueryRow(ctx, `UPDATE executions SET lease=lease+1 WHERE job_id=$1 AND side=$2 RETURNING job_id,side,name,attempt,lease,command_id,state,image,node,cleanup`, id, side).Scan(&x.JobID, &x.Side, &x.Name, &x.Attempt, &x.Lease, &x.CommandID, &x.State, &x.Image, &x.Node, &x.Cleanup)
	return x, e
}
func (s *Store) SaveExecution(ctx context.Context, x core.Execution) error {
	tag, e := s.Pool.Exec(ctx, "UPDATE executions SET command_id=$1,state=$2,image=$3,node=$4,cleanup=$5 WHERE job_id=$6 AND side=$7 AND lease=$8", x.CommandID, x.State, x.Image, x.Node, x.Cleanup, x.JobID, x.Side, x.Lease)
	if e == nil && tag.RowsAffected() != 1 {
		return ErrConflict
	}
	return e
}
func (s *Store) SaveResult(ctx context.Context, x core.Execution, r core.Result) error {
	tag, e := s.Pool.Exec(ctx, `INSERT INTO case_results(job_id,side,case_id,artifact) SELECT $1,$2,$3,$4 FROM executions WHERE job_id=$1 AND side=$2 AND lease=$5 ON CONFLICT(job_id,side,case_id) DO UPDATE SET artifact=excluded.artifact`, x.JobID, x.Side, r.CaseID, encode(r), x.Lease)
	if e == nil && tag.RowsAffected() != 1 {
		return ErrConflict
	}
	return e
}
func (s *Store) Finish(ctx context.Context, id, status, gate, msg string, report *core.Report) error {
	var b []byte
	if report != nil {
		b = encode(report)
	}
	_, e := s.Pool.Exec(ctx, "UPDATE jobs SET status=$2,gate=$3,error=$4,report=$5 WHERE id=$1 AND status IN ('queued','running')", id, status, gate, msg, b)
	return e
}
