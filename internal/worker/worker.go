package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"promptship/internal/core"
	"promptship/internal/store"
)

const Queue = "promptship-v1"

type Activities struct{ Store *store.Store }

func Pipeline(ctx workflow.Context, id string) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{StartToCloseTimeout: 30 * time.Minute, ScheduleToCloseTimeout: 40 * time.Minute, HeartbeatTimeout: 40 * time.Second, RetryPolicy: &temporal.RetryPolicy{InitialInterval: 3 * time.Second, MaximumInterval: 10 * time.Second, MaximumAttempts: 3}})
	return workflow.ExecuteActivity(ctx, "Execute", id).Get(ctx, nil)
}
func adapter(ctx context.Context, input map[string]any, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	b, e := json.Marshal(input)
	if e != nil {
		return e
	}
	cmd := exec.CommandContext(ctx, "node", "scripts/sandbox.mjs")
	cmd.Stdin = bytes.NewReader(b)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	raw, e := cmd.Output()
	var failure struct {
		Error string `json:"error"`
		Kind  string `json:"errorKind"`
	}
	_ = json.Unmarshal(raw, &failure)
	if failure.Error != "" {
		kind := "Harness"
		if failure.Kind == "infra" {
			kind = "Infrastructure"
		}
		return fmt.Errorf("%s error: %s", kind, failure.Error)
	}
	if e != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("Infrastructure error: adapter deadline or cancellation")
		}
		return fmt.Errorf("Harness error: sandbox adapter process failed")
	}
	if e = json.Unmarshal(raw, out); e != nil {
		return fmt.Errorf("Harness error: invalid sandbox adapter response")
	}
	return nil
}
func (a *Activities) Execute(ctx context.Context, id string) error {
	heartbeatCtx, stop := context.WithCancel(ctx)
	defer stop()
	go func() {
		ticker := time.NewTicker(8 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-ticker.C:
				activity.RecordHeartbeat(ctx, id)
			}
		}
	}()
	j, e := a.Store.Job(ctx, id)
	if e != nil {
		return e
	}
	if j.Status == "completed" || j.Status == "error" {
		return nil
	}
	_, e = a.Store.Pool.Exec(ctx, "UPDATE jobs SET status='running' WHERE id=$1 AND status='queued'", id)
	if e != nil {
		return e
	}
	for _, execution := range j.Executions {
		if e = a.executeSide(ctx, j, execution.Side); e != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(e, store.ErrConflict) {
				// A superseded activity must not finalize the newer owner's job.
				return e
			}
			return a.Store.Finish(ctx, id, "error", "unavailable", e.Error(), nil)
		}
	}
	j, e = a.Store.Job(ctx, id)
	if e != nil {
		return e
	}
	if j.Kind == "playground" {
		return a.Store.Finish(ctx, id, "completed", "unavailable", "", nil)
	}
	gate, report := core.Gate(j)
	status := "completed"
	if gate == "unavailable" {
		status = "error"
	}
	return a.Store.Finish(ctx, id, status, gate, "", &report)
}
func (a *Activities) executeSide(ctx context.Context, j core.Job, side string) (failure error) {
	x, e := a.Store.Claim(ctx, j.ID, side)
	if e != nil {
		return e
	}
	defer func() {
		if failure == nil || ctx.Err() != nil {
			return
		}
		var lease int64
		err := a.Store.Pool.QueryRow(ctx, "SELECT lease FROM executions WHERE job_id=$1 AND side=$2", j.ID, side).Scan(&lease)
		if err == nil && lease != x.Lease {
			failure = store.ErrConflict
		}
	}()
	if x.State == "completed" {
		return nil
	}
	// A start with no durable command ID is ambiguous. Never start a second command.
	if x.State == "starting" && x.CommandID == "" {
		return fmt.Errorf("Infrastructure error: command start could not be confirmed; the sandbox will be stopped")
	}
	prompt := j.Baseline
	if side == "candidate" {
		prompt = j.Candidate
	}
	if x.State == "pending" {
		var out struct {
			Image string `json:"image"`
			Node  string `json:"node"`
		}
		e = adapter(ctx, map[string]any{"action": "prepare", "name": x.Name, "image": j.Context.Image, "bundleHash": j.Context.BundleHash, "prompt": prompt.Text, "config": map[string]any{"jobId": j.ID, "side": side, "attempt": x.Attempt, "contextHash": j.ContextHash, "promptHash": prompt.Hash, "model": j.Context.Model, "cases": j.Context.Suite}}, &out)
		if e != nil {
			return fmt.Errorf("environment preparation: %w", e)
		}
		if strings.Contains(j.Context.Image, "@sha256:") && out.Image != j.Context.Image {
			return fmt.Errorf("Harness error: resolved image differs from frozen context")
		}
		x.Image = out.Image
		x.Node = out.Node
		x.State = "prepared"
		if e = a.Store.SaveExecution(ctx, x); e != nil {
			return e
		}
	}
	if x.CommandID == "" {
		x.State = "starting"
		if e = a.Store.SaveExecution(ctx, x); e != nil {
			return e
		}
		var out struct {
			CommandID string `json:"commandId"`
		}
		if e = adapter(ctx, map[string]any{"action": "start", "name": x.Name}, &out); e != nil {
			return fmt.Errorf("benchmark start: %w", e)
		}
		if out.CommandID == "" {
			return fmt.Errorf("Harness error: adapter returned no command ID")
		}
		x.CommandID = out.CommandID
		x.State = "running"
		if e = a.Store.SaveExecution(ctx, x); e != nil {
			return e
		}
	}
	ids := []string{}
	for _, c := range j.Context.Suite {
		ids = append(ids, c.ID)
	}
	deadline := time.NewTimer(16 * time.Minute)
	defer deadline.Stop()
	for {
		var out struct {
			Records  []core.Result `json:"records"`
			Done     bool          `json:"done"`
			ExitCode *int          `json:"exitCode"`
		}
		if e = adapter(ctx, map[string]any{"action": "poll", "name": x.Name, "commandId": x.CommandID, "attempt": x.Attempt, "caseIds": ids}, &out); e != nil {
			return fmt.Errorf("evidence collection: %w", e)
		}
		for _, r := range out.Records {
			if e = core.Validate(r, j, side, x.Attempt); e != nil {
				return fmt.Errorf("Harness error: %w", e)
			}
			if j.Kind == "eval" {
				for _, c := range j.Context.Suite {
					if c.ID == r.CaseID {
						r = core.Grade(c, r)
						break
					}
				}
			} else {
				r.Status = "pass"
				if r.Failure != nil {
					r.Status = "fail"
					if r.Failure.Kind != "protocol" {
						r.Status = "error"
					}
				}
			}
			if e = a.Store.SaveResult(ctx, x, r); e != nil {
				return e
			}
			if r.Failure != nil && r.Failure.Kind != "protocol" {
				return fmt.Errorf("%s error: %s", r.Failure.Kind, r.Failure.Message)
			}
		}
		if out.Done {
			if out.ExitCode == nil || *out.ExitCode != 0 {
				return fmt.Errorf("Harness error: benchmark process exited unsuccessfully")
			}
			if len(out.Records) != len(ids) {
				return fmt.Errorf("Harness error: benchmark ended with missing case artifacts")
			}
			x.State = "completed"
			if e = a.Store.SaveExecution(ctx, x); e != nil {
				return e
			}
			// Cleanup is durable and independently retried by the dispatcher.
			cleanCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if e = adapter(cleanCtx, map[string]any{"action": "cleanup", "name": x.Name}, &struct{}{}); e == nil {
				x.Cleanup = true
				_ = a.Store.SaveExecution(cleanCtx, x)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("Infrastructure error: execution deadline exceeded")
		case <-time.After(2500 * time.Millisecond):
		}
	}
}
func Dispatch(ctx context.Context, s *store.Store, c client.Client) {
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for {
		dispatchOnce(ctx, s, c)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
func dispatchOnce(ctx context.Context, s *store.Store, c client.Client) {
	_, _ = s.Pool.Exec(ctx, "UPDATE jobs SET status='error',gate='unavailable',error='Infrastructure error: dispatch deadline exceeded' WHERE dispatched=false AND status='queued' AND created_at<now()-interval '5 minutes'")
	rows, e := s.Pool.Query(ctx, "SELECT id FROM jobs WHERE dispatched=false AND status IN ('queued','running') ORDER BY created_at LIMIT 8")
	if e != nil {
		slog.Error("dispatcher database unavailable")
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		_, e = c.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: "ps-" + id, TaskQueue: Queue, WorkflowExecutionTimeout: 45 * time.Minute, WorkflowIDReusePolicy: enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE, WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING}, Pipeline, id)
		var exists *serviceerror.WorkflowExecutionAlreadyStarted
		if e == nil || errors.As(e, &exists) {
			_, _ = s.Pool.Exec(ctx, "UPDATE jobs SET dispatched=true WHERE id=$1", id)
		} else {
			slog.Warn("Temporal dispatch pending", "job", id)
		}
	}
	// A closed or timed out workflow must not leave an orphaned database run.
	rows, e = s.Pool.Query(ctx, "SELECT id FROM jobs WHERE dispatched=true AND status IN ('queued','running') AND created_at < now()-interval '45 minutes'")
	if e == nil {
		var old []string
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				old = append(old, id)
			}
		}
		rows.Close()
		for _, id := range old {
			_ = s.Finish(ctx, id, "error", "unavailable", "Infrastructure error: workflow deadline exceeded", nil)
		}
	}
	rows, e = s.Pool.Query(ctx, `SELECT x.job_id,x.side,x.name FROM executions x JOIN jobs j ON j.id=x.job_id WHERE x.cleanup=false AND (j.status IN ('completed','error','canceled') OR x.state='completed') LIMIT 8`)
	if e != nil {
		return
	}
	type target struct{ job, side, name string }
	var pending []target
	for rows.Next() {
		var t target
		if rows.Scan(&t.job, &t.side, &t.name) == nil {
			pending = append(pending, t)
		}
	}
	rows.Close()
	for _, t := range pending {
		cleanCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		e = adapter(cleanCtx, map[string]any{"action": "cleanup", "name": t.name}, &struct{}{})
		cancel()
		if e == nil {
			_, _ = s.Pool.Exec(ctx, "UPDATE executions SET cleanup=true WHERE job_id=$1 AND side=$2", t.job, t.side)
		}
	}
}
